import { it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { afterEach, beforeEach, describe, expect } from 'vitest'

import type { GhExecOutcome } from '../../src/lib/github/classify'
import {
	GhCliExecutor,
	GithubAccess,
	GithubAccessBase,
	GithubTransport,
} from '../../src/lib/github/github-access.service'

/**
 * Real-seam layer tests for the GithubAccess service: the gh subprocess and the
 * HTTP transport are swapped for recording fakes at the service's declared
 * seams, and each `makeLayer` build gets FRESH latch/cache state — replacing the
 * module-level `__resetGhStateForTest`-style helpers the service design removed.
 */

const VIEWER_JSON = '{"login":"octocat","id":583231}'
const AUTH_401: GhExecOutcome = { execError: { stderr: 'gh: HTTP 401: Requires authentication', code: 1 } }

interface FakeGh {
	/** Outcomes returned per non-version exec call, in order; last one repeats. */
	outcomes: GhExecOutcome[]
	/** Whether the `gh --version` availability probe succeeds. */
	binaryPresent: boolean
	calls: string[][]
}

const makeLayer = (opts: {
	gh: FakeGh
	http?: Array<{ status: number; body: string }>
	httpCalls?: Array<{ url: string; body?: string }>
}) => {
	const ghLayer = Layer.succeed(GhCliExecutor, {
		exec: ({ args }) =>
			Effect.sync(() => {
				if (args[0] === '--version') {
					return opts.gh.binaryPresent ? { stdout: 'gh version 2.0.0' } : { execError: new Error('ENOENT') }
				}
				opts.gh.calls.push(args)
				const outcome = opts.gh.outcomes[Math.min(opts.gh.calls.length - 1, opts.gh.outcomes.length - 1)]
				return outcome ?? { execError: new Error('no outcome configured') }
			}),
	})
	const responses = [...(opts.http ?? [])]
	const httpLayer = Layer.succeed(GithubTransport, {
		request: ({ url, body }) =>
			Effect.sync(() => {
				opts.httpCalls?.push({ url, body })
				return responses.length > 1 ? responses.shift() : responses[0]
			}),
	})
	return GithubAccessBase.pipe(Layer.provide(Layer.mergeAll(ghLayer, httpLayer)))
}

describe('GithubAccess service (gh backend)', () => {
	it.effect('fetchViewer parses gh api user output', () => {
		const gh: FakeGh = { outcomes: [{ stdout: VIEWER_JSON }], binaryPresent: true, calls: [] }
		return Effect.gen(function* () {
			const github = yield* GithubAccess
			const viewer = yield* github.fetchViewer()
			expect(viewer).toEqual({ login: 'octocat', id: 583231 })
			expect(gh.calls).toEqual([['api', 'user']])
		}).pipe(Effect.provide(makeLayer({ gh })))
	})

	it.effect('a hard 401 trips the latch: later calls short-circuit without spawning gh', () => {
		const gh: FakeGh = { outcomes: [AUTH_401], binaryPresent: true, calls: [] }
		return Effect.gen(function* () {
			const github = yield* GithubAccess

			const first = yield* Effect.flip(github.fetchViewer())
			expect(first._tag).toBe('GithubAuthError')
			expect(yield* github.isAuthBroken).toBe(true)

			// Latched: the second call fails immediately, no new gh invocation.
			const second = yield* Effect.flip(github.fetchViewer())
			expect(second._tag).toBe('GithubAuthError')
			expect(gh.calls).toHaveLength(1)
		}).pipe(Effect.provide(makeLayer({ gh })))
	})

	it.effect('resetAuthLatches re-probes: a fixed credential recovers, a broken one re-trips', () => {
		const gh: FakeGh = { outcomes: [AUTH_401, { stdout: VIEWER_JSON }], binaryPresent: true, calls: [] }
		return Effect.gen(function* () {
			const github = yield* GithubAccess

			yield* Effect.flip(github.fetchViewer())
			expect(yield* github.isAuthBroken).toBe(true)

			yield* github.resetAuthLatches
			expect(yield* github.isAuthBroken).toBe(false)

			// The post-reset probe reaches gh again and succeeds (operator ran `gh auth login`).
			const viewer = yield* github.fetchViewer()
			expect(viewer).toEqual({ login: 'octocat', id: 583231 })
			expect(gh.calls).toHaveLength(2)
		}).pipe(Effect.provide(makeLayer({ gh })))
	})

	it.effect('a transient error does NOT latch', () => {
		const gh: FakeGh = {
			outcomes: [{ execError: { stderr: 'gh: HTTP 502: Bad Gateway', code: 1 } }],
			binaryPresent: true,
			calls: [],
		}
		return Effect.gen(function* () {
			const github = yield* GithubAccess
			const error = yield* Effect.flip(github.fetchViewer())
			expect(error._tag).toBe('GithubRequestError')
			expect(yield* github.isAuthBroken).toBe(false)
		}).pipe(Effect.provide(makeLayer({ gh })))
	})
})

describe('GithubAccess service (token fallback)', () => {
	const env = { GH_TOKEN: process.env.GH_TOKEN, GITHUB_TOKEN: process.env.GITHUB_TOKEN }
	beforeEach(() => {
		process.env.GH_TOKEN = 'test-token'
		delete process.env.GITHUB_TOKEN
	})
	afterEach(() => {
		process.env.GH_TOKEN = env.GH_TOKEN
		process.env.GITHUB_TOKEN = env.GITHUB_TOKEN
	})

	it.effect('with no gh binary, fetchViewer reaches REST /user with the env token', () => {
		const gh: FakeGh = { outcomes: [], binaryPresent: false, calls: [] }
		const httpCalls: Array<{ url: string; body?: string }> = []
		return Effect.gen(function* () {
			const github = yield* GithubAccess
			const viewer = yield* github.fetchViewer()
			expect(viewer).toEqual({ login: 'octocat', id: 583231 })
			expect(gh.calls).toHaveLength(0)
			expect(httpCalls[0]?.url).toBe('https://api.github.com/user')
		}).pipe(Effect.provide(makeLayer({ gh, http: [{ status: 200, body: VIEWER_JSON }], httpCalls })))
	})

	it.effect('a REST 401 trips the token latch and later calls short-circuit', () => {
		const gh: FakeGh = { outcomes: [], binaryPresent: false, calls: [] }
		const httpCalls: Array<{ url: string; body?: string }> = []
		return Effect.gen(function* () {
			const github = yield* GithubAccess

			const first = yield* Effect.flip(github.fetchViewer())
			expect(first._tag).toBe('GithubAuthError')

			const second = yield* Effect.flip(github.fetchViewer())
			expect(second._tag).toBe('GithubAuthError')
			expect(httpCalls).toHaveLength(1) // latched: no second request
		}).pipe(
			Effect.provide(
				makeLayer({ gh, http: [{ status: 401, body: '{"message":"Bad credentials"}' }], httpCalls }),
			),
		)
	})

	it.effect('with no gh binary AND no token, every operation is unavailable', () => {
		delete process.env.GH_TOKEN
		const gh: FakeGh = { outcomes: [], binaryPresent: false, calls: [] }
		return Effect.gen(function* () {
			const github = yield* GithubAccess
			expect(yield* github.isAvailable).toBe(false)
			const error = yield* Effect.flip(github.fetchViewer())
			expect(error._tag).toBe('GithubUnavailableError')
		}).pipe(Effect.provide(makeLayer({ gh })))
	})
})
