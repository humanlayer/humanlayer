import { commentAuthorColumns, type ArtifactCommentAuthor } from '@humanlayer/db/artifact-comment-author'
import { artifactComments as commentRows } from '@humanlayer/db/tables/artifact-comments'
import { artifactVersions } from '@humanlayer/db/tables/artifact-versions'
import type { ArtifactCommentAnchor } from '@humanlayer/db/zodschemas/artifact-comment-anchor'
import type { CommentKind } from '@humanlayer/db/zodschemas/artifact-comment-kind'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { Effect } from 'effect'
import { uuidv7 } from 'uuidv7'

import type { PostgresTransaction } from '../postgres/postgres-db.service'
import {
	buildArtifactCommentThreadIndex,
	collectArtifactCommentThreadMemberIds,
	getArtifactCommentRootId,
} from './artifact-comment-threads'
import { ArtifactCommentNotFound } from './artifact-comments-errors'

export type ThreadCommentAuthor =
	| { kind: 'user'; userId: string; createdByAgent: boolean }
	| Extract<ArtifactCommentAuthor, { kind: 'guest' }>

export interface InsertThreadCommentInput {
	/** The artifact the comment lands on. Callers pass the resource owner they want stored. */
	artifact: { id: string; organization_id: string; task_id: string; resource_owner_user_id: string }
	author: ThreadCommentAuthor
	id?: string
	contentText: string
	contentJson?: unknown
	anchorJson?: ArtifactCommentAnchor | null
	kind?: CommentKind
	commentedUponBlockText?: string | null
	previousBlockText?: string | null
	nextBlockText?: string | null
	/** Any comment in the thread; the reply attaches to the thread's root. */
	replyToCommentId?: string | null
	/** Refuse to reply when the thread's root is deleted. */
	rejectDeletedRoot?: boolean
	/** The artifact's comment rows, when the caller already loaded them. */
	existingComments?: ReadonlyArray<typeof commentRows.$inferSelect>
	now: bigint
}

/**
 * Inserts a root comment or a reply inside the caller's transaction. A reply attaches to its
 * thread's root and reopens every live comment in the thread. Callers own authorization.
 */
export const insertThreadComment = (tx: PostgresTransaction, input: InsertThreadCommentInput) =>
	Effect.gen(function* () {
		const { artifact, author, now } = input
		let rootId: string | null = null
		if (input.replyToCommentId) {
			const rows =
				input.existingComments ??
				(yield* tx.query(tx.client.select().from(commentRows).where(eq(commentRows.artifact_id, artifact.id))))
			const index = buildArtifactCommentThreadIndex(rows)
			if (!index.byId.has(input.replyToCommentId))
				return yield* Effect.fail(new ArtifactCommentNotFound({ message: 'Parent comment not found' }))
			rootId = getArtifactCommentRootId(input.replyToCommentId, index.byId)
			if (input.rejectDeletedRoot && index.byId.get(rootId)?.is_deleted)
				return yield* Effect.fail(new ArtifactCommentNotFound({ message: 'Parent comment not found' }))
			yield* tx.query(
				tx.client
					.update(commentRows)
					.set({ is_resolved: false, resolved_by_user_id: null, updated_at: now })
					.where(
						and(
							inArray(
								commentRows.id,
								collectArtifactCommentThreadMemberIds(rootId, index.childrenByParent),
							),
							eq(commentRows.artifact_id, artifact.id),
							eq(commentRows.is_deleted, false),
						),
					),
			)
		}
		const [latestVersion] = yield* tx.query(
			tx.client
				.select({ id: artifactVersions.id })
				.from(artifactVersions)
				.where(eq(artifactVersions.artifact_id, artifact.id))
				.orderBy(desc(artifactVersions.version_number))
				.limit(1),
		)
		const commentId = input.id ?? uuidv7()
		yield* tx.query(
			tx.client.insert(commentRows).values({
				id: commentId,
				organization_id: artifact.organization_id,
				resource_owner_user_id: artifact.resource_owner_user_id,
				task_id: artifact.task_id,
				artifact_id: artifact.id,
				...commentAuthorColumns(author),
				created_by_agent: author.kind === 'user' && author.createdByAgent,
				content_text: input.contentText,
				content_json: input.contentJson ?? null,
				commented_upon_block_text: input.commentedUponBlockText ?? null,
				previous_block_text: input.previousBlockText ?? null,
				next_block_text: input.nextBlockText ?? null,
				anchor_json: input.anchorJson ?? null,
				kind: input.kind ?? 'comment',
				created_at_artifact_version_id: latestVersion?.id ?? null,
				reply_to_comment_id: rootId,
				created_at: now,
				updated_at: now,
			}),
		)
		return { commentId, rootId }
	})
