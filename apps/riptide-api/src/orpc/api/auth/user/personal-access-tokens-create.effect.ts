import { Effect, Redacted } from 'effect'

import { createPersonalAccessToken } from '../../../../auth/personal-access-tokens'
import { Sentry } from '../../../../instrument'
import { effectOrpcBaseOrganizationRequired } from '../../../effect-base'

export const createPersonalAccessTokenProcedure =
	effectOrpcBaseOrganizationRequired.auth.user.personalAccessTokens.create.effect(function* ({
		input,
		context,
		errors,
	}) {
		const result = yield* createPersonalAccessToken({
			userId: context.auth.userId,
			workosOrganizationId: context.auth.workosOrganizationId,
			name: input.name,
			expiresInDays: input.expiresInDays,
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

		return { token: result.token, value: Redacted.value(result.value) }
	})
