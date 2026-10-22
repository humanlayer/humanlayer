import * as BunServices from '@effect/platform-bun/BunServices'
import type { ProviderLoginProvider, ProviderLoginRequest } from '@humanlayer/db/tables/provider-login-requests'
import { Data, Duration, Effect, Ref, Scope } from 'effect'

import logger from '@/logger'

import { ClaudeExecutableNotFoundError, resolveClaudeExecutable } from '../claude-sessions/claude-session-environment'
import type { ProviderLoginChangeMessage } from '../daemon-collections/daemon-collections.service'
import { makeClaudeLoginDriver } from './drivers/claude-login-driver'
import { makeCodexDeviceLoginDriver } from './drivers/codex-login-driver'
import type { ProviderLoginDriver, ProviderLoginDriverContext, ProviderLoginPatch } from './provider-login.types'
import { ProviderLoginAborted } from './provider-login.types'

const TIMED_OUT_MESSAGE = 'Sign-in timed out. Start again when you are ready.'
const INTERRUPTED_MESSAGE = 'Sign-in was interrupted because the daemon restarted. Start again.'
const XAI_UNAVAILABLE_MESSAGE = 'Grok sign-in is not available yet.'

const PROVIDER_LABELS: Record<ProviderLoginProvider, string> = { claude: 'Claude', codex: 'ChatGPT', xai: 'Grok' }

// Wraps whatever the promise-based driver rejects with; the controller reads `.cause`.
class ProviderLoginFailure extends Data.TaggedError('ProviderLoginFailure')<{ readonly cause: unknown }> {}

interface InFlightLogin {
	readonly abort: AbortController
	readonly driver: ProviderLoginDriver
	readonly release: () => void
	deliveredCode: string | null
}

// `claude auth login` runs `$BROWSER <url>` (else the OS opener) with a URL that redirects to a localhost callback,
// which is unreachable when the browser is not on the host. BUN_OPTIONS would re-inject the daemon's --preload.
const STRIPPED_CHILD_ENV = new Set(['BUN_OPTIONS', 'DISPLAY'])
const NO_OP_BROWSER = 'true'

const childEnvironment = () => ({
	...Object.fromEntries(
		Object.entries(process.env).filter(
			(entry): entry is [string, string] => entry[1] !== undefined && !STRIPPED_CHILD_ENV.has(entry[0]),
		),
	),
	BROWSER: NO_OP_BROWSER,
})

// `expires_at` is an absolute wall-clock time from the row; the wait itself runs on Effect's Clock.
const remainingMillis = (expiresAt: bigint): number => Math.max(1_000, Number(expiresAt) - Date.now())
const hasExpired = (expiresAt: bigint): boolean => Number(expiresAt) <= Date.now()

export interface ProviderLoginHandlerOptions {
	/** Writes progress back onto the request row; must not fail (wrap failures at the call site). */
	readonly update: (input: { requestId: string } & ProviderLoginPatch) => Effect.Effect<void>
	/** Test seam; defaults to the real Claude CLI and ChatGPT device flow. */
	readonly makeDriver?: (
		row: ProviderLoginRequest,
	) => Effect.Effect<{ driver: ProviderLoginDriver; release: () => void }>
}

export interface ProviderLoginHandler {
	readonly handle: (change: ProviderLoginChangeMessage) => Effect.Effect<void>
}

export const makeProviderLoginHandler = (
	options: ProviderLoginHandlerOptions,
): Effect.Effect<ProviderLoginHandler, never, Scope.Scope> =>
	Effect.gen(function* () {
		const scope = yield* Scope.Scope
		const inFlight = yield* Ref.make(new Map<string, InFlightLogin>())
		const finished = yield* Ref.make(new Set<string>())

		const makeDriverFor = (row: ProviderLoginRequest) => {
			if (options.makeDriver) return options.makeDriver(row)
			if (row.provider === 'codex')
				return Effect.succeed({ driver: makeCodexDeviceLoginDriver(), release: () => {} })
			return resolveClaudeExecutable().pipe(
				Effect.map((executable) => ({
					driver: makeClaudeLoginDriver({ executable, prefixArguments: [], env: childEnvironment() }),
					release: () => {},
				})),
				Effect.provide(BunServices.layer),
			)
		}

		const finalize = (id: string, release: () => void) =>
			Effect.sync(release).pipe(
				Effect.andThen(
					Ref.update(inFlight, (map) => {
						const next = new Map(map)
						next.delete(id)
						return next
					}),
				),
				Effect.andThen(Ref.update(finished, (set) => new Set(set).add(id))),
			)

		const reportFailure = (row: ProviderLoginRequest, error: ProviderLoginAborted | ProviderLoginFailure) => {
			if (error instanceof ProviderLoginAborted && error.reason === 'cancelled') return Effect.void
			const message =
				error instanceof ProviderLoginAborted
					? TIMED_OUT_MESSAGE
					: error.cause instanceof Error
						? error.cause.message
						: `Could not sign in to ${PROVIDER_LABELS[row.provider]}.`
			return Effect.sync(() =>
				logger.warn({ requestId: row.id, provider: row.provider, message }, 'Provider login failed'),
			).pipe(
				Effect.andThen(
					options.update({ requestId: row.id, status: 'failed', error: message, clearSubmittedCode: true }),
				),
			)
		}

		const beginLogin = (row: ProviderLoginRequest, driver: ProviderLoginDriver, release: () => void) =>
			Effect.gen(function* () {
				// oxlint-disable-next-line effecttsgo/abort-controller-in-effect -- external, DB-driven cancellation that carries a reason and drives the promise-based driver
				const abort = new AbortController()
				yield* Ref.update(inFlight, (map) =>
					new Map(map).set(row.id, { abort, driver, release, deliveredCode: null }),
				)
				yield* Effect.sync(() =>
					logger.info({ requestId: row.id, provider: row.provider }, 'Provider login started'),
				)
				const context: ProviderLoginDriverContext = {
					requestId: row.id,
					provider: row.provider,
					signal: abort.signal,
					update: (patch) =>
						abort.signal.aborted
							? Promise.resolve()
							: Effect.runPromise(options.update({ requestId: row.id, ...patch })),
				}
				const attempt = Effect.tryPromise({
					try: () => driver.start(context),
					catch: (error) =>
						error instanceof ProviderLoginAborted ? error : new ProviderLoginFailure({ cause: error }),
				})
				const expiry = Effect.sleep(Duration.millis(remainingMillis(row.expires_at))).pipe(
					Effect.andThen(Effect.sync(() => abort.abort('timed_out'))),
					Effect.andThen(Effect.never),
				)
				const login = Effect.raceFirst(attempt, expiry).pipe(
					Effect.matchEffect({
						onSuccess: (result) =>
							options.update({
								requestId: row.id,
								status: 'succeeded',
								accountLabel: result.accountLabel,
								error: null,
								clearSubmittedCode: true,
							}),
						onFailure: (error) => reportFailure(row, error),
					}),
					Effect.ensuring(finalize(row.id, release)),
				)
				yield* Effect.forkIn(login, scope)
			})

		const failToStart = (row: ProviderLoginRequest, error: ClaudeExecutableNotFoundError | Error) =>
			Effect.gen(function* () {
				yield* Ref.update(finished, (set) => new Set(set).add(row.id))
				const detail = error instanceof ClaudeExecutableNotFoundError ? error.message : String(error)
				yield* Effect.sync(() =>
					logger.warn(
						{ requestId: row.id, provider: row.provider, detail },
						'Provider login could not start',
					),
				)
				yield* options.update({
					requestId: row.id,
					status: 'failed',
					error: `Could not sign in to ${PROVIDER_LABELS[row.provider]}. ${detail}`,
				})
			})

		const start = (row: ProviderLoginRequest) =>
			Effect.gen(function* () {
				if (row.provider === 'xai') {
					yield* Ref.update(finished, (set) => new Set(set).add(row.id))
					yield* options.update({ requestId: row.id, status: 'failed', error: XAI_UNAVAILABLE_MESSAGE })
					return
				}
				if (hasExpired(row.expires_at)) {
					yield* Ref.update(finished, (set) => new Set(set).add(row.id))
					yield* options.update({ requestId: row.id, status: 'failed', error: TIMED_OUT_MESSAGE })
					return
				}
				yield* makeDriverFor(row).pipe(
					Effect.flatMap(({ driver, release }) => beginLogin(row, driver, release)),
					Effect.catch((error) => failToStart(row, error)),
				)
			})

		const cancel = (id: string, reason: 'cancelled' | 'timed_out') =>
			Effect.gen(function* () {
				const login = (yield* Ref.get(inFlight)).get(id)
				if (login) yield* Effect.sync(() => login.abort.abort(reason))
			})

		const forget = (id: string) =>
			Ref.update(finished, (set) => {
				const next = new Set(set)
				next.delete(id)
				return next
			})

		const handle = (change: ProviderLoginChangeMessage): Effect.Effect<void> =>
			Effect.gen(function* () {
				const row = change.value
				if (change.type === 'delete') {
					yield* cancel(row.id, 'cancelled')
					return yield* forget(row.id)
				}
				switch (row.status) {
					case 'requested': {
						const running = (yield* Ref.get(inFlight)).has(row.id)
						const done = (yield* Ref.get(finished)).has(row.id)
						if (!running && !done) yield* start(row)
						return
					}
					case 'awaiting_approval': {
						const login = (yield* Ref.get(inFlight)).get(row.id)
						if (!login) {
							if (!(yield* Ref.get(finished)).has(row.id)) {
								yield* Ref.update(finished, (set) => new Set(set).add(row.id))
								yield* options.update({
									requestId: row.id,
									status: 'failed',
									error: INTERRUPTED_MESSAGE,
								})
							}
							return
						}
						if (row.submitted_code === null) login.deliveredCode = null
						if (row.submitted_code && row.submitted_code !== login.deliveredCode) {
							login.deliveredCode = row.submitted_code
							const code = row.submitted_code
							yield* Effect.sync(() => login.driver.submitCode?.(code))
						}
						return
					}
					case 'cancelled':
						yield* cancel(row.id, 'cancelled')
						return yield* forget(row.id)
					case 'succeeded':
					case 'failed':
						return yield* forget(row.id)
					default:
						return
				}
			})

		return { handle }
	})
