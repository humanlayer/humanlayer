import { Effect } from 'effect'

import { ArtifactComments } from '../../../effects/services/artifact-comments/artifact-comments'
import { daemonBase, requiresDaemonBillingMiddleware } from '../../base'

export const replyCommentProcedure = daemonBase.comments.reply
	.use(requiresDaemonBillingMiddleware)
	.handler(async ({ input, context, errors }) => {
		const { userId, organizationId } = context.auth
		return context.services.effectRuntime.runPromise(
			Effect.gen(function* () {
				const artifactComments = yield* ArtifactComments
				return yield* artifactComments
					.replyForDaemon({
						...input,
						userInfo: { userId, organizationId, createdByAgent: true },
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
								Effect.fail(
									error.retryable ? errors.SERVICE_UNAVAILABLE() : errors.INTERNAL_SERVER_ERROR(),
								),
						}),
					)
			}),
		)
	})
