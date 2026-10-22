import { describe, it } from '@effect/vitest'
import { TaskDiffWorkspace } from '@humanlayer/streams/diff'
import { Deferred, Effect, Fiber, Layer, Schema } from 'effect'
import { expect } from 'vitest'

import {
	DurableStreamsDiffProducerFactory,
	type DurableStreamsDiffProducer,
} from '../../src/effects/services/task-diff/durable-streams-diff-producer.service'
import {
	StreamFlushError,
	StreamRecoveryRequiredError,
	TaskDiffBaseUnavailableError,
} from '../../src/effects/services/task-diff/errors'
import { GitFileSystem } from '../../src/effects/services/task-diff/git-file-system.service'
import { TaskDiffLockRegistryLive } from '../../src/effects/services/task-diff/task-diff-lock-registry.layer'
import { TaskDiffServiceFactory } from '../../src/effects/services/task-diff/task-diff-service'
import { TaskDiffServiceFactoryLive } from '../../src/effects/services/task-diff/task-diff-service.layer'
import type { PendingCapture, TaskDiffRepoContext } from '../../src/effects/services/task-diff/types'
import { UnusedGitRequirements } from '../helpers/unused-repository-requirements'

const workspace = Schema.decodeUnknownSync(TaskDiffWorkspace)({
	organizationId: 'org-1',
	taskId: 'task-1',
	hostId: 'host-1',
	workspaceBaseDirectory: '/tmp/task-1',
	repos: [
		{ id: 'repo-1', absolutePath: '/tmp/task-1/repo-1', sourceRef: 'main' },
		{ id: 'repo-2', absolutePath: '/tmp/task-1/repo-2', sourceRef: 'origin/main' },
	],
})

const pendingFor = (repo: TaskDiffRepoContext): PendingCapture => ({
	repo,
	candidateIndexPath: `/tmp/${repo.id}.candidate`,
	candidateBasePath: `/tmp/${repo.id}.base-candidate`,
	publication: {
		mode: 'incremental',
		replaceFileProjection: false,
		baselines: [],
		versions: [],
		files: [],
		inserts: [],
		updates: [],
		deletes: [String(repo.id)],
	},
})

const producer = (publishChanges: DurableStreamsDiffProducer['publishChanges'] = () => Effect.void) => ({
	prepareCapture: Effect.succeed({ versionMode: 'incremental' as const, replaceFileProjection: false }),
	publishChanges,
	completeCapture: Effect.void,
})

describe('TaskDiffService', () => {
	it.effect('retries an unavailable repo while successful siblings keep publishing', () => {
		const resolvedRepos: string[] = []
		const rebuiltRepos: string[] = []
		const gitFs = Layer.succeed(GitFileSystem, {
			resolveBase: (repo) => {
				resolvedRepos.push(String(repo.id))
				if (String(repo.id) === 'repo-2') {
					return Effect.succeed({ commit: 'base', strategy: 'source_commit' as const })
				}
				return Effect.fail(
					new TaskDiffBaseUnavailableError({
						message: 'no base',
						taskId: 'task-1',
						repoId: String(repo.id),
						repoPath: repo.absolutePath,
						sourceRef: repo.sourceRef,
						configuredRemotes: ['origin'],
						attemptedRefs: [repo.sourceRef],
						failures: [{ strategy: 'source_ref', input: repo.sourceRef, detail: 'missing' }],
					}),
				)
			},
			beginRebuild: (repo) => {
				rebuiltRepos.push(String(repo.id))
				return Effect.succeed(pendingFor(repo))
			},
			markPublished: () => Effect.void,
		})
		const producers = Layer.succeed(DurableStreamsDiffProducerFactory, {
			create: () => Effect.succeed(producer()),
		})
		const layer = TaskDiffServiceFactoryLive.pipe(
			Layer.provide(Layer.mergeAll(gitFs, producers, TaskDiffLockRegistryLive)),
		)

		return Effect.gen(function* () {
			const factory = yield* TaskDiffServiceFactory
			const service = yield* factory.create(workspace)
			yield* service.requestCapture({ taskId: 'task-1', sessionId: 'session-1' })
			yield* service.suspend
			yield* service.resume
			yield* service.drain
			expect(resolvedRepos.sort()).toEqual(['repo-1', 'repo-1', 'repo-2', 'repo-2'])
			expect(rebuiltRepos).toEqual(['repo-2', 'repo-2'])
		}).pipe(Effect.scoped, Effect.provide(layer), Effect.provide(UnusedGitRequirements))
	})

	it.effect('resolves the base again after a publication failure', () => {
		let resolutionCount = 0
		let rebuildCount = 0
		const gitFs = Layer.succeed(GitFileSystem, {
			resolveBase: () => {
				resolutionCount += 1
				return Effect.succeed({ commit: 'base', strategy: 'source_commit' as const })
			},
			beginRebuild: (repo) => {
				rebuildCount += 1
				return Effect.succeed(pendingFor(repo))
			},
			markPublished: () => Effect.void,
		})
		const producers = Layer.succeed(DurableStreamsDiffProducerFactory, {
			create: () =>
				Effect.succeed(
					producer(() => Effect.fail(new StreamFlushError({ message: 'failed', stream: 'files' }))),
				),
		})
		const layer = TaskDiffServiceFactoryLive.pipe(
			Layer.provide(Layer.mergeAll(gitFs, producers, TaskDiffLockRegistryLive)),
		)

		return Effect.gen(function* () {
			const factory = yield* TaskDiffServiceFactory
			const service = yield* factory.create({ ...workspace, repos: workspace.repos.slice(0, 1) })
			yield* service.requestCapture({ taskId: 'task-1', sessionId: 'session-1' })
			yield* service.suspend
			yield* service.resume
			yield* service.drain
			expect(resolutionCount).toBe(2)
			expect(rebuildCount).toBe(2)
		}).pipe(Effect.scoped, Effect.provide(layer), Effect.provide(UnusedGitRequirements))
	})

	it.effect('retries once with a full capture when streams change during publication', () => {
		const captureModes: string[] = []
		let prepareCount = 0
		let publishCount = 0
		let completedCaptures = 0
		const gitFs = Layer.succeed(GitFileSystem, {
			resolveBase: () => Effect.succeed({ commit: 'base', strategy: 'source_commit' as const }),
			beginRebuild: (repo, _base, requirements) =>
				Effect.sync(() => {
					captureModes.push(requirements.versionMode)
					return pendingFor(repo)
				}),
			markPublished: () => Effect.void,
		})
		const producers = Layer.succeed(DurableStreamsDiffProducerFactory, {
			create: () =>
				Effect.succeed({
					prepareCapture: Effect.sync(() => ({
						versionMode: ++prepareCount === 1 ? ('incremental' as const) : ('full' as const),
						replaceFileProjection: prepareCount > 1,
					})),
					publishChanges: () =>
						Effect.suspend(() => {
							publishCount += 1
							return publishCount === 1
								? Effect.fail(new StreamRecoveryRequiredError({ message: 'streams changed' }))
								: Effect.void
						}),
					completeCapture: Effect.sync(() => {
						completedCaptures += 1
					}),
				}),
		})
		const layer = TaskDiffServiceFactoryLive.pipe(
			Layer.provide(Layer.mergeAll(gitFs, producers, TaskDiffLockRegistryLive)),
		)

		return Effect.gen(function* () {
			const factory = yield* TaskDiffServiceFactory
			const service = yield* factory.create({ ...workspace, repos: workspace.repos.slice(0, 1) })
			yield* service.requestCapture({ taskId: 'task-1', sessionId: 'session-1' })
			yield* service.drain
			expect(captureModes).toEqual(['incremental', 'full'])
			expect(publishCount).toBe(2)
			expect(completedCaptures).toBe(1)
		}).pipe(Effect.scoped, Effect.provide(layer), Effect.provide(UnusedGitRequirements))
	})

	it.effect('absorbs one repo failure while successful siblings advance', () => {
		const began: string[] = []
		const marked: string[] = []
		const gitFs = Layer.succeed(GitFileSystem, {
			resolveBase: () => Effect.succeed({ commit: 'base', strategy: 'source_commit' as const }),
			beginRebuild: (repo) =>
				Effect.sync(() => {
					began.push(String(repo.id))
					return pendingFor(repo)
				}),
			markPublished: (pending) => Effect.sync(() => marked.push(String(pending.repo.id))),
		})
		const producers = Layer.succeed(DurableStreamsDiffProducerFactory, {
			create: () =>
				Effect.succeed(
					producer((publication) =>
						publication.deletes.includes('repo-1')
							? Effect.fail(new StreamFlushError({ message: 'failed', stream: 'files' }))
							: Effect.void,
					),
				),
		})
		const layer = TaskDiffServiceFactoryLive.pipe(
			Layer.provide(Layer.mergeAll(gitFs, producers, TaskDiffLockRegistryLive)),
		)

		return Effect.gen(function* () {
			const factory = yield* TaskDiffServiceFactory
			const service = yield* factory.create(workspace)
			yield* service.requestCapture({ taskId: 'task-1', sessionId: 'session-1' })
			yield* service.drain
			expect(began.sort()).toEqual(['repo-1', 'repo-2'])
			expect(marked).toEqual(['repo-2'])
		}).pipe(Effect.scoped, Effect.provide(layer), Effect.provide(UnusedGitRequirements))
	})

	it.effect('applies a fresh independent base to each repository capture', () => {
		const resolutionCounts = new Map<string, number>()
		const rebuilt: Array<{ repoId: string; base: string }> = []
		const gitFs = Layer.succeed(GitFileSystem, {
			resolveBase: (repo) => {
				const repoId = String(repo.id)
				const count = (resolutionCounts.get(repoId) ?? 0) + 1
				resolutionCounts.set(repoId, count)
				return Effect.succeed({
					commit: `${repoId}-base-${count}`,
					strategy: 'source_ref' as const,
					resolvedRef: repo.sourceRef,
				})
			},
			beginRebuild: (repo, resolution) =>
				Effect.sync(() => {
					rebuilt.push({ repoId: String(repo.id), base: resolution.commit })
					return pendingFor(repo)
				}),
			markPublished: () => Effect.void,
		})
		const producers = Layer.succeed(DurableStreamsDiffProducerFactory, {
			create: () => Effect.succeed(producer()),
		})
		const layer = TaskDiffServiceFactoryLive.pipe(
			Layer.provide(Layer.mergeAll(gitFs, producers, TaskDiffLockRegistryLive)),
		)

		return Effect.gen(function* () {
			const factory = yield* TaskDiffServiceFactory
			const service = yield* factory.create(workspace)
			yield* service.requestCapture({ taskId: 'task-1', sessionId: 'session-1' })
			yield* service.suspend
			yield* service.resume
			yield* service.drain
			expect(rebuilt.sort((a, b) => a.repoId.localeCompare(b.repoId) || a.base.localeCompare(b.base))).toEqual([
				{ repoId: 'repo-1', base: 'repo-1-base-1' },
				{ repoId: 'repo-1', base: 'repo-1-base-2' },
				{ repoId: 'repo-2', base: 'repo-2-base-1' },
				{ repoId: 'repo-2', base: 'repo-2-base-2' },
			])
		}).pipe(Effect.scoped, Effect.provide(layer), Effect.provide(UnusedGitRequirements))
	})

	it.effect('keeps only the latest follow-up request while capture is running', () =>
		Effect.gen(function* () {
			const firstStarted = yield* Deferred.make<void>()
			const releaseFirst = yield* Deferred.make<void>()
			const sessions: string[] = []
			let captureCount = 0
			const gitFs = Layer.succeed(GitFileSystem, {
				resolveBase: () => Effect.succeed({ commit: 'base', strategy: 'source_commit' as const }),
				beginRebuild: (repo) =>
					Effect.gen(function* () {
						captureCount += 1
						sessions.push(repo.sessionId)
						if (captureCount === 1) {
							yield* Deferred.succeed(firstStarted, undefined)
							yield* Deferred.await(releaseFirst)
						}
						return pendingFor(repo)
					}),
				markPublished: () => Effect.void,
			})
			const producers = Layer.succeed(DurableStreamsDiffProducerFactory, {
				create: () => Effect.succeed(producer()),
			})
			const layer = TaskDiffServiceFactoryLive.pipe(
				Layer.provide(Layer.mergeAll(gitFs, producers, TaskDiffLockRegistryLive)),
			)
			const program = Effect.gen(function* () {
				const factory = yield* TaskDiffServiceFactory
				const service = yield* factory.create({ ...workspace, repos: workspace.repos.slice(0, 1) })
				yield* service.requestCapture({ taskId: 'task-1', sessionId: 'session-1' })
				yield* Deferred.await(firstStarted)
				yield* service.requestCapture({ taskId: 'task-1', sessionId: 'session-2' })
				yield* service.requestCapture({ taskId: 'task-1', sessionId: 'session-3' })
				yield* Deferred.succeed(releaseFirst, undefined)
				yield* service.drain
				expect(sessions).toEqual(['session-1', 'session-3'])
			})
			yield* program.pipe(Effect.scoped, Effect.provide(layer), Effect.provide(UnusedGitRequirements))
		}),
	)

	it.effect('waits for a running capture to become idle before draining', () =>
		Effect.gen(function* () {
			const captureStarted = yield* Deferred.make<void>()
			const releaseCapture = yield* Deferred.make<void>()
			const gitFs = Layer.succeed(GitFileSystem, {
				resolveBase: () => Effect.succeed({ commit: 'base', strategy: 'source_commit' as const }),
				beginRebuild: (repo) =>
					Effect.gen(function* () {
						yield* Deferred.succeed(captureStarted, undefined)
						yield* Deferred.await(releaseCapture)
						return pendingFor(repo)
					}),
				markPublished: () => Effect.void,
			})
			const producers = Layer.succeed(DurableStreamsDiffProducerFactory, {
				create: () => Effect.succeed(producer()),
			})
			const layer = TaskDiffServiceFactoryLive.pipe(
				Layer.provide(Layer.mergeAll(gitFs, producers, TaskDiffLockRegistryLive)),
			)

			const program = Effect.gen(function* () {
				const factory = yield* TaskDiffServiceFactory
				const service = yield* factory.create({ ...workspace, repos: workspace.repos.slice(0, 1) })
				yield* service.requestCapture({ taskId: 'task-1', sessionId: 'session-1' })
				yield* Deferred.await(captureStarted)
				const drainFinished = yield* Deferred.make<void>()
				const drainFiber = yield* Effect.forkChild(
					service.drain.pipe(Effect.andThen(Deferred.succeed(drainFinished, undefined))),
				)
				yield* Effect.yieldNow
				expect(yield* Deferred.isDone(drainFinished)).toBe(false)
				yield* Deferred.succeed(releaseCapture, undefined)
				yield* Fiber.join(drainFiber)
				expect(yield* Deferred.isDone(drainFinished)).toBe(true)
			})

			yield* program.pipe(Effect.scoped, Effect.provide(layer), Effect.provide(UnusedGitRequirements))
		}),
	)
})
