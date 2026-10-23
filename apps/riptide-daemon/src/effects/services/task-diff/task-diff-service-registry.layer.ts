import { Duration, Effect, Exit, Fiber, Layer, Option, Scope, Semaphore } from 'effect'

import { reportTaskDiffError } from './task-diff-observability'
import { TaskDiffServiceFactory, type TaskDiffService } from './task-diff-service'
import { TaskDiffServiceRegistry } from './task-diff-service-registry.service'
import type { TaskDiffWorkspace } from './types'

interface RegistryEntry {
	readonly signature: string
	readonly generation: number
	readonly service: TaskDiffService
	readonly scope: Scope.Closeable
}

const serviceCleanupTimeout = Duration.seconds(2)

const workspaceSignature = (workspace: TaskDiffWorkspace): string =>
	JSON.stringify({
		organizationId: workspace.organizationId,
		hostId: workspace.hostId,
		workspaceBaseDirectory: workspace.workspaceBaseDirectory,
		repos: workspace.repos,
	})

export const TaskDiffServiceRegistryLive = Layer.effect(
	TaskDiffServiceRegistry,
	Effect.gen(function* () {
		const factory = yield* TaskDiffServiceFactory
		const parentScope = yield* Scope.Scope
		const entries = new Map<string, RegistryEntry>()
		const locks = new Map<string, Semaphore.Semaphore>()
		let accepting = true
		let drainStarted = false

		const lockFor = (taskId: string): Semaphore.Semaphore => {
			const existing = locks.get(taskId)
			if (existing) return existing
			const created = Semaphore.makeUnsafe(1)
			locks.set(taskId, created)
			return created
		}

		const drain = Effect.suspend(() => {
			if (drainStarted) return Effect.void
			drainStarted = true
			accepting = false
			const currentEntries = [...entries.values()]
			return Effect.forEach(
				currentEntries,
				(entry) =>
					Effect.gen(function* () {
						const cleanup = yield* entry.service.drain.pipe(
							Effect.andThen(Scope.close(entry.scope, Exit.void)),
							Effect.forkDetach,
						)
						const cleanedUp = yield* Fiber.join(cleanup).pipe(Effect.timeoutOption(serviceCleanupTimeout))
						if (Option.isNone(cleanedUp)) {
							yield* Effect.logWarning('Task diff service cleanup timed out; abandoning finalizers').pipe(
								Effect.annotateLogs({ signature: entry.signature, generation: entry.generation }),
							)
						}
					}),
				{ concurrency: 4, discard: true },
			).pipe(
				Effect.tap(() => Effect.sync(() => entries.clear())),
				Effect.catchCause((cause) =>
					reportTaskDiffError(cause, 'registry.drain', { serviceCount: currentEntries.length }),
				),
				Effect.withSpan('task_diff.registry.drain', {
					attributes: { service_count: currentEntries.length },
				}),
			)
		})

		yield* Scope.addFinalizer(parentScope, drain)

		return {
			registerWorkspace: (workspace) => {
				const taskId = String(workspace.taskId)
				return lockFor(taskId).withPermits(1)(
					Effect.gen(function* () {
						if (!accepting) {
							yield* Effect.logError('Ignoring task diff workspace registration after drain').pipe(
								Effect.annotateLogs({ taskId }),
							)
							return
						}
						const signature = workspaceSignature(workspace)
						const existing = entries.get(taskId)
						if (existing?.signature === signature) return

						if (existing) {
							yield* existing.service.drain
							yield* Scope.close(existing.scope, Exit.void)
							entries.delete(taskId)
						}
						const childScope = yield* Scope.make()
						const service = yield* factory.create(workspace).pipe(
							Effect.provideService(Scope.Scope, childScope),
							Effect.onError(() => Scope.close(childScope, Exit.void)),
						)
						entries.set(taskId, {
							signature,
							generation: (existing?.generation ?? 0) + 1,
							service,
							scope: childScope,
						})
					}).pipe(
						Effect.withSpan('task_diff.registry.register_workspace', { attributes: { task_id: taskId } }),
					),
				)
			},
			suspendWorkspace: (taskId) =>
				lockFor(taskId)
					.withPermits(1)(Effect.suspend(() => entries.get(taskId)?.service.suspend ?? Effect.void))
					.pipe(
						Effect.catchCause((cause) =>
							reportTaskDiffError(cause, 'registry.suspend_workspace', { taskId }),
						),
						Effect.withSpan('task_diff.registry.suspend_workspace', { attributes: { task_id: taskId } }),
					),
			resumeWorkspace: (workspace) => {
				const taskId = String(workspace.taskId)
				return lockFor(taskId).withPermits(1)(
					Effect.gen(function* () {
						const signature = workspaceSignature(workspace)
						const existing = entries.get(taskId)
						if (!existing || existing.signature !== signature) {
							if (existing) {
								yield* existing.service.drain
								yield* Scope.close(existing.scope, Exit.void)
								entries.delete(taskId)
							}
							const childScope = yield* Scope.make()
							const service = yield* factory.create(workspace).pipe(
								Effect.provideService(Scope.Scope, childScope),
								Effect.onError(() => Scope.close(childScope, Exit.void)),
							)
							entries.set(taskId, {
								signature,
								generation: (existing?.generation ?? 0) + 1,
								service,
								scope: childScope,
							})
							return
						}
						yield* existing.service.resume
					}).pipe(
						Effect.withSpan('task_diff.registry.resume_workspace', { attributes: { task_id: taskId } }),
					),
				)
			},
			requestCapture: (request) =>
				Effect.suspend(() => {
					if (!accepting) {
						return Effect.logError('Ignoring task diff capture request after registry drain').pipe(
							Effect.annotateLogs({ taskId: request.taskId, sessionId: request.sessionId }),
						)
					}
					const entry = entries.get(request.taskId)
					if (!entry) {
						return Effect.logDebug('Ignoring task diff capture request without a ready workspace').pipe(
							Effect.annotateLogs({ taskId: request.taskId, sessionId: request.sessionId }),
						)
					}
					return entry.service.requestCapture(request)
				}).pipe(
					Effect.withSpan('task_diff.registry.request_capture', { attributes: { task_id: request.taskId } }),
				),
			drain,
		}
	}),
)
