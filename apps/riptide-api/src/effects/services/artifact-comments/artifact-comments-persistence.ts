import { commentAuthor, type ArtifactCommentAuthor } from '@humanlayer/db/artifact-comment-author'
import { artifactComments as commentRows } from '@humanlayer/db/tables/artifact-comments'
import { artifacts } from '@humanlayer/db/tables/artifacts'
import { ArtifactCommentAnchorSchema } from '@humanlayer/db/zodschemas/artifact-comment-anchor'
import * as Sentry from '@sentry/node'
import { and, eq } from 'drizzle-orm'
import { Effect, Schema } from 'effect'

import { requireTaskReadPermission, requireTaskReadPermissionForUpdate } from '../postgres/helpers'
import type { PostgresDbQueryError, PostgresDbTransactionError } from '../postgres/postgres-db.errors'
import type { PostgresTransaction } from '../postgres/postgres-db.service'
import { resolveUserDisplayNames } from '../workos/display-name'
import { buildArtifactCommentThreadIndex, getArtifactCommentRootId } from './artifact-comment-threads'
import {
	ArtifactCommentForbidden,
	ArtifactCommentIdAmbiguous,
	ArtifactCommentInvalid,
	ArtifactCommentInvalidInput,
	ArtifactCommentInvalidRow,
	ArtifactCommentNotFound,
	ArtifactCommentsUnavailable,
} from './artifact-comments-errors'
import type { CommentUserInfo } from './artifact-comments-types'

type ArtifactCommentOperationError =
	| ArtifactCommentForbidden
	| ArtifactCommentIdAmbiguous
	| ArtifactCommentInvalid
	| ArtifactCommentInvalidInput
	| ArtifactCommentInvalidRow
	| ArtifactCommentNotFound
	| ArtifactCommentsUnavailable

/** Parses transport input before artifact-comment domain or persistence logic runs. */
export const decodeArtifactCommentInput = <S extends Schema.Top>(schema: S, input: unknown) =>
	Schema.decodeUnknownEffect(schema)(input).pipe(
		Effect.mapError(() => new ArtifactCommentInvalidInput({ message: 'Invalid artifact comment input' })),
	)

const unavailable = <DatabaseError extends { readonly retryable: boolean }>(error: DatabaseError) =>
	Effect.logError('Artifact comments database operation failed', error).pipe(
		Effect.andThen(Effect.sync(() => Sentry.captureException(error))),
		Effect.andThen(Effect.fail(new ArtifactCommentsUnavailable({ retryable: error.retryable }))),
	)

export const narrowArtifactCommentDatabaseErrors = <A, R>(
	effect: Effect.Effect<A, ArtifactCommentOperationError | PostgresDbQueryError | PostgresDbTransactionError, R>,
) =>
	effect.pipe(
		Effect.catchTag('PostgresDbQueryError', unavailable),
		Effect.catchTag('PostgresDbTransactionError', unavailable),
	)

/** Applies task ACLs while preserving artifact-comment anti-enumeration behavior. */
export const requireTaskReadPermissionForArtifactComment = (
	tx: PostgresTransaction,
	input: { taskId: string; userInfo: CommentUserInfo },
	hiddenMessage: string,
) =>
	requireTaskReadPermission(tx, {
		taskId: input.taskId,
		userId: input.userInfo.userId,
		organizationId: input.userInfo.organizationId,
	}).pipe(
		Effect.catchTag('TaskNotFoundError', () =>
			Effect.fail(new ArtifactCommentNotFound({ message: hiddenMessage })),
		),
	)

export const requireTaskReadPermissionForArtifactCommentWrite = (
	tx: PostgresTransaction,
	input: { taskId: string; userInfo: CommentUserInfo },
	hiddenMessage: string,
) =>
	requireTaskReadPermissionForUpdate(tx, {
		taskId: input.taskId,
		userId: input.userInfo.userId,
		organizationId: input.userInfo.organizationId,
	}).pipe(
		Effect.catchTag('TaskNotFoundError', () =>
			Effect.fail(new ArtifactCommentNotFound({ message: hiddenMessage })),
		),
	)

/** Finds the task artifact targeted by filename and reports valid alternatives when absent. */
export const findTaskArtifactByFilename = (
	tx: PostgresTransaction,
	taskId: string,
	filename: string,
	organizationId: string,
) =>
	Effect.gen(function* () {
		const rows = yield* tx.query(
			tx.client
				.select()
				.from(artifacts)
				.where(
					and(
						eq(artifacts.task_id, taskId),
						eq(artifacts.file_name, filename),
						eq(artifacts.organization_id, organizationId),
					),
				)
				.limit(1),
		)
		if (rows[0]) return rows[0]
		const available = yield* tx.query(
			tx.client
				.select({ fileName: artifacts.file_name })
				.from(artifacts)
				.where(and(eq(artifacts.task_id, taskId), eq(artifacts.organization_id, organizationId))),
		)
		return yield* Effect.fail(
			new ArtifactCommentNotFound({
				message: 'Artifact not found',
				validArtifacts: available.map((row) => row.fileName),
			}),
		)
	})

/**
 * Resolves the short comment ID exposed to models and daemon tools back to its
 * full random UUID. A suffix can be absent or ambiguous, so callers must map
 * both outcomes to the appropriate domain response.
 */
export const resolveArtifactCommentByIdSuffix = <Row extends { id: string }>(
	rows: ReadonlyArray<Row>,
	suffix: string,
): Row | null | 'ambiguous' => {
	const matches = rows.filter((row) => row.id.endsWith(suffix))
	return matches.length === 1 ? (matches[0] ?? null) : matches.length === 0 ? null : ('ambiguous' as const)
}

/** Selects visible comments and preserves root-then-descendant display order. */
export const selectVisibleArtifactCommentRowsInThreadOrder = (
	rows: ReadonlyArray<typeof commentRows.$inferSelect>,
	includeResolved: boolean,
) => {
	const { byId } = buildArtifactCommentThreadIndex(rows)
	const rootIds = rows
		.filter((row) => !row.reply_to_comment_id || !byId.has(row.reply_to_comment_id))
		.filter((row) => includeResolved || !row.is_resolved)
		.map((row) => row.id)
	return rootIds.flatMap((rootId) => rows.filter((row) => getArtifactCommentRootId(row.id, byId) === rootId))
}

const parseArtifactCommentAnchorContext = (comment: typeof commentRows.$inferSelect) =>
	Effect.gen(function* () {
		if (!comment.reply_to_comment_id && comment.anchor_json !== null) {
			const parsed = ArtifactCommentAnchorSchema.safeParse(comment.anchor_json)
			if (!parsed.success)
				return yield* Effect.fail(
					new ArtifactCommentInvalidRow({ message: `Artifact comment ${comment.id} has an invalid anchor` }),
				)
			return {
				quotedText: parsed.data.selectedText,
				previousBlockText: parsed.data.start.previousBlockText,
				nextBlockText: parsed.data.end.nextBlockText,
			}
		}
		return {
			quotedText: comment.commented_upon_block_text ?? null,
			previousBlockText: comment.previous_block_text ?? null,
			nextBlockText: comment.next_block_text ?? null,
		}
	})

/** Converts persisted rows into the user/daemon projection after resolving display names. */
const authorName = (author: ArtifactCommentAuthor | null, names: ReadonlyMap<string, string>) => {
	if (author?.kind === 'user') return names.get(author.userId) ?? author.userId
	return author?.guestName ?? 'Guest'
}

export const projectArtifactCommentRows = Effect.fn('artifact_comments.project')(function* (
	artifactFilename: string,
	rows: ReadonlyArray<typeof commentRows.$inferSelect>,
) {
	const names = yield* resolveUserDisplayNames([
		...new Set(rows.flatMap((row) => (row.created_by_user_id ? [row.created_by_user_id] : []))),
	])
	return {
		artifactFilename,
		comments: yield* Effect.forEach(rows, (row) =>
			parseArtifactCommentAnchorContext(row).pipe(
				Effect.map((context) => ({
					id: row.id,
					truncatedId: row.id.split('-').pop() ?? row.id,
					userName: authorName(commentAuthor(row), names),
					isResolved: row.is_resolved,
					createdByAgent: row.created_by_agent,
					contentText: row.content_text,
					...context,
					replyToCommentId: row.reply_to_comment_id ?? null,
				})),
			),
		),
	}
})

/** Loads a comment and proves the caller can read its task before returning the row. */
export const findReadableArtifactCommentById = (
	tx: PostgresTransaction,
	commentId: string,
	userInfo: CommentUserInfo,
) =>
	Effect.gen(function* () {
		const comment = yield* tx
			.query(tx.client.select().from(commentRows).where(eq(commentRows.id, commentId)).limit(1))
			.pipe(Effect.map((rows) => rows[0]))
		if (!comment) return yield* Effect.fail(new ArtifactCommentNotFound({ message: 'Comment not found' }))
		yield* requireTaskReadPermissionForArtifactComment(
			tx,
			{ taskId: comment.task_id, userInfo },
			'Comment not found',
		)
		return comment
	})
