import { artifactComments as commentRows } from '@humanlayer/db/tables/artifact-comments'
import { and, eq, inArray } from 'drizzle-orm'
import { Clock, Effect } from 'effect'

import { getTransactionId } from '../postgres/helpers'
import { PostgresDb } from '../postgres/postgres-db.service'
import { buildArtifactCommentThreadIndex, collectArtifactCommentThreadMemberIds } from './artifact-comment-threads'
import { ArtifactCommentNotFound } from './artifact-comments-errors'
import {
	decodeArtifactCommentInput,
	narrowArtifactCommentDatabaseErrors,
	requireTaskReadPermissionForArtifactComment,
} from './artifact-comments-persistence'
import { ResolveArtifactCommentsInput } from './artifact-comments-types'

/** Resolves explicit V2 root threads and all of their active descendants. */
export const resolveArtifactComments = Effect.fn('artifact_comments.resolve_batch')(function* (rawInput: unknown) {
	const input = yield* decodeArtifactCommentInput(ResolveArtifactCommentsInput, rawInput)
	const postgres = yield* PostgresDb
	const now = BigInt(yield* Clock.currentTimeMillis)
	const rootIds = [...new Set(input.rootCommentIds)]
	return yield* postgres
		.transaction((tx) =>
			Effect.gen(function* () {
				const roots = yield* tx.query(
					tx.client.select().from(commentRows).where(inArray(commentRows.id, rootIds)),
				)
				if (
					roots.length !== rootIds.length ||
					roots.some(
						(row) =>
							row.reply_to_comment_id !== null ||
							row.artifact_id !== input.artifactId ||
							row.anchor_json === null,
					)
				)
					return yield* Effect.fail(new ArtifactCommentNotFound({ message: 'Comment not found' }))
				const sample = roots[0]
				if (!sample)
					return { success: true as const, resolvedCount: 0, transactionId: yield* getTransactionId(tx) }
				yield* requireTaskReadPermissionForArtifactComment(
					tx,
					{ taskId: sample.task_id, userInfo: input.userInfo },
					'Comment not found',
				)
				const rows = yield* tx.query(
					tx.client.select().from(commentRows).where(eq(commentRows.artifact_id, input.artifactId)),
				)
				const index = buildArtifactCommentThreadIndex(rows)
				const ids = [
					...new Set(
						rootIds.flatMap((id) => collectArtifactCommentThreadMemberIds(id, index.childrenByParent)),
					),
				]
				const changed = yield* tx.query(
					tx.client
						.update(commentRows)
						.set({ is_resolved: true, resolved_by_user_id: input.userInfo.userId, updated_at: now })
						.where(
							and(
								inArray(commentRows.id, ids),
								eq(commentRows.artifact_id, input.artifactId),
								eq(commentRows.is_deleted, false),
								eq(commentRows.is_resolved, false),
							),
						)
						.returning({ id: commentRows.id }),
				)
				return {
					success: true as const,
					resolvedCount: changed.length,
					transactionId: yield* getTransactionId(tx),
					postCommitContext: {
						ownerUserId: sample.resource_owner_user_id,
						taskId: sample.task_id,
						artifactId: input.artifactId,
					},
				}
			}),
		)
		.pipe(narrowArtifactCommentDatabaseErrors)
})
