import * as Sentry from '@sentry/node'
import { Effect } from 'effect'
import type { Hono } from 'hono'

import type { appRuntime } from '../effects/app-runtime'
import { OnboardingService } from '../effects/services/onboarding/onboarding.service'
import { buildConnectResultUrl } from '../lib/connect-result-url'
import type { IJiraService } from '../lib/jira-service'
import { logger as defaultLogger } from '../logger'

type JiraOAuthCallbackDeps = {
	jiraService: IJiraService
	appRuntime: Pick<typeof appRuntime, 'runFork'>
	logger?: Pick<typeof defaultLogger, 'info' | 'warn' | 'error'>
}

export function registerJiraOAuthCallbackRoute(app: Hono, deps: JiraOAuthCallbackDeps) {
	const routeLogger = deps.logger ?? defaultLogger

	app.get('/integrations/jira/callback', async (c) => {
		const error = c.req.query('error')
		const code = c.req.query('code')
		const state = c.req.query('state')
		const logContext = {
			hasCode: Boolean(code),
			hasState: Boolean(state),
			jiraError: error,
		}

		routeLogger.info(logContext, 'Jira OAuth callback received')

		if (error && !state) {
			routeLogger.warn(logContext, 'Jira OAuth callback returned an error')
			return c.redirect(buildConnectResultUrl({ provider: 'jira', client: 'cloud', status: 'access_denied' }))
		}
		if (!state) {
			routeLogger.warn(logContext, 'Jira OAuth callback missing code or state')
			return c.redirect(buildConnectResultUrl({ provider: 'jira', client: 'cloud', status: 'invalid_link' }))
		}

		let claim: Awaited<ReturnType<IJiraService['consumeInstallState']>>
		try {
			claim = await deps.jiraService.consumeInstallState(state)
		} catch (cause) {
			routeLogger.error({ ...logContext, cause: String(cause) }, 'Jira install-state consume failed')
			Sentry.captureException(cause, { tags: { error_type: 'jira_install_state_consume' } })
			return c.redirect(buildConnectResultUrl({ provider: 'jira', client: 'cloud', status: 'unavailable' }))
		}

		if (!claim) {
			routeLogger.warn(logContext, 'Jira OAuth callback state was invalid, expired, or reused')
			return c.redirect(buildConnectResultUrl({ provider: 'jira', client: 'cloud', status: 'invalid_link' }))
		}

		if (error) {
			routeLogger.warn(
				{ ...logContext, organizationId: claim.organizationId, returnClient: claim.returnClient },
				'Jira OAuth callback returned an error',
			)
			return c.redirect(
				buildConnectResultUrl({ provider: 'jira', client: claim.returnClient, status: 'access_denied' }),
			)
		}
		if (!code) {
			routeLogger.warn(logContext, 'Jira OAuth callback missing code')
			return c.redirect(
				buildConnectResultUrl({ provider: 'jira', client: claim.returnClient, status: 'invalid_link' }),
			)
		}

		try {
			await deps.jiraService.exchangeCode(claim.organizationId, claim.requestedByUserId, code)
		} catch (cause) {
			routeLogger.error(
				{ ...logContext, organizationId: claim.organizationId, cause: String(cause) },
				'Jira OAuth callback exchange failed',
			)
			Sentry.captureException(cause, { tags: { error_type: 'jira_exchange_code' } })
			return c.redirect(
				buildConnectResultUrl({ provider: 'jira', client: claim.returnClient, status: 'auth_failed' }),
			)
		}

		const onboardingSource = 'webhooks.jira.callback'
		deps.appRuntime.runFork(
			Effect.gen(function* () {
				const onboarding = yield* OnboardingService
				yield* onboarding.recordTrackerConnected({
					userId: claim.requestedByUserId,
					organizationId: claim.organizationId,
					provider: 'jira',
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
			'Jira OAuth callback exchange succeeded',
		)
		return c.redirect(buildConnectResultUrl({ provider: 'jira', client: claim.returnClient, status: 'connected' }))
	})
}
