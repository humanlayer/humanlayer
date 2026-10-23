import {
	AuthenticationFailed,
	type DaemonInfo,
	type DaemonLifecycleEvent,
	RestartFailed,
	RestartSucceeded,
	UnexpectedExit,
} from '@humanlayer/riptide-electron-rpc'
import type { DaemonLaunchResult } from '@humanlayer/schemas/effect/daemon/process-event'
import * as Crypto from 'effect/Crypto'
import * as Deferred from 'effect/Deferred'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import type * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Path from 'effect/Path'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import * as PubSub from 'effect/PubSub'
import * as Ref from 'effect/Ref'
import * as Scope from 'effect/Scope'
import * as Semaphore from 'effect/Semaphore'
import * as Stream from 'effect/Stream'

import type { ElectronConfig } from '../config/electron-config'
import { HostIdService } from '../host/host-id-service'
import { Sentry } from '../instrument'
import type { ElectronPlatform } from '../platform/electron-platform.service'
import { InheritedEnvironment } from '../platform/inherited-environment'
import { buildDaemonEnvironment } from './daemon-environment'
import { terminateDaemonGeneration } from './daemon-generation'
import { startDaemonOutputConsumers } from './daemon-log'
import { resolveDaemonExecutable } from './daemon-resource'
import {
	DaemonSupervisor,
	type DaemonSupervisorShape,
	type DaemonTupleInput,
	type StartDaemonInput,
} from './daemon-supervisor.service'
import {
	DaemonCandidateExitedBeforeLaunchResult,
	DaemonCandidateLaunchTimedOut,
	DaemonStartError,
	DaemonStopError,
	DaemonUnavailableError,
} from './daemon.errors'

type ProcessHandle = ChildProcessSpawner.ChildProcessHandle

interface DaemonGeneration {
	readonly generationId: string
	readonly info: DaemonInfo
	readonly request: StartDaemonInput
	readonly handle: ProcessHandle
	readonly scope: Scope.Closeable
	readonly hasRetried: boolean
	readonly intentionalStop: Ref.Ref<boolean>
	readonly launchResult: Deferred.Deferred<DaemonLaunchResult>
	readonly outputCompleted: Deferred.Deferred<void>
}

type PublicDaemonStartError = DaemonStartError | DaemonUnavailableError

interface PendingLaunch {
	readonly completion: Deferred.Deferred<DaemonLaunchResult, PublicDaemonStartError>
	readonly abort: Deferred.Deferred<void>
}

// The renderer treats this prefix as an expected cancellation, not a launch failure.
const MANAGEMENT_DISABLED_MESSAGE = 'Daemon launch cancelled: local daemon is turned off'

const tupleKey = (input: DaemonTupleInput): string => `${input.userId}\u0000${input.organizationId}`
const randomGenerationId = Effect.fn('daemon_supervisor.generation_id')(function* () {
	const crypto = yield* Crypto.Crypto
	const bytes = yield* crypto.randomBytes(16)
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
})

export const makeDaemonSupervisorLive = (config: ElectronConfig) =>
	Layer.effect(
		DaemonSupervisor,
		Effect.gen(function* () {
			const serviceScope = yield* Effect.scope
			const hostIdService = yield* HostIdService
			const lifecyclePubSub = yield* PubSub.unbounded<DaemonLifecycleEvent>()
			const generations = yield* Ref.make(new Map<string, DaemonGeneration>())
			const pendingLaunches = yield* Ref.make(new Map<string, PendingLaunch>())
			const tupleSemaphores = new Map<string, Semaphore.Semaphore>()
			const tupleSemaphoreGuard = yield* Semaphore.make(1)
			const shuttingDown = yield* Ref.make(false)
			// Closed while the local daemon setting is off: no new starts and no automatic restarts.
			const managementEnabled = yield* Ref.make(true)
			const managementSemaphore = yield* Semaphore.make(1)

			const getTupleSemaphore = (key: string) =>
				tupleSemaphoreGuard.withPermit(
					Effect.suspend(() => {
						const current = tupleSemaphores.get(key)
						if (current !== undefined) return Effect.succeed(current)
						return Semaphore.make(1).pipe(
							Effect.tap((created) => Effect.sync(() => tupleSemaphores.set(key, created))),
						)
					}),
				)

			const updateGeneration = (key: string, generation: DaemonGeneration | undefined) =>
				Ref.update(generations, (current) => {
					const next = new Map(current)
					if (generation === undefined) next.delete(key)
					else next.set(key, generation)
					return next
				})

			const removePendingLaunch = (
				key: string,
				completion: Deferred.Deferred<DaemonLaunchResult, PublicDaemonStartError>,
			) =>
				Ref.update(pendingLaunches, (current) => {
					if (current.get(key)?.completion !== completion) return current
					const next = new Map(current)
					next.delete(key)
					return next
				})

			const acquireGeneration = Effect.fn('daemon_supervisor.acquire_generation')(function* (input: {
				readonly request: StartDaemonInput
				readonly hasRetried: boolean
			}) {
				const executable = yield* resolveDaemonExecutable({ config })
				const hostId = yield* hostIdService.get
				const generationId = yield* randomGenerationId()
				const environment = yield* buildDaemonEnvironment({
					token: input.request.token,
					generationId,
					channel: config.channel,
					apiOrigin: input.request.apiOrigin,
					syncOrigin: input.request.syncOrigin,
					expectedIdentity: {
						userId: input.request.userId,
						organizationId: input.request.organizationId,
						hostId,
					},
					verifiedClaudePath: input.request.verifiedClaudePath,
				})
				const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
				const pathService = yield* Path.Path
				const generationScope = yield* Scope.make()
				const intentionalStop = yield* Ref.make(false)
				const launchResult = yield* Deferred.make<DaemonLaunchResult>()
				const outputCompleted = yield* Deferred.make<void>()
				return yield* Effect.gen(function* () {
					const handle = yield* spawner
						.spawn(
							ChildProcess.make(executable, [], {
								env: environment,
								extendEnv: false,
								detached: true,
								stdin: 'ignore',
								stdout: 'pipe',
								stderr: 'pipe',
							}),
						)
						.pipe(Effect.provideService(Scope.Scope, generationScope))
					const info: DaemonInfo = {
						userId: input.request.userId,
						organizationId: input.request.organizationId,
						hostId,
						pid: Number(handle.pid),
						syncMode: input.request.syncMode,
					}
					const generation: DaemonGeneration = {
						generationId,
						info,
						request: input.request,
						handle,
						scope: generationScope,
						hasRetried: input.hasRetried,
						intentionalStop,
						launchResult,
						outputCompleted,
					}
					const logDirectory = pathService.dirname(config.logPath)
					yield* startDaemonOutputConsumers({
						userId: input.request.userId,
						organizationId: input.request.organizationId,
						generationId,
						stdout: handle.stdout,
						stderr: handle.stderr,
						logDirectory,
						onAuthenticationFailure: ({ message }) =>
							Ref.set(intentionalStop, true).pipe(
								Effect.andThen(
									PubSub.publish(
										lifecyclePubSub,
										AuthenticationFailed.make({
											userId: input.request.userId,
											organizationId: input.request.organizationId,
											message,
										}),
									),
								),
								Effect.asVoid,
							),
						onLaunchResult: (result) =>
							(result.type === 'daemon_already_running'
								? Ref.set(intentionalStop, true).pipe(
										Effect.andThen(
											Effect.logInfo(result.message).pipe(
												Effect.annotateLogs({
													user_id: input.request.userId,
													organization_id: input.request.organizationId,
												}),
											),
										),
									)
								: Effect.void
							).pipe(Effect.andThen(Deferred.succeed(launchResult, result)), Effect.asVoid),
					}).pipe(
						Effect.provideService(Scope.Scope, generationScope),
						Effect.ensuring(Deferred.succeed(outputCompleted, undefined)),
						Effect.forkIn(generationScope),
					)
					return generation
				}).pipe(Effect.onError(() => Scope.close(generationScope, Exit.void)))
			})

			const resolveDaemonCandidateLaunchResult = Effect.fn(
				'daemon_supervisor.resolve_daemon_candidate_launch_result',
			)(function* (input: { readonly generation: DaemonGeneration }) {
				const exitBeforeResult = input.generation.handle.exitCode.pipe(
					Effect.flatMap((exitCode) =>
						Effect.raceFirst(
							Deferred.await(input.generation.launchResult),
							Deferred.await(input.generation.outputCompleted).pipe(
								Effect.andThen(
									Effect.fail(
										new DaemonCandidateExitedBeforeLaunchResult({
											exitCode: Number(exitCode),
											generationId: input.generation.generationId,
										}),
									),
								),
							),
						),
					),
				)
				const timeout = Effect.sleep('45 seconds').pipe(
					Effect.andThen(
						Effect.fail(
							new DaemonCandidateLaunchTimedOut({
								generationId: input.generation.generationId,
								timeoutSeconds: 45,
							}),
						),
					),
				)
				return yield* Effect.raceFirst(
					Deferred.await(input.generation.launchResult),
					Effect.raceFirst(exitBeforeResult, timeout),
				).pipe(
					Effect.onError(() =>
						terminateDaemonGeneration({ generation: input.generation, gracePeriod: '10 seconds' }).pipe(
							Effect.catch((error) =>
								Effect.logError('Failed to clean up daemon launch candidate', error).pipe(
									Effect.andThen(Effect.sync(() => Sentry.captureException(error))),
								),
							),
						),
					),
				)
			})

			const closeCandidateAfterExit = (generation: DaemonGeneration) =>
				generation.handle.exitCode.pipe(
					Effect.ensuring(Scope.close(generation.scope, Exit.void)),
					Effect.catch((error) =>
						Effect.logError(error).pipe(Effect.andThen(Effect.sync(() => Sentry.captureException(error)))),
					),
					Effect.asVoid,
				)

			const observeGeneration = (
				key: string,
				generation: DaemonGeneration,
			): Effect.Effect<
				void,
				never,
				| FileSystem.FileSystem
				| Path.Path
				| ElectronPlatform
				| InheritedEnvironment
				| Crypto.Crypto
				| ChildProcessSpawner.ChildProcessSpawner
			> =>
				generation.handle.exitCode.pipe(
					Effect.flatMap((exitCode) =>
						getTupleSemaphore(key).pipe(
							Effect.flatMap((semaphore) =>
								semaphore.withPermit(
									Effect.gen(function* () {
										const current = (yield* Ref.get(generations)).get(key)
										if (current?.generationId !== generation.generationId) return
										yield* updateGeneration(key, undefined)
										yield* Scope.close(generation.scope, Exit.void)
										if (yield* Ref.get(generation.intentionalStop)) return
										if (yield* Ref.get(shuttingDown)) return
										if (!(yield* Ref.get(managementEnabled))) return
										yield* PubSub.publish(
											lifecyclePubSub,
											UnexpectedExit.make({
												userId: generation.info.userId,
												organizationId: generation.info.organizationId,
												exitCode: Number(exitCode),
											}),
										)
										if (generation.hasRetried) {
											yield* PubSub.publish(
												lifecyclePubSub,
												RestartFailed.make({
													userId: generation.info.userId,
													organizationId: generation.info.organizationId,
													message: 'Daemon exited after its automatic restart',
												}),
											)
											return
										}
										yield* acquireGeneration({
											request: generation.request,
											hasRetried: true,
										}).pipe(
											Effect.flatMap((replacement) =>
												resolveDaemonCandidateLaunchResult({ generation: replacement }).pipe(
													Effect.flatMap((result) => {
														if (result.type === 'daemon_already_running') {
															return closeCandidateAfterExit(replacement).pipe(
																Effect.forkIn(serviceScope),
																Effect.andThen(
																	PubSub.publish(
																		lifecyclePubSub,
																		RestartFailed.make({
																			userId: replacement.info.userId,
																			organizationId:
																				replacement.info.organizationId,
																			message:
																				'Matching daemon is already running outside Electron ownership',
																		}),
																	),
																),
																Effect.asVoid,
															)
														}
														return updateGeneration(key, replacement).pipe(
															Effect.andThen(
																observeGeneration(key, replacement).pipe(
																	Effect.forkIn(serviceScope),
																),
															),
															Effect.andThen(
																PubSub.publish(
																	lifecyclePubSub,
																	RestartSucceeded.make({
																		userId: replacement.info.userId,
																		organizationId: replacement.info.organizationId,
																		pid: replacement.info.pid,
																	}),
																),
															),
															Effect.asVoid,
														)
													}),
												),
											),
											Effect.catch((error) =>
												Effect.logError(error).pipe(
													Effect.andThen(Effect.sync(() => Sentry.captureException(error))),
													Effect.andThen(
														PubSub.publish(
															lifecyclePubSub,
															RestartFailed.make({
																userId: generation.info.userId,
																organizationId: generation.info.organizationId,
																message: 'Automatic daemon restart failed',
															}),
														),
													),
													Effect.asVoid,
												),
											),
										)
									}),
								),
							),
						),
					),
					Effect.catch((error) =>
						Effect.logError(error).pipe(Effect.andThen(Effect.sync(() => Sentry.captureException(error)))),
					),
					Effect.asVoid,
				)

			const start: DaemonSupervisorShape['start'] = (input) => {
				const key = tupleKey(input)
				return getTupleSemaphore(key).pipe(
					Effect.flatMap((semaphore) =>
						semaphore.withPermit(
							Effect.gen(function* () {
								if (!(yield* Ref.get(managementEnabled))) {
									return Effect.fail(
										new DaemonUnavailableError({ message: MANAGEMENT_DISABLED_MESSAGE }),
									)
								}
								const pending = (yield* Ref.get(pendingLaunches)).get(key)
								if (pending !== undefined) return Deferred.await(pending.completion)
								const current = (yield* Ref.get(generations)).get(key)
								if (current !== undefined && (yield* current.handle.isRunning)) {
									if (
										current.info.syncMode === input.syncMode &&
										current.request.verifiedClaudePath === input.verifiedClaudePath
									) {
										return Effect.succeed<DaemonLaunchResult>({ type: 'daemon_ready' })
									}
									yield* terminateDaemonGeneration({
										generation: current,
										gracePeriod: '10 seconds',
									}).pipe(
										Effect.tapError((error) =>
											Effect.logError(
												'Failed to replace daemon with a different sync mode',
												error,
											).pipe(Effect.andThen(Effect.sync(() => Sentry.captureException(error)))),
										),
										Effect.mapError(
											() => new DaemonStartError({ message: 'Failed to replace running daemon' }),
										),
									)
									yield* updateGeneration(key, undefined)
								} else if (current !== undefined) {
									yield* Scope.close(current.scope, Exit.void)
									yield* updateGeneration(key, undefined)
								}
								const completion = yield* Deferred.make<DaemonLaunchResult, PublicDaemonStartError>()
								const abort = yield* Deferred.make<void>()
								yield* Ref.update(pendingLaunches, (pendingByTuple) => {
									const next = new Map(pendingByTuple)
									next.set(key, { completion, abort })
									return next
								})
								const candidateLaunch = acquireGeneration({ request: input, hasRetried: false }).pipe(
									Effect.flatMap((generation) =>
										// An abort either interrupts the candidate's own cleanup path or waits until it is registered.
										Effect.uninterruptibleMask((restore) =>
											restore(resolveDaemonCandidateLaunchResult({ generation })).pipe(
												Effect.flatMap((result) => {
													if (result.type === 'daemon_already_running') {
														return closeCandidateAfterExit(generation).pipe(
															Effect.forkIn(serviceScope),
															Effect.as<DaemonLaunchResult>(result),
														)
													}
													return updateGeneration(key, generation).pipe(
														Effect.andThen(
															observeGeneration(key, generation).pipe(
																Effect.forkIn(serviceScope),
															),
														),
														Effect.as(result),
													)
												}),
											),
										),
									),
									Effect.tapError((error) =>
										Effect.logError('Daemon candidate launch failed').pipe(
											Effect.annotateLogs({
												user_id: input.userId,
												organization_id: input.organizationId,
												error,
											}),
											Effect.andThen(
												Effect.sync(() =>
													Sentry.captureException(error, {
														tags: { operation: 'daemon_candidate_launch' },
														contexts: {
															daemon: {
																user_id: input.userId,
																organization_id: input.organizationId,
															},
														},
													}),
												),
											),
										),
									),
								)
								const launch = Effect.raceFirst(
									candidateLaunch,
									Deferred.await(abort).pipe(
										Effect.andThen(
											Effect.fail(
												new DaemonUnavailableError({ message: MANAGEMENT_DISABLED_MESSAGE }),
											),
										),
									),
								).pipe(
									Effect.mapError((error) =>
										Match.value(error).pipe(
											Match.tag('DaemonUnavailableError', (unavailable) => unavailable),
											Match.orElse(
												() => new DaemonStartError({ message: 'Failed to start daemon' }),
											),
										),
									),
									Effect.exit,
									Effect.flatMap((result) =>
										Effect.uninterruptible(
											getTupleSemaphore(key).pipe(
												Effect.flatMap((semaphore) =>
													semaphore.withPermit(
														removePendingLaunch(key, completion).pipe(
															Effect.andThen(Deferred.done(completion, result)),
														),
													),
												),
											),
										),
									),
									Effect.ensuring(removePendingLaunch(key, completion)),
								)
								yield* launch.pipe(Effect.forkIn(serviceScope))
								return Deferred.await(completion)
							}),
						),
					),
					Effect.flatten,
					Effect.catchTag('PlatformError', (error) =>
						Effect.logError('Failed to inspect daemon launch state', error).pipe(
							Effect.andThen(Effect.sync(() => Sentry.captureException(error))),
							Effect.andThen(Effect.fail(new DaemonStartError({ message: 'Failed to start daemon' }))),
						),
					),
					Effect.withSpan('daemon_supervisor.start', {
						attributes: { user_id: input.userId, organization_id: input.organizationId },
					}),
				)
			}

			const stopOwnedGeneration = (key: string) =>
				getTupleSemaphore(key).pipe(
					Effect.flatMap((semaphore) =>
						semaphore.withPermit(
							Effect.gen(function* () {
								const generation = (yield* Ref.get(generations)).get(key)
								if (generation === undefined) return
								yield* terminateDaemonGeneration({ generation, gracePeriod: '10 seconds' })
								yield* updateGeneration(key, undefined)
							}),
						),
					),
				)

			const stop: DaemonSupervisorShape['stop'] = (input) => {
				const key = tupleKey(input)
				return stopOwnedGeneration(key).pipe(
					Effect.tapError((error) =>
						Effect.logError('Daemon stop failed').pipe(
							Effect.annotateLogs({
								user_id: input.userId,
								organization_id: input.organizationId,
								error,
							}),
						),
					),
					Effect.tapError((error) =>
						Effect.sync(() =>
							Sentry.captureException(error, {
								tags: { operation: 'daemon_stop' },
								contexts: { daemon: { user_id: input.userId, organization_id: input.organizationId } },
							}),
						),
					),
					Effect.mapError(() => new DaemonStopError({ message: 'Failed to stop daemon' })),
					Effect.withSpan('daemon_supervisor.stop', {
						attributes: { user_id: input.userId, organization_id: input.organizationId },
					}),
				)
			}

			const disableManagement = Effect.gen(function* () {
				yield* Ref.set(managementEnabled, false)
				// A start that passed the gate before it closed registers its pending launch inside its tuple
				// permit, so taking each permit once makes every such launch visible below.
				const semaphores = yield* tupleSemaphoreGuard.withPermit(
					Effect.sync(() => Array.from(tupleSemaphores.values())),
				)
				yield* Effect.forEach(semaphores, (semaphore) => semaphore.withPermit(Effect.void), { discard: true })
				const pending = Array.from((yield* Ref.get(pendingLaunches)).values())
				yield* Effect.forEach(pending, (launch) => Deferred.succeed(launch.abort, undefined), { discard: true })
				yield* Effect.forEach(pending, (launch) => Effect.exit(Deferred.await(launch.completion)), {
					discard: true,
				})
				const keys = Array.from((yield* Ref.get(generations)).keys())
				const results = yield* Effect.forEach(keys, (key) => Effect.exit(stopOwnedGeneration(key)), {
					concurrency: 'unbounded',
				})
				const failures = results.filter(Exit.isFailure)
				if (failures.length > 0) {
					return yield* Effect.fail(failures.map((failure) => failure.cause))
				}
			})

			const setManagementEnabled: DaemonSupervisorShape['setManagementEnabled'] = (enabled) =>
				managementSemaphore.withPermit(enabled ? Ref.set(managementEnabled, true) : disableManagement).pipe(
					Effect.tapError((causes) =>
						Effect.logError('Failed to stop daemons after turning off daemon management').pipe(
							Effect.annotateLogs({ causes }),
							Effect.andThen(
								Effect.sync(() =>
									Sentry.captureException(new Error('Failed to stop local daemons'), {
										tags: { operation: 'daemon_disable_management' },
										extra: { causes },
									}),
								),
							),
						),
					),
					Effect.mapError(() => new DaemonStopError({ message: 'Failed to stop every local daemon' })),
					Effect.withSpan('daemon_supervisor.set_management_enabled', { attributes: { enabled } }),
				)

			const isRunning: DaemonSupervisorShape['isRunning'] = (input) =>
				Ref.get(generations).pipe(
					Effect.flatMap(
						(current) => current.get(tupleKey(input))?.handle.isRunning ?? Effect.succeed(false),
					),
					Effect.catch(() => Effect.succeed(false)),
					Effect.withSpan('daemon_supervisor.is_running'),
				)

			yield* Effect.addFinalizer(() =>
				Ref.set(shuttingDown, true).pipe(
					Effect.andThen(Ref.get(generations)),
					Effect.flatMap((current) =>
						Effect.forEach(
							current.values(),
							(generation) => terminateDaemonGeneration({ generation, gracePeriod: '10 seconds' }),
							{ concurrency: 'unbounded', discard: true },
						),
					),
					Effect.tapError((e) => Effect.logError(e)),
					Effect.tapError((e) => Effect.sync(() => Sentry.captureException(e))),
					Effect.catch(() => Effect.void),
				),
			)

			return DaemonSupervisor.of({
				start,
				stop,
				isRunning,
				setManagementEnabled,
				lifecycleEvents: Stream.fromPubSub(lifecyclePubSub),
			})
		}),
	)
