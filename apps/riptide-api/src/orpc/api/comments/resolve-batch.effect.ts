import { Effect } from 'effect'

import { ArtifactComments } from '../../../effects/services/artifact-comments/artifact-comments'
import { effectOrpcBaseOrganizationRequired } from '../../effect-base'

export const resolveBatchCommentsProcedure = effectOrpcBaseOrganizationRequired.comments.resolveBatch.effect(
	function* ({ input, context, errors }) {
		const { userId, organizationId } = context.auth
		const artifactComments = yield* ArtifactComments
		const result = yield* artifactComments
			.resolveBatch({
				...input,
				userInfo: { userId, organizationId, createdByAgent: false },
			})
			.pipe(
				Effect.catchTags({
					ArtifactCommentNotFound: (error) =>
						Effect.fail(errors.NOT_FOUND({ data: { message: error.message } })),
					ArtifactCommentInvalid: (error) =>
						Effect.fail(errors.BAD_REQUEST({ data: { message: error.message } })),
					ArtifactCommentInvalidInput: (error) =>
						Effect.fail(errors.BAD_REQUEST({ data: { message: error.message } })),
					ArtifactCommentInvalidRow: () => Effect.fail(errors.INTERNAL_SERVER_ERROR()),
					ArtifactCommentForbidden: (error) =>
						Effect.fail(errors.FORBIDDEN({ data: { message: error.message } })),
					ArtifactCommentIdAmbiguous: (error) =>
						Effect.fail(errors.BAD_REQUEST({ data: { message: error.message } })),
					ArtifactCommentsUnavailable: (error) =>
						Effect.fail(error.retryable ? errors.SERVICE_UNAVAILABLE() : errors.INTERNAL_SERVER_ERROR()),
				}),
			)
		yield* Effect.logInfo('Resolved explicit comment batch').pipe(
			Effect.annotateLogs({
				artifactId: input.artifactId,
				rootCount: new Set(input.rootCommentIds).size,
				resolvedCount: result.resolvedCount,
				userId,
			}),
		)
		return {
			success: result.success,
			transactionId: result.transactionId,
			resolvedCount: result.resolvedCount,
		}
	},
)
