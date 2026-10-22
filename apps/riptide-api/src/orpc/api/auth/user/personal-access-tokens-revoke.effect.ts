import { Effect } from 'effect'

import { revokePersonalAccessToken } from '../../../../auth/personal-access-tokens'
import { Sentry } from '../../../../instrument'
import { effectOrpcBaseOrganizationRequired } from '../../../effect-base'

export const revokePersonalAccessTokenProcedure =
	effectOrpcBaseOrganizationRequired.auth.user.personalAccessTokens.revoke.effect(function* ({
		input,
		context,
		errors,
	}) {
		yield* revokePersonalAccessToken({
			userId: context.auth.userId,
			workosOrganizationId: context.auth.workosOrganizationId,
			id: input.id,
		}).pipe(
			Effect.tapError(Effect.logError),
			Effect.tapError((error) => Effect.sync(() => Sentry.captureException(error))),
			Effect.catchTags({
				PersonalAccessTokenNotFoundError: () =>
					Effect.fail(errors.NOT_FOUND({ data: { message: 'Personal access token not found' } })),
				WorkosAlreadyInvitedError: () => Effect.fail(errors.SERVICE_UNAVAILABLE()),
				WorkosRateLimitError: () => Effect.fail(errors.SERVICE_UNAVAILABLE()),
				WorkosServerError: () => Effect.fail(errors.SERVICE_UNAVAILABLE()),
				WorkosNetworkError: () => Effect.fail(errors.SERVICE_UNAVAILABLE()),
				WorkosClientError: () => Effect.fail(errors.SERVICE_UNAVAILABLE()),
			}),
		)

		return { success: true }
	})
