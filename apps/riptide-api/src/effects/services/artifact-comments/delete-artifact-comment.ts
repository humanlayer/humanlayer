import { artifactComments as commentRows } from '@humanlayer/db/tables/artifact-comments'
import { and, eq, inArray } from 'drizzle-orm'
import { Clock, Effect } from 'effect'

import { getTaskWithEffectivePermissions } from '../../../db/task-auth'
import { getTransactionId } from '../postgres/helpers'
import { PostgresDb } from '../postgres/postgres-db.service'
import { buildArtifactCommentThreadIndex, collectArtifactCommentThreadMemberIds } from './artifact-comment-threads'
import { ArtifactCommentForbidden } from './artifact-comments-errors'
import {
	decodeArtifactCommentInput,
	findReadableArtifactCommentById,
	narrowArtifactCommentDatabaseErrors,
} from './artifact-comments-persistence'
import { DeleteArtifactCommentInput } from './artifact-comments-types'

/** Soft-deletes an authored comment, cascading only for V2 root threads. */
export const deleteArtifactComment = Effect.fn('artifact_comments.delete')(function* (rawInput: unknown) {
	const input = yield* decodeArtifactCommentInput(DeleteArtifactCommentInput, rawInput)
	const postgres = yield* PostgresDb
	const now = BigInt(yield* Clock.currentTimeMillis)
	return yield* postgres
		.transaction((tx) =>
			Effect.gen(function* () {
				const comment = yield* findReadableArtifactCommentById(tx, input.commentId, input.userInfo)
				const isPublicComment = comment.created_via_public_share
				if (isPublicComment) {
					const task = yield* tx.run(() =>
						getTaskWithEffectivePermissions(
							tx.client,
							comment.task_id,
							input.userInfo.userId,
							input.userInfo.organizationId,
						),
					)
					if (task?.effectivePermission !== 'edit') {
						return yield* Effect.fail(
							new ArtifactCommentForbidden({
								message: 'Task edit access is required to delete this comment',
							}),
						)
					}
				} else if (comment.created_by_user_id !== input.userInfo.userId || comment.created_by_agent)
					return yield* Effect.fail(
						new ArtifactCommentForbidden({ message: 'Only the comment author can delete' }),
					)
				const rows = yield* tx.query(
					tx.client.select().from(commentRows).where(eq(commentRows.artifact_id, comment.artifact_id)),
				)
				const ids =
					!isPublicComment && comment.reply_to_comment_id === null && comment.anchor_json !== null
						? collectArtifactCommentThreadMemberIds(
								comment.id,
								buildArtifactCommentThreadIndex(rows).childrenByParent,
							)
						: [comment.id]
				yield* tx.query(
					tx.client
						.update(commentRows)
						.set({
							is_deleted: true,
							content_text:
								isPublicComment && comment.reply_to_comment_id === null ? '' : comment.content_text,
							content_json:
								isPublicComment && comment.reply_to_comment_id === null ? null : comment.content_json,
							anchor_json:
								isPublicComment && comment.reply_to_comment_id === null ? null : comment.anchor_json,
							updated_at: now,
						})
						.where(
							and(
								inArray(commentRows.id, ids),
								eq(commentRows.artifact_id, comment.artifact_id),
								eq(commentRows.organization_id, input.userInfo.organizationId),
							),
						),
				)
				return { success: true as const, transactionId: yield* getTransactionId(tx) }
			}),
		)
		.pipe(narrowArtifactCommentDatabaseErrors)
})
