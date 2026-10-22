import { Effect } from 'effect'

import { AccessRequestService } from '../../../../effects/services/access-request/access-request.service'
import { Sentry } from '../../../../instrument'
import { effectOrpcBasePublic } from '../../../effect-base'

/**
 * Public access-request creation.
 *
 * The entire request flow — requester-email resolution (authoritative WorkOS email for
 * authed callers, client-supplied email for anonymous callers), the anti-enumeration
 * membership guardrail, and the insert/reopen + admin-notification fan-out — lives behind
 * `AccessRequestService.requestArtifactAccess` (the deep access-request runtime service).
 * This procedure only translates the service's domain errors into contract errors; it
 * never sees `AccessRequestDbError` or WorkOS transport errors directly.
 */
export const createAccessRequestProcedure = effectOrpcBasePublic.public.accessRequests.create.effect(function* ({
	input,
	context,
	errors,
}) {
	const accessRequests = yield* AccessRequestService
	const authUserId = context.auth?.userId ?? null

	yield* Effect.annotateCurrentSpan({ artifact_id: input.artifactId, auth_user_id: authUserId })

	const result = yield* accessRequests
		.requestArtifactAccess({
			artifactId: input.artifactId,
			authUserId,
			submittedEmail: input.email,
		})
		.pipe(
			Effect.withSpan('access_requests.request_artifact_access', {
				attributes: { artifact_id: input.artifactId, auth_user_id: authUserId },
			}),
			Effect.tapError((error) => Effect.logError(error)),
			Effect.tapError((error) => Effect.sync(() => Sentry.captureException(error))),
			Effect.catchTags({
				AccessRequestValidationError: (error) =>
					Effect.fail(errors.BAD_REQUEST({ data: { message: error.message } })),
				AlreadyRequestedAccessError: (error) =>
					Effect.fail(
						errors.ALREADY_REQUESTED_ACCESS({
							data: {
								message: `You can request access again after ${error.retryAfter.toISOString()}`,
								retryAfter: error.retryAfter.toISOString(),
								existingRequestStatus: error.existingRequestStatus,
							},
						}),
					),
				FeatureDisabledError: (error) =>
					Effect.fail(errors.FEATURE_DISABLED({ data: { message: error.message } })),
				AccessRequestUnavailableError: () => Effect.fail(errors.SERVICE_UNAVAILABLE()),
			}),
		)

	yield* Effect.logInfo('Access request submitted').pipe(
		Effect.annotateLogs({
			artifactId: input.artifactId,
			authUserId,
			accessRequestId: result.accessRequestId,
			alreadyInvited: result.alreadyInvited,
		}),
	)

	return result
})
