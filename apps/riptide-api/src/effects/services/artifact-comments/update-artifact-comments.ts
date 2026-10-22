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
	findTaskArtifactByFilename,
	narrowArtifactCommentDatabaseErrors,
	requireTaskReadPermissionForArtifactComment,
	resolveArtifactCommentByIdSuffix,
} from './artifact-comments-persistence'
import { UpdateArtifactCommentsForDaemonInput } from './artifact-comments-types'

/** Implements short-ID batch mutation shared by human and daemon service operations. */
export const updateArtifactComments = (rawInput: unknown, options: { readonly markUpdatedByAgent: boolean }) =>
	Effect.gen(function* () {
		const input = yield* decodeArtifactCommentInput(UpdateArtifactCommentsForDaemonInput, rawInput)
		const postgres = yield* PostgresDb
		const now = BigInt(yield* Clock.currentTimeMillis)
		return yield* postgres
			.transaction((tx) =>
				Effect.gen(function* () {
					yield* requireTaskReadPermissionForArtifactComment(tx, input, 'Task not found')
					const found = yield* findTaskArtifactByFilename(
						tx,
						input.taskId,
						input.artifactFilename,
						input.userInfo.organizationId,
					)
					const rows = yield* tx.query(
						tx.client.select().from(commentRows).where(eq(commentRows.artifact_id, found.id)),
					)
					const index = buildArtifactCommentThreadIndex(rows)
					const updated: Array<{ truncatedId: string; commentId: string }> = []
					const failed: Array<{ truncatedId: string; reason: 'not_found' | 'ambiguous' }> = []
					const deletes = new Set<string>()
					const resolutions = new Set<string>()
					for (const truncatedId of input.truncatedCommentIds) {
						const match = resolveArtifactCommentByIdSuffix(rows, truncatedId)
						if (!match) {
							failed.push({ truncatedId, reason: 'not_found' })
							continue
						}
						if (match === 'ambiguous') {
							failed.push({ truncatedId, reason: 'ambiguous' })
							continue
						}
						updated.push({ truncatedId, commentId: match.id })
						if (input.deleted !== undefined) deletes.add(match.id)
						if (input.resolved !== undefined)
							for (const id of collectArtifactCommentThreadMemberIds(
								getArtifactCommentRootId(match.id, index.byId),
								index.childrenByParent,
							))
								if (!index.byId.get(id)?.is_deleted) resolutions.add(id)
					}
					if (input.resolved !== undefined && resolutions.size) {
						const resolutionUpdates: Partial<typeof commentRows.$inferInsert> = {
							is_resolved: input.resolved,
							resolved_by_user_id: input.resolved ? input.userInfo.userId : null,
							updated_at: now,
						}
						if (options.markUpdatedByAgent)
							resolutionUpdates.created_by_agent = input.userInfo.createdByAgent
						yield* tx.query(
							tx.client
								.update(commentRows)
								.set(resolutionUpdates)
								.where(
									and(
										inArray(commentRows.id, [...resolutions]),
										eq(commentRows.artifact_id, found.id),
										eq(commentRows.organization_id, input.userInfo.organizationId),
										eq(commentRows.is_deleted, false),
									),
								),
						)
					}
					if (input.deleted !== undefined && deletes.size) {
						const deletionUpdates: Partial<typeof commentRows.$inferInsert> = {
							is_deleted: input.deleted,
							updated_at: now,
						}
						if (options.markUpdatedByAgent) deletionUpdates.created_by_agent = input.userInfo.createdByAgent
						yield* tx.query(
							tx.client
								.update(commentRows)
								.set(deletionUpdates)
								.where(
									and(
										inArray(commentRows.id, [...deletes]),
										eq(commentRows.artifact_id, found.id),
										eq(commentRows.organization_id, input.userInfo.organizationId),
									),
								),
						)
					}
					return {
						success: updated.length > 0,
						updated,
						failed,
						transactionId: yield* getTransactionId(tx),
					}
				}),
			)
			.pipe(narrowArtifactCommentDatabaseErrors)
	})
