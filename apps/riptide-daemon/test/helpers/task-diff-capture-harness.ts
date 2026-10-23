import { TaskDiffWorkspace } from '@humanlayer/streams/diff'
import { Deferred, Effect, Layer, ManagedRuntime, Schema } from 'effect'

import type { TaskDiffRuntime } from '../../src/effects/runtime'
import { DurableStreamsDiffProducerFactory } from '../../src/effects/services/task-diff/durable-streams-diff-producer.service'
import { GitFileSystem } from '../../src/effects/services/task-diff/git-file-system.service'
import { TaskDiffLockRegistryLive } from '../../src/effects/services/task-diff/task-diff-lock-registry.layer'
import { TaskDiffServiceRegistryLive } from '../../src/effects/services/task-diff/task-diff-service-registry.layer'
import { TaskDiffServiceRegistry } from '../../src/effects/services/task-diff/task-diff-service-registry.service'
import { TaskDiffServiceFactoryLive } from '../../src/effects/services/task-diff/task-diff-service.layer'
import type { PendingCapture, TaskDiffRepoContext } from '../../src/effects/services/task-diff/types'
import { UnusedGitRequirements } from './unused-repository-requirements'

const workspace = Schema.decodeUnknownSync(TaskDiffWorkspace)({
	organizationId: 'org-1',
	taskId: 'task-1',
	hostId: 'host-1',
	workspaceBaseDirectory: '/tmp/task-1',
	repos: [{ id: 'repo-1', absolutePath: '/tmp/task-1/repo-1', sourceRef: 'main' }],
})

const pendingFor = (repo: TaskDiffRepoContext): PendingCapture => ({
	repo,
	candidateIndexPath: '/tmp/task-diff-candidate-index',
	candidateBasePath: '/tmp/task-diff-candidate-base',
	publication: {
		mode: 'incremental',
		replaceFileProjection: false,
		baselines: [],
		versions: [],
		files: [],
		inserts: [],
		updates: [],
		deletes: [],
	},
})

export interface TaskDiffCaptureHarness {
	readonly runtime: TaskDiffRuntime
	readonly capturedRepos: ReadonlyArray<TaskDiffRepoContext>
	readonly waitForCapture: Effect.Effect<void>
	readonly releaseAndDispose: Effect.Effect<void>
}

export const makeTaskDiffCaptureHarness = Effect.gen(function* () {
	const captureStarted = yield* Deferred.make<void>()
	const releaseCapture = yield* Deferred.make<void>()
	const capturedRepos: TaskDiffRepoContext[] = []
	const gitFileSystem = Layer.succeed(GitFileSystem, {
		resolveBase: () => Effect.succeed({ commit: 'base', strategy: 'source_commit' as const }),
		beginRebuild: (repo) =>
			Effect.gen(function* () {
				capturedRepos.push(repo)
				yield* Deferred.succeed(captureStarted, undefined)
				yield* Deferred.await(releaseCapture)
				return pendingFor(repo)
			}),
		markPublished: () => Effect.void,
	})
	const producers = Layer.succeed(DurableStreamsDiffProducerFactory, {
		create: () =>
			Effect.succeed({
				prepareCapture: Effect.succeed({ versionMode: 'incremental' as const, replaceFileProjection: false }),
				publishChanges: () => Effect.void,
				completeCapture: Effect.void,
			}),
	})
	const serviceFactory = TaskDiffServiceFactoryLive.pipe(
		Layer.provide(Layer.mergeAll(gitFileSystem, producers, TaskDiffLockRegistryLive)),
	)
	const runtime = ManagedRuntime.make(
		TaskDiffServiceRegistryLive.pipe(Layer.provide(serviceFactory), Layer.provideMerge(UnusedGitRequirements)),
	)

	yield* Effect.promise(() =>
		runtime.runPromise(
			Effect.gen(function* () {
				const registry = yield* TaskDiffServiceRegistry
				yield* registry.registerWorkspace(workspace)
			}),
		),
	)

	return {
		runtime,
		capturedRepos,
		waitForCapture: Deferred.await(captureStarted),
		releaseAndDispose: Effect.gen(function* () {
			yield* Deferred.succeed(releaseCapture, undefined)
			yield* Effect.promise(() =>
				runtime.runPromise(
					Effect.gen(function* () {
						const registry = yield* TaskDiffServiceRegistry
						yield* registry.drain
					}),
				),
			)
			yield* Effect.promise(() => runtime.dispose())
		}),
	} satisfies TaskDiffCaptureHarness
})
