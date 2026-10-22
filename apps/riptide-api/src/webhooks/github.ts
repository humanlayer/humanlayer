import { Cause, Effect, Exit, Option, Predicate } from 'effect'
import type { Hono } from 'hono'

import type { appRuntime } from '../effects/app-runtime'
import { GitHubService } from '../effects/services/github/github.service'
import { logger as defaultLogger } from '../logger'

type GitHubSetupCallbackDependencies = {
	readonly appRuntime: typeof appRuntime
	readonly logger?: Pick<typeof defaultLogger, 'info' | 'warn' | 'error'>
}

type GitHubCallbackDecision =
	| { readonly result: 'connected' }
	| { readonly result: 'unclaimed' }
	| { readonly result: 'failed'; readonly reason: 'invalid_link' | 'conflict' | 'unavailable' }

export function registerGitHubSetupCallbackRoute(app: Hono, dependencies: GitHubSetupCallbackDependencies) {
	const routeLogger = dependencies.logger ?? defaultLogger

	app.get('/integrations/github/callback', async (context) => {
		const installationId = context.req.query('installation_id')
		const state = context.req.query('state')
		const cloudOrigin = process.env.CLOUD_ORIGIN ?? 'http://localhost:5174'
		const logContext = { hasInstallationId: Boolean(installationId), hasState: Boolean(state) }

		if (!installationId || !/^\d+$/.test(installationId)) {
			routeLogger.warn(logContext, 'GitHub setup callback missing a valid installation ID')
			return context.redirect(`${cloudOrigin}/settings?github_error=invalid_link`)
		}

		try {
			const decision = await dependencies.appRuntime.runPromise(
				Effect.gen(function* () {
					const github = yield* GitHubService
					const completionInput: { installationId: string; state?: string } = { installationId }
					if (state) completionInput.state = state
					return yield* github.completeInstallation(completionInput).pipe(
						Effect.map((completion): GitHubCallbackDecision => ({ result: completion.result })),
						Effect.catchTags({
							GitHubInstallStateInvalidError: () =>
								Effect.succeed({ result: 'failed', reason: 'invalid_link' } as const),
							GitHubConnectionConflictError: () =>
								Effect.succeed({ result: 'failed', reason: 'conflict' } as const),
							GitHubIntegrationUnavailableError: () =>
								Effect.succeed({ result: 'failed', reason: 'unavailable' } as const),
						}),
					)
				}),
			)

			routeLogger.info({ ...logContext, result: decision.result }, 'GitHub setup callback completed')
			if (decision.result === 'connected') return context.redirect(`${cloudOrigin}/settings?github=connected`)
			if (decision.result === 'unclaimed') return context.redirect(`${cloudOrigin}/settings?github=unclaimed`)
			return context.redirect(`${cloudOrigin}/settings?github_error=${decision.reason}`)
		} catch (cause) {
			routeLogger.error({ ...logContext, cause }, 'GitHub setup callback failed unexpectedly')
			return context.redirect(`${cloudOrigin}/settings?github_error=unavailable`)
		}
	})
}

type GitHubWebhookDependencies = {
	readonly appRuntime: typeof appRuntime
	readonly logger: Pick<typeof defaultLogger, 'info' | 'warn' | 'error'>
}

/**
 * Maps a verification failure to the HTTP status the route returns. A missing/invalid
 * `X-Hub-Signature-256` is unauthenticated (`401`); an authentic-but-unparseable payload is a
 * client error (`400`). A defect (no typed `Fail`) also maps to `400` — anything non-2xx is
 * not an acknowledgement, so GitHub treats it as rejected either way. Mirrors the Slack route
 * mapper: this is the one place `_tag` equality is allowed.
 */
function statusForGitHubVerificationFailure(cause: Cause.Cause<unknown>): { status: 400 | 401; errorTag: string } {
	const error = Option.getOrUndefined(Cause.findErrorOption(cause))
	if (!error || typeof error !== 'object' || !('_tag' in error) || typeof error._tag !== 'string') {
		return { status: 400, errorTag: 'UnknownError' }
	}
	const status: 400 | 401 = Predicate.isTagged(error, 'GitHubWebhookMalformedRequestError') ? 400 : 401
	return { status, errorTag: error._tag }
}

/**
 * `POST /webhooks/github` — the signed GitHub App webhook endpoint.
 *
 * GitHub automatically delivers `installation` and `installation_repositories` events. This
 * route follows the verify-before-ACK shape (mirroring `webhooks/slack.ts`): it reads the exact
 * raw body first (the HMAC is bound to those bytes), synchronously verifies the signature and
 * parses the envelope through the runtime, maps typed verification failures to `400`/`401`, and
 * only forks the total `Effect<void, never>` handler on success — so the `202` acknowledgement
 * is immune to the reconciliation outcome and GitHub does not retry a processing failure.
 */
export function registerGitHubWebhookRoute(app: Hono, dependencies: GitHubWebhookDependencies) {
	app.post('/webhooks/github', async (context) => {
		// Raw body BEFORE any parse — the signature is bound to these exact bytes.
		const rawBody = await context.req.raw.text()

		const verification = await dependencies.appRuntime.runPromiseExit(
			Effect.gen(function* () {
				const github = yield* GitHubService
				return yield* github.verifyWebhook({ rawBody, headers: context.req.raw.headers })
			}),
		)

		if (Exit.isFailure(verification)) {
			const { status, errorTag } = statusForGitHubVerificationFailure(verification.cause)
			dependencies.logger.warn({ status, error: errorTag }, 'GitHub webhook verification failed')
			return context.json({ error: 'invalid_request' }, status)
		}

		// Detached, best-effort: `handleWebhook` has a `never` error channel and captures its own
		// defects, so the fork can never block or fail the acknowledgement.
		dependencies.appRuntime.runFork(
			Effect.gen(function* () {
				const github = yield* GitHubService
				yield* github.handleWebhook(verification.value)
			}),
		)

		return context.json({ ok: true }, 202)
	})
}
