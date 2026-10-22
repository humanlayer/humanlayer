import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { Context, Effect, Layer, Ref } from 'effect'

import { classifyGhOutcome, classifyGithubRest, type GhExecOutcome, type GithubVerdict } from './classify'
import { type GithubAccessError, GithubAuthError, GithubRequestError, GithubUnavailableError } from './github.errors'
import type { GithubViewer } from './github.types'

// node's execFile is the natively-ASYNC callback API (the child runs off-thread and
// completion is event-loop driven); promisify only converts callback→Promise. The
// blocking sibling, execFileSync, is never used here.
const execFileAsync = promisify(execFile)

/** Every GitHub call is best-effort; a stuck network call must not stall the daemon. */
const GITHUB_TIMEOUT_MS = 10_000
/** gh JSON payloads stay small, but a stray huge PR body should not OOM the process. */
const GH_MAX_BUFFER = 16 * 1024 * 1024

/** GitHub's REST API base — used where REST degrades more gracefully than GraphQL (e.g. `/user`). */
const GITHUB_REST_URL = 'https://api.github.com'

/**
 * The GitHub token from the environment, if any. `GH_TOKEN` wins over
 * `GITHUB_TOKEN`, matching the gh CLI's own precedence — so a host configured for
 * gh keeps the same effective credential when gh itself is absent. Read per call
 * (not frozen at layer build) so tests and long-lived processes see the live env.
 */
export function getGithubToken(): string | undefined {
	for (const key of ['GH_TOKEN', 'GITHUB_TOKEN'] as const) {
		const value = process.env[key]?.trim()
		if (value) return value
	}
	return undefined
}

/**
 * Subprocess seam for the gh CLI. Absorbs every failure into the
 * {@link GhExecOutcome} union so classification stays pure; tests provide a
 * recording fake instead of spawning gh.
 */
export class GhCliExecutor extends Context.Service<
	GhCliExecutor,
	{
		exec: (args: { args: string[]; cwd?: string }) => Effect.Effect<GhExecOutcome>
	}
>()('GhCliExecutor') {}

export const GhCliExecutorLive = Layer.succeed(GhCliExecutor, {
	exec: ({ args, cwd }) =>
		Effect.promise(() =>
			execFileAsync('gh', args, {
				cwd,
				timeout: GITHUB_TIMEOUT_MS,
				maxBuffer: GH_MAX_BUFFER,
				encoding: 'utf8',
			}).then(
				({ stdout }): GhExecOutcome => ({ stdout }),
				(execError: unknown): GhExecOutcome => ({ execError }),
			),
		).pipe(Effect.withSpan('github.gh_exec', { attributes: { 'gh.args': args.join(' ') } })),
})

/**
 * HTTP seam for the token backend. Absorbs network failures (timeout, DNS, abort)
 * into `undefined` — a transient skip, never a latch; tests provide a canned-response
 * fake instead of reaching github.com.
 */
export class GithubTransport extends Context.Service<
	GithubTransport,
	{
		request: (args: {
			url: string
			method: 'GET' | 'POST'
			token: string
			body?: string
		}) => Effect.Effect<{ status: number; body: string } | undefined>
	}
>()('GithubTransport') {}

export const GithubTransportLive = Layer.succeed(GithubTransport, {
	request: ({ url, method, token, body }) =>
		Effect.promise(() => {
			const headers: {
				authorization: string
				accept: string
				'user-agent': string
				'content-type'?: string
			} = {
				authorization: `Bearer ${token}`,
				accept: 'application/vnd.github+json',
				'user-agent': 'riptide-daemon',
			}
			if (body !== undefined) headers['content-type'] = 'application/json'
			return fetch(url, {
				method,
				headers,
				body,
				signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
			}).then(
				async (res) => ({ status: res.status, body: await res.text() }),
				() => undefined,
			)
		}).pipe(Effect.withSpan('github.http_request', { attributes: { 'http.method': method, 'http.url': url } })),
})

export interface GithubAccessService {
	/** Whether any GitHub backend (gh CLI or env token) is usable this process. */
	isAvailable: Effect.Effect<boolean>
	/** Whether either backend's hard-auth latch has tripped this process. */
	isAuthBroken: Effect.Effect<boolean>
	/**
	 * Clear both auth latches so the next call re-probes the credential; a still-broken
	 * credential simply re-trips its latch on the first call. Does NOT clear the gh
	 * availability cache (a binary does not appear mid-process).
	 */
	resetAuthLatches: Effect.Effect<void>
	/**
	 * The daemon operator's own GitHub identity. Both backends hit REST `/user` and
	 * consume its `{ login, id, email }` verbatim: gh via `gh api user`, token via a
	 * direct GET. REST (not GraphQL `viewer`) is deliberate — `/user` returns
	 * `email: null` when the token lacks the email scope, whereas a GraphQL `email`
	 * selection fails the entire query, which would needlessly skip identity capture.
	 */
	fetchViewer: () => Effect.Effect<GithubViewer, GithubAccessError>
}

/**
 * Unified GitHub access for identity capture. The gh CLI is the
 * primary backend; when its binary is absent this transparently falls back to the
 * GitHub API using a `GH_TOKEN` / `GITHUB_TOKEN` from the environment. The token
 * backend maps API fields back into gh's `--json` field names, so consumers stay
 * entirely backend-agnostic.
 *
 * Precedence is deliberate: when gh IS present we always use it (gh reads the same
 * env token itself), so the token backend only engages when the gh binary is
 * missing. Each backend owns a hard-401 latch (a `Ref` inside the layer — reset via
 * {@link GithubAccessService.resetAuthLatches}); once GitHub reports a credential
 * is dead, every remaining call this process attempts short-circuits instead of
 * hammering it. Transient failures (rate limits, network) never latch.
 */
export class GithubAccess extends Context.Service<GithubAccess, GithubAccessService>()('GithubAccess') {}

const makeGithubAccess = Effect.gen(function* () {
	const ghExec = yield* GhCliExecutor
	const transport = yield* GithubTransport

	/** Cached per-process PATH resolution for `gh`; undefined until first probed. */
	const ghAvailableCache = yield* Ref.make<boolean | undefined>(undefined)
	const ghAuthBroken = yield* Ref.make(false)
	const tokenAuthBroken = yield* Ref.make(false)

	const isGhAvailable = Effect.gen(function* () {
		const cached = yield* Ref.get(ghAvailableCache)
		if (cached !== undefined) return cached
		const outcome = yield* ghExec.exec({ args: ['--version'] })
		const available = 'stdout' in outcome
		yield* Ref.set(ghAvailableCache, available)
		return available
	})

	/**
	 * Apply a pure classification verdict for one backend: trip that backend's latch
	 * on `unauthenticated` (with a warn — this kills the feature for the process
	 * until the next reset), map `error` to a transient skip.
	 */
	const applyVerdict = <T>(
		operation: string,
		backend: 'gh' | 'token',
		latch: Ref.Ref<boolean>,
		verdict: GithubVerdict<T>,
	): Effect.Effect<T, GithubAuthError | GithubRequestError> =>
		Effect.gen(function* () {
			if (verdict.kind === 'ok') return verdict.data
			if (verdict.kind === 'unauthenticated') {
				yield* Ref.set(latch, true)
				yield* Effect.logWarning('GitHub auth latch tripped; skipping GitHub calls until next probe').pipe(
					Effect.annotateLogs({ operation, backend }),
				)
				return yield* Effect.fail(new GithubAuthError({ operation, backend }))
			}
			return yield* Effect.fail(new GithubRequestError({ operation, backend }))
		})

	/** Run `gh ... --json ...` and classify stdout; short-circuits when the gh latch has tripped. */
	const ghJson = <T>(operation: string, args: string[], cwd?: string) =>
		Effect.gen(function* () {
			if (yield* Ref.get(ghAuthBroken)) {
				return yield* Effect.fail(new GithubAuthError({ operation, backend: 'gh' }))
			}
			const outcome = yield* ghExec.exec({ args, cwd })
			return yield* applyVerdict(operation, 'gh', ghAuthBroken, classifyGhOutcome<T>(outcome))
		})

	/** Token-backend request core: latch short-circuit, transport call, classification. */
	const tokenRequest = <T>(
		operation: string,
		request: { url: string; method: 'GET' | 'POST'; body?: string },
		classify: (input: { status: number; body: string }) => GithubVerdict<T>,
	) =>
		Effect.gen(function* () {
			if (yield* Ref.get(tokenAuthBroken)) {
				return yield* Effect.fail(new GithubAuthError({ operation, backend: 'token' }))
			}
			const token = getGithubToken()
			if (token === undefined) {
				return yield* Effect.fail(new GithubUnavailableError({ operation }))
			}
			const response = yield* transport.request({ ...request, token })
			if (response === undefined) {
				// Network error / timeout / abort — transient skip, never latch.
				return yield* Effect.fail(new GithubRequestError({ operation, backend: 'token' }))
			}
			return yield* applyVerdict(operation, 'token', tokenAuthBroken, classify(response))
		})

	const tokenRest = <T>(operation: string, path: string) =>
		tokenRequest<T>(operation, { url: `${GITHUB_REST_URL}${path}`, method: 'GET' }, classifyGithubRest)

	/** Backend dispatch: gh when the binary exists, env token otherwise, else unavailable. */
	const withBackend = <T, E>(
		operation: string,
		ghPath: () => Effect.Effect<T, E>,
		tokenPath: () => Effect.Effect<T, E>,
	): Effect.Effect<T, E | GithubUnavailableError> =>
		Effect.gen(function* () {
			if (yield* isGhAvailable) return yield* ghPath()
			if (getGithubToken() !== undefined) return yield* tokenPath()
			return yield* Effect.fail(new GithubUnavailableError({ operation }))
		}).pipe(Effect.withSpan(`github.${operation}`))

	return {
		isAvailable: Effect.gen(function* () {
			if (yield* isGhAvailable) return true
			return getGithubToken() !== undefined
		}),

		isAuthBroken: Effect.gen(function* () {
			if (yield* Ref.get(ghAuthBroken)) return true
			return yield* Ref.get(tokenAuthBroken)
		}),

		resetAuthLatches: Effect.gen(function* () {
			yield* Ref.set(ghAuthBroken, false)
			yield* Ref.set(tokenAuthBroken, false)
		}),

		fetchViewer: () =>
			withBackend(
				'fetch_viewer',
				() => ghJson<GithubViewer>('fetch_viewer', ['api', 'user']),
				() => tokenRest<GithubViewer>('fetch_viewer', '/user'),
			),
	} satisfies GithubAccessService
})

/**
 * Requires {@link GhCliExecutor} and {@link GithubTransport} — tests provide fakes at these
 * seams and get fresh latch state per layer build (no module-level state, no test-only reset
 * exports).
 */
export const GithubAccessBase = Layer.effect(GithubAccess, makeGithubAccess)

/** Production wiring: real gh subprocess + real fetch transport. */
export const GithubAccessLive = GithubAccessBase.pipe(
	Layer.provide(Layer.mergeAll(GhCliExecutorLive, GithubTransportLive)),
)
