import { Effect, Layer, Scope, Semaphore } from 'effect'

import { TaskDiffLifecycleObserver } from './task-diff-lifecycle-observer.service'
import { reportTaskDiffError } from './task-diff-observability'
import { TaskDiffServiceRegistry } from './task-diff-service-registry.service'
import type {
	TaskDiffLifecycleInitialState,
	TaskDiffTaskLifecycleState,
	TaskDiffWorkspace,
	TaskDiffWorkspaceLifecycleState,
} from './types'

export const TaskDiffLifecycleObserverLive = Layer.effect(
	TaskDiffLifecycleObserver,
	Effect.gen(function* () {
		const registry = yield* TaskDiffServiceRegistry
		const scope = yield* Scope.Scope
		const lock = Semaphore.makeUnsafe(1)
		const tasks = new Map<string, boolean>()
		const workspaces = new Map<string, TaskDiffWorkspace>()
		let active = true

		yield* Scope.addFinalizer(
			scope,
			Effect.sync(() => {
				active = false
				tasks.clear()
				workspaces.clear()
			}),
		)

		const absorb = (operation: string, taskId: string) =>
			Effect.catchCause((cause: unknown) => reportTaskDiffError(cause, operation, { taskId }))
		const register = (workspace: TaskDiffWorkspace) =>
			registry
				.registerWorkspace(workspace)
				.pipe(
					Effect.catchTag('TaskDiffServiceRegistrationError', (error) =>
						reportTaskDiffError(error, 'lifecycle.register', { taskId: error.taskId }),
					),
				)

		const initialize = (state: TaskDiffLifecycleInitialState) =>
			lock.withPermits(1)(
				Effect.gen(function* () {
					if (!active) return
					for (const task of state.tasks) tasks.set(task.taskId, task.archived)
					for (const item of state.workspaces) {
						if (item.workspace) workspaces.set(item.taskId, item.workspace)
						else workspaces.delete(item.taskId)
					}
					yield* Effect.forEach(
						workspaces,
						([taskId, workspace]) => (tasks.get(taskId) === true ? Effect.void : register(workspace)),
						{ concurrency: 4, discard: true },
					)
				}).pipe(
					absorb('lifecycle.initialize', 'initial'),
					Effect.withSpan('task_diff.lifecycle.initialize', {
						attributes: { task_count: state.tasks.length, workspace_count: state.workspaces.length },
					}),
				),
			)

		const observeTask = (state: TaskDiffTaskLifecycleState) =>
			lock.withPermits(1)(
				Effect.gen(function* () {
					if (!active) return
					const previous = tasks.get(state.taskId)
					tasks.set(state.taskId, state.archived)
					if (previous === undefined || previous === state.archived) return
					if (state.archived) return yield* registry.suspendWorkspace(state.taskId)
					const workspace = workspaces.get(state.taskId)
					if (workspace) yield* registry.resumeWorkspace(workspace)
				}).pipe(
					Effect.catchTag('TaskDiffServiceRegistrationError', (error) =>
						reportTaskDiffError(error, 'lifecycle.resume', { taskId: error.taskId }),
					),
					absorb('lifecycle.observe_task', state.taskId),
					Effect.withSpan('task_diff.lifecycle.observe_task', {
						attributes: { task_id: state.taskId, archived: state.archived },
					}),
				),
			)

		const observeWorkspace = (state: TaskDiffWorkspaceLifecycleState) =>
			lock.withPermits(1)(
				Effect.gen(function* () {
					if (!active || !state.workspace) return
					workspaces.set(state.taskId, state.workspace)
					if (tasks.get(state.taskId) === true) return yield* registry.suspendWorkspace(state.taskId)
					yield* register(state.workspace)
				}).pipe(
					absorb('lifecycle.observe_workspace', state.taskId),
					Effect.withSpan('task_diff.lifecycle.observe_workspace', {
						attributes: { task_id: state.taskId, ready: state.workspace !== undefined },
					}),
				),
			)

		return TaskDiffLifecycleObserver.of({ initialize, observeTask, observeWorkspace })
	}),
)
