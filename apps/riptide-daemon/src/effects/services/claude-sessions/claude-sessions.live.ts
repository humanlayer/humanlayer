import * as Sentry from '@sentry/bun'
import { Config, Deferred, Duration, Effect, Fiber, Layer, Option, Predicate, Scope, Semaphore } from 'effect'

import { captureClaudeTerminalCause } from '@/effects/observability'

import { DaemonApi } from '../daemon-api/daemon-api.service'
import { ClaudeProcessEnvironment } from './claude-process-environment'
import { readClaudeExecutableConfiguration } from './claude-session-environment'
import {
	ClaudeExecutionError,
	ClaudeFollowUpDeliveryError,
	ClaudeSessionsShuttingDownError,
} from './claude-session-errors'
import {
	ClaudeSessions,
	type ClaudeFollowUpDeliveryOutcome,
	type DeliverClaudeFollowUpMessageInput,
	type ExecuteClaudeSessionInput,
	type StopClaudeSessionOutcome,
	type StopClaudeSessionInput,
} from './claude-sessions.service'
import { finalizeInterruptedRun } from './complete-interrupted-run'
import { prepareClaudeRun, type PreparedClaudeRun } from './prepare-claude-session'
import { processOpenClaudeSdkSession } from './process-open-claude-sdk-session'
import { classifyClaudeSessionErrorReason, describeClaudeSdkCause } from './sdk/claude-sdk-error'
import type { ClaudeSdkSession } from './sdk/claude-sdk-session.service'
import { ClaudeSdk } from './sdk/claude-sdk-session.service'

interface RegistryEntry {
	readonly generation: number
	readonly input: ClaudeSdkSession['input']
	readonly semaphore: Semaphore.Semaphore
	state: 'active' | 'stopping'
	idleFiber: Fiber.Fiber<void> | undefined
}

interface ActiveRun {
	readonly runId: number
	readonly fiber: Fiber.Fiber<void, ClaudeExecutionError | ClaudeSessionsShuttingDownError>
	readonly input: ExecuteClaudeSessionInput
}

// The SDK finalizer force-closes its query after two seconds. Do not let a stuck
// session fiber consume the daemon's entire five-second shutdown budget afterward.
const runTerminationTimeout = Duration.seconds(3)

export const makeClaudeSessionsLive = (
	processOpenSession: typeof processOpenClaudeSdkSession = processOpenClaudeSdkSession,
) =>
	Layer.effect(
		ClaudeSessions,
		Effect.gen(function* () {
			const inheritedEnvironment = yield* ClaudeProcessEnvironment
			const serviceScope = yield* Scope.Scope
			const executableConfiguration = yield* readClaudeExecutableConfiguration()
			const configuration = {
				homeDirectory: executableConfiguration.homeDirectory,
				configuredClaudePath: executableConfiguration.configuredPath,
				executableSearchPath: executableConfiguration.executableSearchPath,
				inheritedEnvironment,
			}
			const idleTimeToLive = yield* Config.Duration('RIPTIDE_CLAUDE_SESSION_IDLE_TTL').pipe(
				Config.withDefault(Duration.minutes(10)),
			)
			const admission = yield* Semaphore.make(1)
			const entries = new Map<string, RegistryEntry>()
			const activeRuns = new Map<
				number,
				{
					readonly fiber: Fiber.Fiber<void, ClaudeExecutionError | ClaudeSessionsShuttingDownError>
					readonly input: ExecuteClaudeSessionInput
				}
			>()
			const startingSessionIds = new Set<string>()
			let nextGeneration = 0
			let shuttingDown = false

			const runsForSession = (sessionId: string) =>
				[...activeRuns.entries()]
					.filter(([, run]) => run.input.context.session.id === sessionId)
					.map(([runId, run]): ActiveRun => ({ runId, ...run }))

			const interruptSessionRuns = (
				runs: ReadonlyArray<ActiveRun>,
				context: { readonly sessionId: string; readonly generation?: number; readonly reason: string },
			) =>
				Effect.forEach(
					runs,
					(run) =>
						Effect.gen(function* () {
							const [terminationDuration, completed] = yield* Fiber.interrupt(run.fiber).pipe(
								Effect.timeoutOption(runTerminationTimeout),
								Effect.timed,
							)
							if (Option.isSome(completed)) return true
							activeRuns.delete(run.runId)
							const terminationDurationMs = Duration.toMillis(terminationDuration)
							yield* Effect.logError(
								'Claude session fiber did not terminate after forced SDK close',
							).pipe(
								Effect.annotateLogs({
									...context,
									run_id: run.runId,
									termination_duration_ms: terminationDurationMs,
									termination_timeout_ms: Duration.toMillis(runTerminationTimeout),
								}),
								Effect.andThen(
									Effect.sync(() =>
										Sentry.captureMessage('Claude session fiber termination timed out', {
											level: 'error',
											tags: {
												error_type: 'claude_session_fiber_termination_timeout',
												session_id: context.sessionId,
											},
											extra: { ...context, runId: run.runId, terminationDurationMs },
										}),
									),
								),
							)
							return false
						}),
					{ concurrency: 'unbounded' },
				)

			const stopGeneration = (
				sessionId: string,
				generation: number,
				reason: string,
			): Effect.Effect<StopClaudeSessionOutcome> =>
				Effect.gen(function* () {
					const stop = yield* admission.withPermits(1)(
						Effect.sync(() => {
							const entry = entries.get(sessionId)
							if (entry?.generation !== generation) return { _tag: 'NotActive' as const }
							if (entry.state === 'stopping') {
								return { _tag: 'AlreadyStopping' as const }
							}
							entry.state = 'stopping'
							const idleFiber = entry.idleFiber
							entry.idleFiber = undefined
							return { _tag: 'Stop' as const, idleFiber, runs: runsForSession(sessionId) }
						}),
					)
					if (Predicate.isTagged('NotActive')(stop)) return 'not-active'
					if (Predicate.isTagged('AlreadyStopping')(stop)) return 'already-stopping'
					yield* Effect.logInfo('Stopping Claude SDK session generation').pipe(
						Effect.annotateLogs({ sessionId, generation, reason, active_run_count: stop.runs.length }),
					)
					const [cleanupDuration, results] = yield* Effect.gen(function* () {
						if (stop.idleFiber !== undefined) yield* Fiber.interrupt(stop.idleFiber)
						return yield* interruptSessionRuns(stop.runs, { sessionId, generation, reason })
					}).pipe(Effect.timed)
					const outcome: StopClaudeSessionOutcome = results.every(Boolean) ? 'stopped' : 'timed-out'
					yield* admission.withPermits(1)(
						Effect.sync(() => {
							if (entries.get(sessionId)?.generation === generation) entries.delete(sessionId)
						}),
					)
					yield* Effect.logInfo('Claude SDK session generation cleanup finished').pipe(
						Effect.annotateLogs({
							sessionId,
							generation,
							reason,
							outcome,
							active_run_count: stop.runs.length,
							cleanup_duration_ms: Duration.toMillis(cleanupDuration),
						}),
					)
					return outcome
				})

			const armIdleTimeout = (sessionId: string, entry: RegistryEntry) =>
				Effect.gen(function* () {
					if (entry.idleFiber !== undefined) yield* Fiber.interrupt(entry.idleFiber)
					entry.idleFiber = yield* Effect.sleep(idleTimeToLive).pipe(
						Effect.andThen(
							Effect.logInfo('Closing idle Claude SDK session').pipe(
								Effect.annotateLogs({
									sessionId,
									idle_time_to_live_ms: Duration.toMillis(idleTimeToLive),
								}),
							),
						),
						Effect.andThen(Effect.sync(() => (entry.idleFiber = undefined))),
						Effect.andThen(stopGeneration(sessionId, entry.generation, 'idle')),
						Effect.asVoid,
						Effect.forkIn(serviceScope),
					)
				})

			const cancelIdleTimeout = (entry: RegistryEntry) =>
				entry.idleFiber === undefined
					? Effect.void
					: Fiber.interrupt(entry.idleFiber).pipe(
							Effect.andThen(Effect.sync(() => (entry.idleFiber = undefined))),
						)

			const removeGeneration = (sessionId: string, generation: number) =>
				Effect.gen(function* () {
					const entry = entries.get(sessionId)
					if (entry?.generation !== generation) return
					entries.delete(sessionId)
					if (entry.idleFiber !== undefined) yield* Fiber.interrupt(entry.idleFiber)
				})

			const register = (sessionId: string, input: ClaudeSdkSession['input']) =>
				Effect.acquireRelease(
					admission.withPermits(1)(
						Effect.suspend(() => {
							if (shuttingDown) {
								return Effect.fail(
									new ClaudeSessionsShuttingDownError({
										sessionId,
										message: 'Claude sessions are shutting down',
									}),
								)
							}
							const entry: RegistryEntry = {
								generation: ++nextGeneration,
								input,
								semaphore: Semaphore.makeUnsafe(1),
								state: 'active',
								idleFiber: undefined,
							}
							entries.set(sessionId, entry)
							return Effect.succeed(entry)
						}),
					),
					(entry) => removeGeneration(sessionId, entry.generation),
				)

			const runClaudeProcessToCompletion = (prepared: PreparedClaudeRun, onRegistered: Effect.Effect<void>) =>
				Effect.scoped(
					Effect.gen(function* () {
						const sdk = yield* ClaudeSdk
						const sessionId = prepared.session.id
						const sdkSession = yield* sdk.open(prepared.sdk)
						yield* Effect.addFinalizer(() => sdkSession.input.close)
						const entry = yield* register(sessionId, sdkSession.input)
						yield* onRegistered
						yield* processOpenSession({
							prepared,
							sdkSession,
							onResult: armIdleTimeout(sessionId, entry),
						})
					}),
				).pipe(
					Effect.withSpan('claude.active_session', {
						attributes: { session_id: prepared.session.id },
					}),
				)

			const deliverFollowUpMessage = (input: DeliverClaudeFollowUpMessageInput) =>
				Effect.suspend(() => {
					if (shuttingDown) return Effect.succeed<ClaudeFollowUpDeliveryOutcome>('shutting-down')
					const entry = entries.get(input.sessionId)
					if (!entry) return Effect.succeed<ClaudeFollowUpDeliveryOutcome>('not-active')

					return entry.semaphore.withPermits(1)(
						Effect.gen(function* () {
							const api = yield* DaemonApi
							if (shuttingDown) return 'shutting-down' as const
							if (entries.get(input.sessionId)?.generation !== entry.generation)
								return 'not-active' as const
							if (entry.state === 'stopping') return 'not-active' as const
							yield* cancelIdleTimeout(entry)
							yield* api.updateSession({ sessionId: input.sessionId, status: 'running' }).pipe(
								Effect.tapError(() => armIdleTimeout(input.sessionId, entry)),
								Effect.mapError(
									(cause) =>
										new ClaudeFollowUpDeliveryError({
											sessionId: input.sessionId,
											cause,
											message: 'Failed to mark Claude session running before follow-up delivery',
										}),
								),
							)
							return yield* entry.input.sendMessage(input.prompt).pipe(
								Effect.as('accepted' as const),
								Effect.catch((error) => {
									const activeRunCount = [...activeRuns.values()].filter(
										(run) => run.input.context.session.id === input.sessionId,
									).length
									const diagnostics = {
										sessionId: input.sessionId,
										generation: entry.generation,
										isCurrentGeneration:
											entries.get(input.sessionId)?.generation === entry.generation,
										activeRunCount,
									}

									return Effect.logWarning('Live Claude follow-up delivery failed', error).pipe(
										Effect.annotateLogs(diagnostics),
										Effect.andThen(
											Effect.sync(() =>
												Sentry.captureException(error, {
													tags: {
														error_type: 'claude_follow_up_delivery',
														session_id: input.sessionId,
													},
													extra: diagnostics,
												}),
											),
										),
										Effect.andThen(entry.input.close),
										Effect.andThen(removeGeneration(input.sessionId, entry.generation)),
										Effect.andThen(
											Effect.logInfo('Closed failed Claude follow-up generation').pipe(
												Effect.annotateLogs(diagnostics),
											),
										),
										Effect.as('closed' as const),
									)
								}),
							)
						}),
					)
				})

			const stopClaudeSession = (input: StopClaudeSessionInput) =>
				Effect.suspend(() => {
					const entry = entries.get(input.sessionId)
					return entry === undefined
						? Effect.succeed<StopClaudeSessionOutcome>('not-active')
						: stopGeneration(input.sessionId, entry.generation, input.reason ?? 'explicit')
				}).pipe(Effect.withSpan('claude.sessions.stop', { attributes: { session_id: input.sessionId } }))

			const runClaudeSession = (input: ExecuteClaudeSessionInput, onRegistered: Effect.Effect<void>) =>
				Effect.gen(function* () {
					const api = yield* DaemonApi
					yield* prepareClaudeRun(input, configuration).pipe(
						Effect.flatMap((prepared) => runClaudeProcessToCompletion(prepared, onRegistered)),
						Effect.catch((cause) => {
							const sessionId = input.context.session.id
							const errorMessage = describeClaudeSdkCause(cause)
							const errorReason = classifyClaudeSessionErrorReason(errorMessage)
							return input.context.interruptState.wasInterrupted.pipe(
								Effect.flatMap((wasInterrupted) =>
									wasInterrupted
										? Effect.logInfo('Claude active session ended after interruption').pipe(
												Effect.annotateLogs({ sessionId }),
											)
										: Effect.logError('Claude session failed').pipe(
												Effect.annotateLogs({ sessionId, cause, errorMessage }),
												Effect.andThen(
													api.updateSession({
														sessionId,
														status: 'failed',
														errorMessage,
														errorReason,
													}),
												),
												Effect.ignore,
												Effect.andThen(
													Effect.fail(
														new ClaudeExecutionError({
															sessionId,
															cause,
															message: errorMessage,
														}),
													),
												),
											),
								),
							)
						}),
					)
					yield* finalizeInterruptedRun(input)
				}).pipe(
					Effect.withSpan('claude.sessions.execute', {
						attributes: { session_id: input.context.session.id },
					}),
				)

			const executeClaudeSession = (input: ExecuteClaudeSessionInput) =>
				admission
					.withPermits(1)(
						Effect.suspend(() => {
							const sessionId = input.context.session.id
							if (shuttingDown) {
								return Effect.fail(
									new ClaudeSessionsShuttingDownError({
										sessionId,
										message: `Claude sessions are shutting down; refusing session ${sessionId}`,
									}),
								)
							}
							if (entries.has(sessionId) || startingSessionIds.has(sessionId)) {
								return Effect.logInfo('Claude session run is already active').pipe(
									Effect.annotateLogs({ sessionId }),
									Effect.as(null),
								)
							}
							return Effect.gen(function* () {
								const runId = ++nextGeneration
								const started = yield* Deferred.make<
									void,
									ClaudeExecutionError | ClaudeSessionsShuttingDownError
								>()
								const admitted = yield* Deferred.make<void>()
								startingSessionIds.add(sessionId)
								const markStarted = Effect.sync(() => startingSessionIds.delete(sessionId)).pipe(
									Effect.andThen(Deferred.succeed(started, undefined)),
									Effect.asVoid,
								)
								const run = Deferred.await(admitted).pipe(
									Effect.andThen(runClaudeSession(input, markStarted)),
									Effect.tapCause((cause) =>
										Deferred.isDone(started).pipe(
											Effect.flatMap((didStart) =>
												didStart
													? Effect.sync(() => captureClaudeTerminalCause(cause, input))
													: Deferred.failCause(started, cause).pipe(Effect.asVoid),
											),
										),
									),
									Effect.ensuring(
										Effect.sync(() => {
											activeRuns.delete(runId)
											startingSessionIds.delete(sessionId)
										}),
									),
								)
								const fiber = yield* Effect.forkIn(run, serviceScope)
								activeRuns.set(runId, { fiber, input })
								yield* Deferred.succeed(admitted, undefined)
								return started
							})
						}),
					)
					.pipe(
						Effect.flatMap((started) => (started ? Deferred.await(started) : Effect.void)),
						Effect.withSpan('claude.sessions.execute_supervised', {
							attributes: { session_id: input.context.session.id },
						}),
					)

			const shutdownActiveClaudeSessions = Effect.gen(function* () {
				const snapshot = yield* admission.withPermits(1)(
					Effect.sync(() => {
						shuttingDown = true
						const idleFibers: Array<Fiber.Fiber<void>> = []
						for (const entry of entries.values()) {
							entry.state = 'stopping'
							if (entry.idleFiber !== undefined) idleFibers.push(entry.idleFiber)
							entry.idleFiber = undefined
						}
						const runs = [...activeRuns.entries()].map(([runId, run]) => ({ runId, ...run }))
						return { idleFibers, runs }
					}),
				)
				yield* Effect.forEach(snapshot.idleFibers, Fiber.interrupt, { concurrency: 'unbounded', discard: true })
				yield* Effect.forEach(snapshot.runs, (run) => run.input.context.interruptState.markInterrupted(null), {
					discard: true,
				})
				yield* interruptSessionRuns(snapshot.runs, { sessionId: 'all', reason: 'shutdown' })
				yield* admission.withPermits(1)(
					Effect.sync(() => {
						entries.clear()
					}),
				)
			}).pipe(Effect.withSpan('claude.sessions.shutdown'))

			const activeSessionIds = Effect.sync(() => [
				...new Set([
					...entries.keys(),
					...startingSessionIds,
					...[...activeRuns.values()].map((run) => run.input.context.session.id),
				]),
			])

			return {
				executeClaudeSession,
				deliverFollowUpMessage,
				stopClaudeSession,
				shutdownActiveClaudeSessions,
				activeSessionIds,
			}
		}),
	)

export const ClaudeSessionsLive = makeClaudeSessionsLive()
