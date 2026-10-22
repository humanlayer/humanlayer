import * as Sentry from '@sentry/node'
import { Effect } from 'effect'

import { ArtifactComments } from '../../../effects/services/artifact-comments/artifact-comments'
import { OnboardingService } from '../../../effects/services/onboarding/onboarding.service'
import { apiBaseOrgRequired } from '../../base'

export const resolveCommentProcedure = apiBaseOrgRequired.comments.resolve.handler(
	async ({ input, context, errors }) => {
		const { userId, organizationId } = context.auth
		return context.services.effectRuntime.runPromise(
			Effect.gen(function* () {
				const artifactComments = yield* ArtifactComments
				const result = yield* artifactComments
					.setThreadResolved({
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

				if (input.isResolved && result.postCommitContext) {
					const postCommitContext = result.postCommitContext
					yield* Effect.gen(function* () {
						const onboarding = yield* OnboardingService
						yield* onboarding.recordDesignDocInboundCommentResolved({
							ownerUserId: postCommitContext.ownerUserId,
							resolverUserId: userId,
							commentId: input.commentId,
							artifactId: postCommitContext.artifactId,
							taskId: postCommitContext.taskId,
							isResolved: true,
						})
					}).pipe(
						Effect.catch((error) =>
							Effect.sync(() =>
								Sentry.captureException(error, {
									tags: { error_type: 'onboarding_detached_failure', source: 'api.comments.resolve' },
									extra: {
										ownerUserId: postCommitContext.ownerUserId,
										resolverUserId: userId,
										artifactId: postCommitContext.artifactId,
										source: 'api.comments.resolve',
									},
								}),
							),
						),
					)
				}

				return { success: result.success, transactionId: result.transactionId }
			}),
		)
	},
)
