import { Cause, Effect, Exit, Option, Predicate } from 'effect'
import type { Hono } from 'hono'

import type { appRuntime } from '../effects/app-runtime'
import { SlackService } from '../effects/services/slack/slack.service'
import { logger as defaultLogger } from '../logger'

type SlackOAuthCallbackDeps = {
	appRuntime: typeof appRuntime
	logger?: Pick<typeof defaultLogger, 'info' | 'warn' | 'error'>
}

export function registerSlackOAuthCallbackRoute(app: Hono, deps: SlackOAuthCallbackDeps) {
	const routeLogger = deps.logger ?? defaultLogger

	app.get('/integrations/slack/callback', async (c) => {
		const error = c.req.query('error')
		const code = c.req.query('code')
		const state = c.req.query('state')
		const cloudOrigin = process.env.CLOUD_ORIGIN ?? 'http://localhost:5174'
		const logContext = {
			hasCode: Boolean(code),
			hasState: Boolean(state),
			slackError: error,
		}

		routeLogger.info(logContext, 'Slack OAuth callback received')

		if (error) {
			routeLogger.warn(logContext, 'Slack OAuth callback returned an error')
			return c.redirect(`${cloudOrigin}/settings?slack_error=auth_failed`)
		}
		if (!code || !state) {
			routeLogger.warn(logContext, 'Slack OAuth callback missing code or state')
			return c.redirect(`${cloudOrigin}/settings?slack_error=invalid_link`)
		}

		const result = await deps.appRuntime.runPromiseExit(
			Effect.gen(function* () {
				const slack = yield* SlackService
				return yield* slack.exchangeCode({ code, state })
			}),
		)

		if (Exit.isSuccess(result)) {
			routeLogger.info(
				{ ...logContext, teamName: result.value.teamName },
				'Slack OAuth callback exchange succeeded',
			)
			return c.redirect(`${cloudOrigin}/settings?slack=connected`)
		}

		routeLogger.error(
			{ ...logContext, effectCausePretty: Cause.pretty(result.cause), cause: String(result.cause) },
			'Slack OAuth callback exchange failed',
		)

		const failure = String(result.cause)
		const reason = failure.includes('SlackInstallStateInvalidError')
			? 'invalid_link'
			: failure.includes('SlackOAuthError')
				? 'auth_failed'
				: 'unavailable'
		return c.redirect(`${cloudOrigin}/settings?slack_error=${reason}`)
	})
}

type SlackInteractionsDeps = {
	appRuntime: typeof appRuntime
	logger: Pick<typeof defaultLogger, 'info' | 'warn' | 'error'>
}

/**
 * Maps a verification failure to the HTTP status the route returns. Bad or missing
 * signature and stale/missing timestamp are unauthenticated (`401`); an authentic but
 * malformed payload is a client error (`400`). An unexpected defect (no typed `Fail`
 * reason) also maps to `400` — anything non-200 is *not* an ACK, so Slack treats it as
 * rejected either way.
 */
function statusForVerificationFailure(cause: Cause.Cause<unknown>): { status: 400 | 401; errorTag: string } {
	const error = Option.getOrUndefined(Cause.findErrorOption(cause))
	// A defect (die) surfaces no typed failure, so `error` is undefined; treat it as a
	// non-200 rejection with a 400 (anything non-200 is not an ACK either way).
	if (!error || typeof error !== 'object' || !('_tag' in error) || typeof error._tag !== 'string') {
		return { status: 400, errorTag: 'UnknownError' }
	}
	// Bad/missing signature and stale/missing timestamp → 401 (unauthenticated); an
	// authentic-but-malformed payload → 400 (client error).
	const status: 400 | 401 = Predicate.isTagged(error, 'SlackWebhookMalformedRequestError') ? 400 : 401
	return { status, errorTag: error._tag }
}

/**
 * `POST /webhooks/slack/interactions` — the Slack interactivity request endpoint.
 *
 * Slack sends a signed `application/x-www-form-urlencoded` POST for every interactive
 * component click (even URL-only buttons). This route verifies the request came from
 * Slack, then ACKs `200` within Slack's 3-second window. It follows the verify-before-ACK
 * webhook shape (`webhooks/stripe.ts`) but bridges verification through Effect and forks
 * the handler so the ACK is immune to processing outcome (Option C):
 *
 *   1. Read the raw body *before* any parse (`await c.req.raw.text()`), so the signature is
 *      checked against the exact delivered bytes.
 *   2. `runPromiseExit(verifyInteractionRequest(...))` and branch on the typed `Exit`.
 *   3. On failure: map the tagged error to `401`/`400`, `warn`-log via the injected logger
 *      (no Sentry — verification rejections are attacker-triggerable and would be noise),
 *      and return non-200 (not an ACK).
 *   4. On success: `runFork(handleInteractionPayload(...))` (detached; the module owns the
 *      verified-interaction structured log line and defect Sentry capture) and ACK `200`.
 */
export function registerSlackInteractionsRoute(app: Hono, deps: SlackInteractionsDeps) {
	app.post('/webhooks/slack/interactions', async (c) => {
		// Raw body BEFORE any parse — the signature is bound to these exact bytes, so
		// calling parseBody()/formData()/json()/URLSearchParams first would break verification.
		const rawBody = await c.req.raw.text()

		const exit = await deps.appRuntime.runPromiseExit(
			Effect.gen(function* () {
				const slack = yield* SlackService
				return yield* slack.verifyInteractionRequest({ rawBody, headers: c.req.raw.headers })
			}),
		)

		if (Exit.isFailure(exit)) {
			const { status, errorTag } = statusForVerificationFailure(exit.cause)
			deps.logger.warn({ status, error: errorTag }, 'Slack interaction verification failed')
			return c.json({ error: 'invalid_request' }, status)
		}

		// Detached, best-effort: `handleInteractionPayload` has a `never` error channel and
		// captures its own defects, so the fork can never block or fail the ACK.
		deps.appRuntime.runFork(
			Effect.gen(function* () {
				const slack = yield* SlackService
				yield* slack.handleInteractionPayload(exit.value)
			}),
		)

		return c.json({ ok: true })
	})
}
