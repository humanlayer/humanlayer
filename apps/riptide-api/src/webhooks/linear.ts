import * as Sentry from '@sentry/node'
import { Effect } from 'effect'
import type { Hono } from 'hono'

import type { appRuntime } from '../effects/app-runtime'
import { OnboardingService } from '../effects/services/onboarding/onboarding.service'
import { buildConnectResultUrl } from '../lib/connect-result-url'
import type { ILinearService } from '../lib/linear-service'
import { logger as defaultLogger } from '../logger'

type LinearOAuthCallbackDeps = {
	linearService: ILinearService
	appRuntime: Pick<typeof appRuntime, 'runFork'>
	logger?: Pick<typeof defaultLogger, 'info' | 'warn' | 'error'>
}

/**
 * `GET /integrations/linear/callback` — where Linear's OAuth round trip terminates.
 *
 * Modelled on `registerSlackOAuthCallbackRoute`: every branch ends in `c.redirect`, the
 * route never renders and never throws to the client. No browser session is consulted — the
 * one-time install-state row is the authorization, which is what lets an unauthenticated
 * browser complete a connect instead of parking on a spinner.
 */
export function registerLinearOAuthCallbackRoute(app: Hono, deps: LinearOAuthCallbackDeps) {
	const routeLogger = deps.logger ?? defaultLogger

	app.get('/integrations/linear/callback', async (c) => {
		const error = c.req.query('error')
		const code = c.req.query('code')
		const state = c.req.query('state')
		const logContext = {
			hasCode: Boolean(code),
			hasState: Boolean(state),
			linearError: error,
		}

		routeLogger.info(logContext, 'Linear OAuth callback received')

		if (error && !state) {
			routeLogger.warn(logContext, 'Linear OAuth callback returned an error')
			return c.redirect(buildConnectResultUrl({ provider: 'linear', client: 'cloud', status: 'access_denied' }))
		}
		if (!state) {
			routeLogger.warn(logContext, 'Linear OAuth callback missing code or state')
			return c.redirect(buildConnectResultUrl({ provider: 'linear', client: 'cloud', status: 'invalid_link' }))
		}

		let claim: Awaited<ReturnType<ILinearService['consumeInstallState']>>
		try {
			claim = await deps.linearService.consumeInstallState(state)
		} catch (cause) {
			routeLogger.error({ ...logContext, cause: String(cause) }, 'Linear install-state consume failed')
			Sentry.captureException(cause, { tags: { error_type: 'linear_install_state_consume' } })
			return c.redirect(buildConnectResultUrl({ provider: 'linear', client: 'cloud', status: 'unavailable' }))
		}

		// Unknown, expired, or already-consumed state. Rejected before Linear is ever called.
		if (!claim) {
			routeLogger.warn(logContext, 'Linear OAuth callback state was invalid, expired, or reused')
			return c.redirect(buildConnectResultUrl({ provider: 'linear', client: 'cloud', status: 'invalid_link' }))
		}

		if (error) {
			routeLogger.warn(
				{ ...logContext, organizationId: claim.organizationId, returnClient: claim.returnClient },
				'Linear OAuth callback returned an error',
			)
			return c.redirect(
				buildConnectResultUrl({ provider: 'linear', client: claim.returnClient, status: 'access_denied' }),
			)
		}
		if (!code) {
			routeLogger.warn(logContext, 'Linear OAuth callback missing code')
			return c.redirect(
				buildConnectResultUrl({ provider: 'linear', client: claim.returnClient, status: 'invalid_link' }),
			)
		}

		try {
			await deps.linearService.exchangeCode(claim.organizationId, claim.requestedByUserId, code)
		} catch (cause) {
			routeLogger.error(
				{ ...logContext, organizationId: claim.organizationId, cause: String(cause) },
				'Linear OAuth callback exchange failed',
			)
			Sentry.captureException(cause, { tags: { error_type: 'linear_exchange_code' } })
			return c.redirect(
				buildConnectResultUrl({ provider: 'linear', client: claim.returnClient, status: 'auth_failed' }),
			)
		}

		// Fire-and-forget onboarding "tracker connected" milestone. A successful exchange is
		// the proof, so the milestone lives here rather than on the procedure that only minted
		// a URL. Failures are swallowed to Sentry and never affect the redirect.
		const onboardingSource = 'webhooks.linear.callback'
		deps.appRuntime.runFork(
			Effect.gen(function* () {
				const onboarding = yield* OnboardingService
				yield* onboarding.recordTrackerConnected({
					userId: claim.requestedByUserId,
					organizationId: claim.organizationId,
					provider: 'linear',
					integrationId: claim.organizationId,
				})
			}).pipe(
				Effect.catch((err) =>
					Effect.sync(() => {
						Sentry.captureException(err, {
							tags: { error_type: 'onboarding_detached_failure', source: onboardingSource },
							extra: {
								userId: claim.requestedByUserId,
								organizationId: claim.organizationId,
								source: onboardingSource,
							},
						})
					}),
				),
			),
		)

		routeLogger.info(
			{ ...logContext, organizationId: claim.organizationId, returnClient: claim.returnClient },
			'Linear OAuth callback exchange succeeded',
		)
		return c.redirect(
			buildConnectResultUrl({ provider: 'linear', client: claim.returnClient, status: 'connected' }),
		)
	})
}
