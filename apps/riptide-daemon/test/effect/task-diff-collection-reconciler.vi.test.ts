import { describe, it } from '@effect/vitest'
import { Effect, Layer, Logger } from 'effect'
import * as Path from 'effect/Path'
import { expect } from 'vitest'

import { reconcileTaskDiffCollectionsFromCallback } from '../../src/effects/services/task-diff/task-diff-collection-lifecycle'
import { reconcileTaskDiffCollections } from '../../src/effects/services/task-diff/task-diff-collection-reconciler'
import { TaskDiffLifecycleObserverLive } from '../../src/effects/services/task-diff/task-diff-lifecycle-observer.layer'
import { TaskDiffServiceFactory } from '../../src/effects/services/task-diff/task-diff-service'
import { TaskDiffServiceRegistryLive } from '../../src/effects/services/task-diff/task-diff-service-registry.layer'
import { TaskDiffServiceRegistry } from '../../src/effects/services/task-diff/task-diff-service-registry.service'
import { makeTaskDiffWorkspaceForLifecycle } from '../../src/effects/services/task-diff/task-diff-workspace'
import { TaskWorkspaceContext } from '../../src/effects/services/task-workspace-context/task-workspace-context.service'
import { UnusedGitRequirements } from '../helpers/unused-repository-requirements'

/** Legacy tasks never consult the project-workspace context; reaching it is a defect. */
const UnusedTaskWorkspaceContext = Layer.mock(TaskWorkspaceContext, {})

const task = {
	id: 'task-1',
	organization_id: 'org-1',
	archived: false,
	workspace_state: {
		workspaceBaseDirectory: '/tmp/task-1',
		repos: [{ path: 'repo-1', sourceRef: 'main', branch: 'task-1', primary: true }],
	},
}

const session = {
	id: 'session-1',
	task_id: 'task-1',
	host_id: 'host-1',
	working_directory: '/tmp/task-1/repo-1',
	status: 'running',
	updated_at: 1n,
}

const orderingRegression = (arrivalOrder: 'session-before-task' | 'task-before-session') => {
	let registrationCount = 0
	let publicationCount = 0
	const tasks: Array<typeof task> = []
	const sessions: Array<typeof session> = []
	const collections = { tasks: { toArray: tasks }, sessions: { toArray: sessions } }
	const factory = Layer.succeed(TaskDiffServiceFactory, {
		create: () =>
			Effect.sync(() => {
				registrationCount += 1
				return {
					requestCapture: () => Effect.sync(() => publicationCount++).pipe(Effect.asVoid),
					suspend: Effect.void,
					resume: Effect.void,
					drain: Effect.void,
				}
			}),
	})
	const registry = TaskDiffServiceRegistryLive.pipe(Layer.provide(factory))
	const layer = TaskDiffLifecycleObserverLive.pipe(Layer.provideMerge(registry), Layer.provideMerge(Path.layer))
	const reconcile = reconcileTaskDiffCollections({ collections, taskIds: new Set(['task-1']) })

	return Effect.gen(function* () {
		if (arrivalOrder === 'session-before-task') {
			sessions.push(session)
			yield* reconcile
			tasks.push(task)
			yield* reconcile
		} else {
			tasks.push(task)
			yield* reconcile
			sessions.push(session)
			yield* reconcile
		}
		yield* reconcile
		const serviceRegistry = yield* TaskDiffServiceRegistry
		yield* serviceRegistry.requestCapture({ taskId: 'task-1', sessionId: 'post-tool-session' })
		expect(registrationCount).toBe(1)
		expect(publicationCount).toBe(1)
	}).pipe(Effect.provide(layer), Effect.provide(UnusedGitRequirements), Effect.provide(UnusedTaskWorkspaceContext))
}

describe('task diff collection reconciliation', () => {
	it.effect('registers once after session arrives before task', () => orderingRegression('session-before-task'))
	it.effect('registers once after task arrives before session', () => orderingRegression('task-before-session'))
	it.effect('keeps expected absence distinct from invalid workspace metadata', () =>
		Effect.gen(function* () {
			for (const missingTask of [
				{ ...task, organization_id: null },
				{ ...task, workspace_state: null },
				{ ...task, workspace_state: { ...task.workspace_state, repos: [] } },
				{
					...task,
					workspace_state: {
						...task.workspace_state,
						repos: task.workspace_state.repos.map((repo) => ({ ...repo, primary: false })),
					},
				},
			]) {
				expect(yield* makeTaskDiffWorkspaceForLifecycle(missingTask, session)).toBeNull()
			}
			expect(yield* makeTaskDiffWorkspaceForLifecycle(task, { ...session, task_id: 'other' })).toBeNull()
		}).pipe(Effect.provide(Path.layer)),
	)
	it.effect('reports invalid metadata without registration and accepts a corrected snapshot', () => {
		let registrationCount = 0
		const loggedMessages: unknown[] = []
		const repo = { path: 'repo-1', sourceRef: 'main', branch: 'task-1', primary: true }
		// Simulate corrupt collection metadata crossing the runtime boundary, without casting an error or mocking a module.
		Reflect.set(repo, 'sourceRef', null)
		const collections = {
			tasks: { toArray: [{ ...task, workspace_state: { ...task.workspace_state, repos: [repo] } }] },
			sessions: { toArray: [session] },
		}
		const input = { collections, taskIds: new Set([task.id]) }
		const factory = Layer.succeed(TaskDiffServiceFactory, {
			create: () =>
				Effect.sync(() => {
					registrationCount += 1
					return {
						requestCapture: () => Effect.void,
						suspend: Effect.void,
						resume: Effect.void,
						drain: Effect.void,
					}
				}),
		})
		const registry = TaskDiffServiceRegistryLive.pipe(Layer.provide(factory))
		const layer = TaskDiffLifecycleObserverLive.pipe(Layer.provideMerge(registry), Layer.provideMerge(Path.layer))
		return Effect.gen(function* () {
			let schemaFailureObserved = false
			yield* reconcileTaskDiffCollections(input).pipe(
				Effect.catchTag('SchemaError', () =>
					Effect.sync(() => {
						schemaFailureObserved = true
					}),
				),
			)
			expect(schemaFailureObserved).toBe(true)
			expect(registrationCount).toBe(0)
			yield* reconcileTaskDiffCollectionsFromCallback(input)
			expect(registrationCount).toBe(0)
			expect(loggedMessages).toEqual([
				['Task diff operation failed', expect.objectContaining({ _tag: 'SchemaError' })],
			])
			repo.sourceRef = 'main'
			yield* reconcileTaskDiffCollectionsFromCallback(input)
			expect(registrationCount).toBe(1)
			expect(loggedMessages).toHaveLength(1)
		}).pipe(
			Effect.provide(layer),
			Effect.provide(UnusedGitRequirements),
			Effect.provide(UnusedTaskWorkspaceContext),
			Effect.provide(Logger.layer([Logger.make(({ message }) => loggedMessages.push(message))])),
		)
	})
})
