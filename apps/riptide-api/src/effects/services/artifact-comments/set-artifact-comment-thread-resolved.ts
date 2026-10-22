import { artifactComments as commentRows } from '@humanlayer/db/tables/artifact-comments'
import { and, eq, inArray } from 'drizzle-orm'
import { Clock, Effect } from 'effect'

import { getTransactionId } from '../postgres/helpers'
import { PostgresDb } from '../postgres/postgres-db.service'
import {
	buildArtifactCommentThreadIndex,
	collectArtifactCommentThreadMemberIds,
	getArtifactCommentRootId,
} from './artifact-comment-threads'
import {
	decodeArtifactCommentInput,
	findReadableArtifactCommentById,
	narrowArtifactCommentDatabaseErrors,
} from './artifact-comments-persistence'
import { SetArtifactCommentThreadResolvedInput } from './artifact-comments-types'

/** Applies one resolution state to every active member of the addressed thread. */
export const setArtifactCommentThreadResolved = Effect.fn('artifact_comments.set_thread_resolved')(function* (
	rawInput: unknown,
) {
	const input = yield* decodeArtifactCommentInput(SetArtifactCommentThreadResolvedInput, rawInput)
	const postgres = yield* PostgresDb
	const now = BigInt(yield* Clock.currentTimeMillis)
	return yield* postgres
		.transaction((tx) =>
			Effect.gen(function* () {
				const comment = yield* findReadableArtifactCommentById(tx, input.commentId, input.userInfo)
				const rows = yield* tx.query(
					tx.client.select().from(commentRows).where(eq(commentRows.artifact_id, comment.artifact_id)),
				)
				const index = buildArtifactCommentThreadIndex(rows)
				const ids = collectArtifactCommentThreadMemberIds(
					getArtifactCommentRootId(comment.id, index.byId),
					index.childrenByParent,
				)
				const active = rows.filter((row) => ids.includes(row.id) && !row.is_deleted)
				if (active.some((row) => row.is_resolved !== input.isResolved))
					yield* tx.query(
						tx.client
							.update(commentRows)
							.set({
								is_resolved: input.isResolved,
								resolved_by_user_id: input.isResolved ? input.userInfo.userId : null,
								updated_at: now,
							})
							.where(
								and(
									inArray(
										commentRows.id,
										active.map((row) => row.id),
									),
									eq(commentRows.artifact_id, comment.artifact_id),
									eq(commentRows.is_deleted, false),
								),
							),
					)
				return {
					success: true as const,
					resolvedCount: active.filter((row) => row.is_resolved !== input.isResolved).length,
					transactionId: yield* getTransactionId(tx),
					postCommitContext: {
						ownerUserId: comment.resource_owner_user_id,
						taskId: comment.task_id,
						artifactId: comment.artifact_id,
					},
				}
			}),
		)
		.pipe(narrowArtifactCommentDatabaseErrors)
})
