import { Effect } from 'effect'

import { ArtifactComments } from '../../../effects/services/artifact-comments/artifact-comments'
import { effectOrpcBaseOrganizationRequired } from '../../effect-base'

export const getApiCommentsProcedure = effectOrpcBaseOrganizationRequired.comments.get.effect(function* ({
	input,
	context,
	errors,
}) {
	const { userId, organizationId } = context.auth
	const artifactComments = yield* ArtifactComments
	const result = yield* artifactComments
		.list({
			...input,
			userInfo: { userId, organizationId, createdByAgent: false },
		})
		.pipe(
			Effect.catchTags({
				ArtifactCommentNotFound: (error) => {
					const data: { message: string } = { message: error.message }
					if (!error.validArtifacts) return Effect.fail(errors.NOT_FOUND({ data }))
					return Effect.fail(
						errors.NOT_FOUND({
							data: { ...data, validArtifacts: [...error.validArtifacts] },
						}),
					)
				},
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
	return { ...result, comments: [...result.comments] }
})
