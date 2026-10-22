import { artifactComments as commentRows } from '@humanlayer/db/tables/artifact-comments'
import { eq } from 'drizzle-orm'
import { Clock, Effect } from 'effect'

import { recordFirstInboundReviewComment } from '../onboarding/onboarding-milestones'
import { getTransactionId } from '../postgres/helpers'
import { PostgresDb } from '../postgres/postgres-db.service'
import { ArtifactCommentIdAmbiguous, ArtifactCommentNotFound } from './artifact-comments-errors'
import {
	decodeArtifactCommentInput,
	findTaskArtifactByFilename,
	narrowArtifactCommentDatabaseErrors,
	requireTaskReadPermissionForArtifactCommentWrite,
	resolveArtifactCommentByIdSuffix,
} from './artifact-comments-persistence'
import { ReplyToArtifactCommentInput } from './artifact-comments-types'
import { insertThreadComment } from './insert-thread-comment'

/** Resolves a daemon short ID, reopens its thread, and appends a root-normalized reply. */
export const replyToArtifactComment = Effect.fn('artifact_comments.reply')(function* (rawInput: unknown) {
	const input = yield* decodeArtifactCommentInput(ReplyToArtifactCommentInput, rawInput)
	const postgres = yield* PostgresDb
	const now = BigInt(yield* Clock.currentTimeMillis)
	return yield* postgres
		.transaction((tx) =>
			Effect.gen(function* () {
				const task = yield* requireTaskReadPermissionForArtifactCommentWrite(tx, input, 'Task not found')
				const found = yield* findTaskArtifactByFilename(
					tx,
					input.taskId,
					input.artifactFilename,
					input.userInfo.organizationId,
				)
				const resourceOwnerUserId = task.resource_owner_user_id ?? found.resource_owner_user_id
				const rows = yield* tx.query(
					tx.client.select().from(commentRows).where(eq(commentRows.artifact_id, found.id)),
				)
				const match = resolveArtifactCommentByIdSuffix(rows, input.truncatedCommentId)
				if (!match)
					return yield* Effect.fail(new ArtifactCommentNotFound({ message: 'Parent comment not found' }))
				if (match === 'ambiguous')
					return yield* Effect.fail(
						new ArtifactCommentIdAmbiguous({ message: 'Ambiguous comment ID - multiple matches' }),
					)
				const { commentId, rootId } = yield* insertThreadComment(tx, {
					artifact: {
						id: found.id,
						organization_id: input.userInfo.organizationId,
						task_id: input.taskId,
						resource_owner_user_id: resourceOwnerUserId,
					},
					author: {
						kind: 'user',
						userId: input.userInfo.userId,
						createdByAgent: input.userInfo.createdByAgent,
					},
					id: input.id,
					contentText: input.contentText,
					replyToCommentId: match.id,
					existingComments: rows,
					now,
				})
				yield* recordFirstInboundReviewComment(tx, {
					ownerUserId: found.resource_owner_user_id,
					organizationId: found.organization_id,
					commenterUserId: input.userInfo.userId,
					createdByAgent: input.userInfo.createdByAgent,
					frontmatterType:
						typeof found.frontmatter?.type === 'string' ? (found.frontmatter.type as string) : undefined,
					fileName: found.file_name,
					now,
				})
				return {
					success: true as const,
					commentId,
					parentCommentId: rootId ?? match.id,
					transactionId: yield* getTransactionId(tx),
				}
			}),
		)
		.pipe(narrowArtifactCommentDatabaseErrors)
})
