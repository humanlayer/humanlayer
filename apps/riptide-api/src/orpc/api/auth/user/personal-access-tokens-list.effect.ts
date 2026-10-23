import { Effect } from 'effect'

import { listPersonalAccessTokens } from '../../../../auth/personal-access-tokens'
import { Sentry } from '../../../../instrument'
import { effectOrpcBaseOrganizationRequired } from '../../../effect-base'

export const listPersonalAccessTokensProcedure =
	effectOrpcBaseOrganizationRequired.auth.user.personalAccessTokens.list.effect(function* ({ context, errors }) {
		const tokens = yield* listPersonalAccessTokens({
			userId: context.auth.userId,
			workosOrganizationId: context.auth.workosOrganizationId,
		}).pipe(
			Effect.tapError(Effect.logError),
			Effect.tapError((error) => Effect.sync(() => Sentry.captureException(error))),
			Effect.catchTags({
				WorkosAlreadyInvitedError: () => Effect.fail(errors.SERVICE_UNAVAILABLE()),
				WorkosRateLimitError: () => Effect.fail(errors.SERVICE_UNAVAILABLE()),
				WorkosServerError: () => Effect.fail(errors.SERVICE_UNAVAILABLE()),
				WorkosNetworkError: () => Effect.fail(errors.SERVICE_UNAVAILABLE()),
				WorkosClientError: () => Effect.fail(errors.SERVICE_UNAVAILABLE()),
			}),
		)

		return { tokens: [...tokens] }
	})
