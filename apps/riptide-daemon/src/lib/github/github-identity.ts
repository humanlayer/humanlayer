import { Data, Effect } from 'effect'

import { Sentry } from '@/instrument'
import type { ORPCClient } from '@/orpc/client'

import { GithubAccess } from './github-access.service'

/** The setGithubIdentity report itself failed (network/API) — the actionable failure here. */
class GithubIdentityReportError extends Data.TaggedError('GithubIdentityReportError')<{
	cause: unknown
}> {}

/**
 * Capture the daemon operator's own GitHub identity from their authenticated GitHub
 * credential (gh CLI, or an env token when gh is absent), once at startup, and report
 * it to the API (`users.setGithubIdentity`). The WorkOS user and org are taken from the
 * daemon token server-side — this call only supplies the GitHub login/id/email mapping.
 *
 * Best-effort (`Effect<void, never>`): a missing/unauthenticated credential is expected
 * control flow (debug skip — this doubles as the process's GitHub auth probe), while a
 * failed identity upsert is captured (log + Sentry) then swallowed. The upsert makes
 * repeated calls harmless.
 */
export const captureGithubIdentity = (orpc: ORPCClient): Effect.Effect<void, never, GithubAccess> =>
	Effect.gen(function* () {
		const github = yield* GithubAccess
		const { login, id, email } = yield* github.fetchViewer()

		if (typeof login !== 'string' || login.length === 0 || (typeof id !== 'number' && typeof id !== 'string')) {
			yield* Effect.logWarning('GitHub viewer returned no usable login/id; skipping GitHub identity capture')
			return
		}

		yield* Effect.tryPromise({
			try: () =>
				orpc.users.setGithubIdentity({
					login,
					externalId: String(id),
					email: typeof email === 'string' && email.length > 0 ? email : undefined,
				}),
			catch: (cause) => new GithubIdentityReportError({ cause }),
		})
		yield* Effect.logInfo('Captured GitHub identity').pipe(Effect.annotateLogs({ login }))
	}).pipe(
		// Expected control flow: no backend / dead credential / transient — skip quietly.
		Effect.catchTags({
			GithubUnavailableError: () => Effect.logDebug('Skipping GitHub identity capture: no GitHub backend'),
			GithubAuthError: () => Effect.logDebug('Skipping GitHub identity capture: GitHub auth broken'),
			GithubRequestError: () => Effect.logDebug('Skipping GitHub identity capture: transient GitHub error'),
		}),
		// The report itself failed (or a defect): capture, then swallow — never fail the caller.
		Effect.catchCause((cause) =>
			Effect.gen(function* () {
				yield* Effect.logWarning('GitHub identity capture failed').pipe(Effect.annotateLogs({ cause }))
				yield* Effect.sync(() =>
					Sentry.captureException(cause, { tags: { error_type: 'github_identity_capture' } }),
				)
			}),
		),
		Effect.withSpan('github.capture_identity'),
	)
