import { Effect } from 'effect'

import { ArtifactComments } from '../../../effects/services/artifact-comments/artifact-comments'
import { apiBaseOrgRequired } from '../../base'

export const createCommentProcedure = apiBaseOrgRequired.comments.create.handler(async ({ input, context, errors }) => {
	const { userId, organizationId } = context.auth
	return context.services.effectRuntime.runPromise(
		Effect.gen(function* () {
			const artifactComments = yield* ArtifactComments
			const result = yield* artifactComments
				.create({
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
							Effect.fail(
								error.retryable ? errors.SERVICE_UNAVAILABLE() : errors.INTERNAL_SERVER_ERROR(),
							),
					}),
				)
			return { success: result.success, commentId: result.commentId, transactionId: result.transactionId }
		}),
	)
})
