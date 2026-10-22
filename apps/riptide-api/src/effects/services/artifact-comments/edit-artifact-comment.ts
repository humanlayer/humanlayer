import { artifactComments as commentRows } from '@humanlayer/db/tables/artifact-comments'
import { and, eq } from 'drizzle-orm'
import { Clock, Effect } from 'effect'

import { getTransactionId } from '../postgres/helpers'
import { PostgresDb } from '../postgres/postgres-db.service'
import { ArtifactCommentForbidden, ArtifactCommentNotFound } from './artifact-comments-errors'
import {
	decodeArtifactCommentInput,
	findReadableArtifactCommentById,
	narrowArtifactCommentDatabaseErrors,
} from './artifact-comments-persistence'
import { EditArtifactCommentInput } from './artifact-comments-types'

/** Edits a readable, live human-authored comment within one transaction. */
export const editArtifactComment = Effect.fn('artifact_comments.edit')(function* (rawInput: unknown) {
	const input = yield* decodeArtifactCommentInput(EditArtifactCommentInput, rawInput)
	const postgres = yield* PostgresDb
	const now = BigInt(yield* Clock.currentTimeMillis)
	return yield* postgres
		.transaction((tx) =>
			Effect.gen(function* () {
				const comment = yield* findReadableArtifactCommentById(tx, input.commentId, input.userInfo)
				if (comment.is_deleted)
					return yield* Effect.fail(new ArtifactCommentNotFound({ message: 'Comment not found' }))
				if (comment.created_by_user_id !== input.userInfo.userId || comment.created_by_agent)
					return yield* Effect.fail(
						new ArtifactCommentForbidden({ message: 'Only the comment author can edit' }),
					)
				yield* tx.query(
					tx.client
						.update(commentRows)
						.set({
							content_text: input.contentText,
							content_json: input.contentJson ?? null,
							updated_at: now,
						})
						.where(
							and(
								eq(commentRows.id, comment.id),
								eq(commentRows.organization_id, input.userInfo.organizationId),
							),
						),
				)
				return { success: true as const, transactionId: yield* getTransactionId(tx) }
			}),
		)
		.pipe(narrowArtifactCommentDatabaseErrors)
})
