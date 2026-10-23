import { Deferred, Effect, Exit, Layer, Option, Ref, Scope, Semaphore } from 'effect'

import {
	DurableStreamsDiffProducerFactory,
	type DurableStreamsDiffProducer,
} from './durable-streams-diff-producer.service'
import { TaskDiffServiceRegistrationError } from './errors'
import type { GitCommandRunnerRequirements } from './git-command-runner.service'
import { GitFileSystem } from './git-file-system.service'
import { TaskDiffLockRegistry } from './task-diff-lock-registry.service'
import { reportTaskDiffError } from './task-diff-observability'
import { TaskDiffServiceFactory, type TaskDiffService } from './task-diff-service'
import { makeTaskRepoLockKey, type TaskDiffCaptureRequest, type TaskDiffRepoContext } from './types'

interface SchedulerState {
	readonly accepting: boolean
	readonly running: boolean
	readonly idleSignal: Option.Option<Deferred.Deferred<void>>
	readonly latest: Option.Option<TaskDiffCaptureRequest>
	readonly lastRequest: Option.Option<TaskDiffCaptureRequest>
}

interface ProducerState {
	readonly producer: DurableStreamsDiffProducer
	readonly scope: Scope.Closeable
}

export const TaskDiffServiceFactoryLive = Layer.effect(
	TaskDiffServiceFactory,
	Effect.gen(function* () {
		const gitFs = yield* GitFileSystem
		const locks = yield* TaskDiffLockRegistry
		const producerFactory = yield* DurableStreamsDiffProducerFactory

		return TaskDiffServiceFactory.of({
			create: (workspace) =>
				Effect.gen(function* () {
					const makeProducer = Effect.gen(function* () {
						const producerScope = yield* Scope.make()
						const producer = yield* producerFactory.create(workspace).pipe(
							Effect.provideService(Scope.Scope, producerScope),
							Effect.onError(() => Scope.close(producerScope, Exit.void)),
						)
						return { producer, scope: producerScope } satisfies ProducerState
					})
					let producerState: ProducerState | undefined = yield* makeProducer
					const scheduler = yield* Ref.make<SchedulerState>({
						accepting: true,
						running: false,
						idleSignal: Option.none(),
						latest: Option.none(),
						lastRequest: Option.none(),
					})
					const scope = yield* Scope.Scope
					const lifecycleLock = Semaphore.makeUnsafe(1)
					yield* Scope.addFinalizer(
						scope,
						Effect.suspend(() =>
							producerState ? Scope.close(producerState.scope, Exit.void) : Effect.void,
						),
					)
					const resolveRepoBase = (context: Parameters<typeof gitFs.resolveBase>[0]) =>
						gitFs.resolveBase(context).pipe(
							Effect.tap((resolution) =>
								Effect.logInfo('Task diff base resolved').pipe(
									Effect.annotateLogs({
										taskId: String(workspace.taskId),
										repoId: String(context.id),
										strategy: resolution.strategy,
										baseCommit: resolution.commit,
									}),
								),
							),
						)

					const capture = (
						request: TaskDiffCaptureRequest,
						retryStreamRecovery = true,
					): Effect.Effect<void, never, GitCommandRunnerRequirements> =>
						Effect.suspend(() => {
							const activeProducer = producerState?.producer
							if (!activeProducer) return Effect.void
							return activeProducer.prepareCapture.pipe(
								Effect.flatMap((captureRequirements) =>
									Effect.forEach(
										workspace.repos,
										(repo) => {
											const context: TaskDiffRepoContext = {
												...repo,
												organizationId: workspace.organizationId,
												taskId: workspace.taskId,
												hostId: workspace.hostId,
												workspaceBaseDirectory: workspace.workspaceBaseDirectory,
												sessionId: request.sessionId,
											}
											return Effect.gen(function* () {
												const resolution = yield* resolveRepoBase(context)
												return yield* Effect.scoped(
													Effect.acquireUseRelease(
														gitFs.beginRebuild(context, resolution, captureRequirements),
														(pending) => activeProducer.publishChanges(pending.publication),
														(pending, exit) =>
															Exit.isSuccess(exit)
																? gitFs.markPublished(pending)
																: Effect.void,
													),
												).pipe(Effect.as('published' as const))
											}).pipe(
												locks.withTaskRepoLock(
													makeTaskRepoLockKey(String(workspace.taskId), String(repo.id)),
												),
												Effect.catchTag('GitCommandFailedError', () =>
													Effect.succeed('failed' as const),
												),
												Effect.tapError((error) =>
													reportTaskDiffError(error, 'capture.repo', {
														taskId: String(workspace.taskId),
														repoId: String(repo.id),
														sessionId: request.sessionId,
													}),
												),
												Effect.catchTags({
													GitBinaryMissingError: () => Effect.succeed('failed' as const),
													GitTimeoutError: () => Effect.succeed('failed' as const),
													ShadowIndexWriteError: () => Effect.succeed('failed' as const),
													TaskDiffBaseUnavailableError: () =>
														Effect.succeed('failed' as const),
													StreamAppendError: () => Effect.succeed('failed' as const),
													StreamFlushError: () => Effect.succeed('failed' as const),
													StreamInitializationError: () => Effect.succeed('failed' as const),
													StreamRecoveryRequiredError: () =>
														Effect.succeed('recovery' as const),
												}),
											)
										},
										{ concurrency: 4 },
									).pipe(
										Effect.flatMap((repoResults) =>
											repoResults.every((result) => result === 'published')
												? activeProducer.completeCapture
												: retryStreamRecovery && repoResults.includes('recovery')
													? capture(request, false)
													: Effect.void,
										),
									),
								),
								Effect.catchTag('StreamInitializationError', () => Effect.void),
							)
						}).pipe(
							Effect.catchCause((cause) =>
								reportTaskDiffError(cause, 'capture.defect', {
									taskId: String(workspace.taskId),
									sessionId: request.sessionId,
								}),
							),
							Effect.withSpan('task_diff.capture', {
								attributes: { task_id: String(workspace.taskId), session_id: request.sessionId },
							}),
						)

					const finishRun = (idleSignal: Deferred.Deferred<void>) =>
						Effect.uninterruptible(
							Ref.modify(scheduler, (state) => {
								if (!state.running || !Option.contains(state.idleSignal, idleSignal)) {
									return [false, state] as const
								}
								return [
									true,
									{ ...state, running: false, idleSignal: Option.none(), latest: Option.none() },
								] as const
							}).pipe(
								Effect.flatMap((finished) =>
									finished
										? Deferred.succeed(idleSignal, undefined).pipe(Effect.asVoid)
										: Effect.void,
								),
							),
						)

					const runLoop = (
						initial: TaskDiffCaptureRequest,
						idleSignal: Deferred.Deferred<void>,
					): Effect.Effect<void, never, GitCommandRunnerRequirements> =>
						capture(initial).pipe(
							Effect.andThen(
								Ref.modify(scheduler, (state) => {
									if (Option.isSome(state.latest)) {
										return [state.latest, { ...state, latest: Option.none() }] as const
									}
									return [Option.none<TaskDiffCaptureRequest>(), state] as const
								}),
							),
							Effect.flatMap((next) =>
								Option.isSome(next) ? runLoop(next.value, idleSignal) : finishRun(idleSignal),
							),
							Effect.ensuring(finishRun(idleSignal)),
						)

					return {
						requestCapture: (request) =>
							Effect.gen(function* () {
								const idleSignal = yield* Deferred.make<void>()
								const start = yield* Ref.modify(scheduler, (state) => {
									if (!state.accepting) return [false, state] as const
									if (state.running) {
										return [
											false,
											{
												...state,
												latest: Option.some(request),
												lastRequest: Option.some(request),
											},
										] as const
									}
									return [
										true,
										{
											...state,
											running: true,
											idleSignal: Option.some(idleSignal),
											lastRequest: Option.some(request),
										},
									] as const
								})
								if (start) {
									yield* Effect.forkIn(Effect.interruptible(runLoop(request, idleSignal)), scope)
								}
							}).pipe(
								Effect.uninterruptible,
								Effect.asVoid,
								Effect.withSpan('task_diff.request_capture', {
									attributes: { task_id: request.taskId, session_id: request.sessionId },
								}),
							),
						suspend: lifecycleLock.withPermits(1)(
							Ref.update(scheduler, (state) => ({
								...state,
								accepting: false,
								latest: Option.none(),
							})).pipe(
								Effect.andThen(
									Effect.gen(function* () {
										const state = yield* Ref.get(scheduler)
										if (Option.isSome(state.idleSignal))
											yield* Deferred.await(state.idleSignal.value)
										if (!producerState) return
										const current = producerState
										producerState = undefined
										yield* Scope.close(current.scope, Exit.void)
									}),
								),
								Effect.withSpan('task_diff.suspend', {
									attributes: { task_id: String(workspace.taskId) },
								}),
							),
						),
						resume: lifecycleLock.withPermits(1)(
							Effect.gen(function* () {
								if (producerState) return
								producerState = yield* makeProducer.pipe(
									Effect.catchTag('StreamInitializationError', (cause) =>
										Effect.fail(
											new TaskDiffServiceRegistrationError({
												message: 'Failed to recreate task diff producer',
												taskId: String(workspace.taskId),
												cause,
											}),
										),
									),
								)
								const idleSignal = yield* Deferred.make<void>()
								const request = yield* Ref.modify(scheduler, (state) => {
									if (Option.isNone(state.lastRequest)) {
										return [
											Option.none<TaskDiffCaptureRequest>(),
											{ ...state, accepting: true },
										] as const
									}
									return [
										state.lastRequest,
										{
											...state,
											accepting: true,
											running: true,
											idleSignal: Option.some(idleSignal),
										},
									] as const
								})
								if (Option.isSome(request)) {
									yield* Effect.forkIn(runLoop(request.value, idleSignal), scope)
								}
							}).pipe(
								Effect.withSpan('task_diff.resume', {
									attributes: { task_id: String(workspace.taskId) },
								}),
							),
						),
						drain: lifecycleLock.withPermits(1)(
							Ref.modify(scheduler, (state) => [state.idleSignal, { ...state, accepting: false }]).pipe(
								Effect.flatMap((idleSignal) =>
									Option.isSome(idleSignal) ? Deferred.await(idleSignal.value) : Effect.void,
								),
								Effect.withSpan('task_diff.drain', {
									attributes: { task_id: String(workspace.taskId) },
								}),
							),
						),
					} satisfies TaskDiffService
				}).pipe(
					Effect.tapError((error) =>
						reportTaskDiffError(error, 'service.create', { taskId: String(workspace.taskId) }),
					),
					Effect.catchTag('StreamInitializationError', (cause) =>
						Effect.fail(
							new TaskDiffServiceRegistrationError({
								message: 'Failed to create task diff producer',
								taskId: String(workspace.taskId),
								cause,
							}),
						),
					),
					Effect.withSpan('task_diff.service.create', {
						attributes: { task_id: String(workspace.taskId), repo_count: workspace.repos.length },
					}),
				),
		})
	}),
)
