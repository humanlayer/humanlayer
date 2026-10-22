import { describe, it } from '@effect/vitest'
import { TaskDiffWorkspace } from '@humanlayer/streams/diff'
import { Effect, Layer, Schema } from 'effect'
import { expect } from 'vitest'

import { TaskDiffLifecycleObserverLive } from '../../src/effects/services/task-diff/task-diff-lifecycle-observer.layer'
import { TaskDiffLifecycleObserver } from '../../src/effects/services/task-diff/task-diff-lifecycle-observer.service'
import { TaskDiffServiceRegistry } from '../../src/effects/services/task-diff/task-diff-service-registry.service'
import { UnusedGitRequirements } from '../helpers/unused-repository-requirements'

const workspace = Schema.decodeUnknownSync(TaskDiffWorkspace)({
	organizationId: 'org-1',
	taskId: 'task-1',
	hostId: 'host-1',
	workspaceBaseDirectory: '/tmp/task-1',
	repos: [{ id: 'repo-1', absolutePath: '/tmp/task-1/repo-1', sourceRef: 'main' }],
})

describe('TaskDiffLifecycleObserver', () => {
	it.effect('suppresses initial archive actions and deduplicates archive transitions', () => {
		const operations: string[] = []
		const registry = Layer.succeed(TaskDiffServiceRegistry, {
			requestCapture: () => Effect.void,
			registerWorkspace: () => Effect.sync(() => operations.push('register')).pipe(Effect.asVoid),
			suspendWorkspace: () => Effect.sync(() => operations.push('suspend')).pipe(Effect.asVoid),
			resumeWorkspace: () => Effect.sync(() => operations.push('resume')).pipe(Effect.asVoid),
			drain: Effect.void,
		})
		const layer = TaskDiffLifecycleObserverLive.pipe(Layer.provide(registry))

		return Effect.gen(function* () {
			const observer = yield* TaskDiffLifecycleObserver
			yield* observer.initialize({
				tasks: [{ taskId: 'task-1', archived: false }],
				workspaces: [{ taskId: 'task-1', workspace }],
			})
			yield* observer.observeTask({ taskId: 'task-1', archived: false })
			yield* observer.observeTask({ taskId: 'task-1', archived: true })
			yield* observer.observeTask({ taskId: 'task-1', archived: true })
			yield* observer.observeTask({ taskId: 'task-1', archived: false })

			expect(operations).toEqual(['register', 'suspend', 'resume'])
		}).pipe(Effect.provide(layer), Effect.provide(UnusedGitRequirements))
	})

	it.effect('retains services across workspace absence and absorbs callback defects', () => {
		const operations: string[] = []
		const registry = Layer.succeed(TaskDiffServiceRegistry, {
			requestCapture: () => Effect.void,
			registerWorkspace: () => Effect.die('registration defect'),
			suspendWorkspace: () => Effect.void,
			resumeWorkspace: () => Effect.void,
			drain: Effect.void,
		})
		const layer = TaskDiffLifecycleObserverLive.pipe(Layer.provide(registry))

		return Effect.gen(function* () {
			const observer = yield* TaskDiffLifecycleObserver
			yield* observer.initialize({ tasks: [{ taskId: 'task-1', archived: false }], workspaces: [] })
			yield* observer.observeWorkspace({ taskId: 'task-1', workspace: undefined })
			yield* observer.observeWorkspace({ taskId: 'task-1', workspace })

			expect(operations).toEqual([])
		}).pipe(Effect.provide(layer), Effect.provide(UnusedGitRequirements))
	})
})
