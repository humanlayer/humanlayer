import { artifactComments as commentRows } from '@humanlayer/db/tables/artifact-comments'
import { and, eq } from 'drizzle-orm'
import { Clock, Effect } from 'effect'

import { getTransactionId } from '../postgres/helpers'
import { PostgresDb } from '../postgres/postgres-db.service'
import {
	decodeArtifactCommentInput,
	narrowArtifactCommentDatabaseErrors,
	requireTaskReadPermissionForArtifactComment,
} from './artifact-comments-persistence'
import { ResolveAllArtifactCommentsInput } from './artifact-comments-types'

/** Resolves every active comment for an artifact after proving task access. */
export const resolveAllArtifactComments = Effect.fn('artifact_comments.resolve_all')(function* (rawInput: unknown) {
	const input = yield* decodeArtifactCommentInput(ResolveAllArtifactCommentsInput, rawInput)
	const postgres = yield* PostgresDb
	const now = BigInt(yield* Clock.currentTimeMillis)
	return yield* postgres
		.transaction((tx) =>
			Effect.gen(function* () {
				const sample = yield* tx
					.query(
						tx.client
							.select()
							.from(commentRows)
							.where(eq(commentRows.artifact_id, input.artifactId))
							.limit(1),
					)
					.pipe(Effect.map((rows) => rows[0]))
				if (!sample)
					return { success: true as const, resolvedCount: 0, transactionId: yield* getTransactionId(tx) }
				yield* requireTaskReadPermissionForArtifactComment(
					tx,
					{ taskId: sample.task_id, userInfo: input.userInfo },
					'Artifact not found',
				)
				const changed = yield* tx.query(
					tx.client
						.update(commentRows)
						.set({ is_resolved: true, resolved_by_user_id: input.userInfo.userId, updated_at: now })
						.where(
							and(
								eq(commentRows.artifact_id, input.artifactId),
								eq(commentRows.organization_id, input.userInfo.organizationId),
								eq(commentRows.is_resolved, false),
								eq(commentRows.is_deleted, false),
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
