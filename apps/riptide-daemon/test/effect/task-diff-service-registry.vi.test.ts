import { describe, it } from '@effect/vitest'
import { TaskDiffWorkspace } from '@humanlayer/streams/diff'
import { Deferred, Effect, Fiber, Layer, Schema, Scope } from 'effect'
import { TestClock } from 'effect/testing'
import { expect } from 'vitest'

import { TaskDiffServiceFactory } from '../../src/effects/services/task-diff/task-diff-service'
import { TaskDiffServiceRegistryLive } from '../../src/effects/services/task-diff/task-diff-service-registry.layer'
import { TaskDiffServiceRegistry } from '../../src/effects/services/task-diff/task-diff-service-registry.service'
import { UnusedGitRequirements } from '../helpers/unused-repository-requirements'

const workspace = Schema.decodeUnknownSync(TaskDiffWorkspace)({
	organizationId: 'org-1',
	taskId: 'task-1',
	hostId: 'host-1',
	workspaceBaseDirectory: '/tmp/task-1',
	repos: [{ id: 'repo-1', absolutePath: '/tmp/task-1/repo-1', sourceRef: 'main' }],
})

describe('TaskDiffServiceRegistry', () => {
	it.effect('retains one service for repeated identical workspace registration', () => {
		let createCount = 0
		let requestCount = 0
		let drainCount = 0
		const factory = Layer.succeed(TaskDiffServiceFactory, {
			create: () =>
				Effect.sync(() => {
					createCount += 1
					return {
						requestCapture: () => Effect.sync(() => requestCount++),
						suspend: Effect.void,
						resume: Effect.void,
						drain: Effect.sync(() => drainCount++),
					}
				}),
		})
		const layer = TaskDiffServiceRegistryLive.pipe(Layer.provide(factory))

		return Effect.gen(function* () {
			const registry = yield* TaskDiffServiceRegistry
			yield* registry.registerWorkspace(workspace)
			yield* registry.registerWorkspace(workspace)
			yield* registry.requestCapture({ taskId: 'task-1', sessionId: 'session-1' })
			yield* registry.drain
			yield* registry.drain
			expect(createCount).toBe(1)
			expect(requestCount).toBe(1)
			expect(drainCount).toBe(1)
		}).pipe(Effect.provide(layer), Effect.provide(UnusedGitRequirements))
	})

	it.effect('serializes workspace replacement without duplicate accepting generations', () => {
		let active = 0
		let maximumActive = 0
		let createCount = 0
		let requestCount = 0
		const factory = Layer.succeed(TaskDiffServiceFactory, {
			create: () =>
				Effect.sync(() => {
					createCount += 1
					active += 1
					maximumActive = Math.max(maximumActive, active)
					let accepting = true
					return {
						requestCapture: () =>
							Effect.sync(() => {
								if (accepting) requestCount += 1
							}),
						suspend: Effect.void,
						resume: Effect.void,
						drain: Effect.sync(() => {
							if (!accepting) return
							accepting = false
							active -= 1
						}),
					}
				}),
		})
		const layer = TaskDiffServiceRegistryLive.pipe(Layer.provide(factory))
		const replacement = Schema.decodeUnknownSync(TaskDiffWorkspace)({
			...workspace,
			repos: [{ id: 'repo-1', absolutePath: '/tmp/task-1/repo-1-moved', sourceRef: 'origin/main' }],
		})

		return Effect.gen(function* () {
			const registry = yield* TaskDiffServiceRegistry
			yield* registry.registerWorkspace(workspace)
			yield* registry.registerWorkspace(replacement)
			yield* registry.requestCapture({ taskId: 'task-1', sessionId: 'session-1' })
			yield* registry.drain
			yield* registry.requestCapture({ taskId: 'task-1', sessionId: 'session-after-drain' })
			expect(createCount).toBe(2)
			expect(maximumActive).toBe(1)
			expect(active).toBe(0)
			expect(requestCount).toBe(1)
		}).pipe(Effect.provide(layer), Effect.provide(UnusedGitRequirements))
	})

	it.effect('suspends and resumes the same service generation', () => {
		let createCount = 0
		let suspendCount = 0
		let resumeCount = 0
		const factory = Layer.succeed(TaskDiffServiceFactory, {
			create: () =>
				Effect.sync(() => {
					createCount += 1
					return {
						requestCapture: () => Effect.void,
						suspend: Effect.sync(() => suspendCount++).pipe(Effect.asVoid),
						resume: Effect.sync(() => resumeCount++).pipe(Effect.asVoid),
						drain: Effect.void,
					}
				}),
		})
		const layer = TaskDiffServiceRegistryLive.pipe(Layer.provide(factory))

		return Effect.gen(function* () {
			const registry = yield* TaskDiffServiceRegistry
			yield* registry.registerWorkspace(workspace)
			yield* registry.suspendWorkspace('task-1')
			yield* registry.resumeWorkspace(workspace)

			expect(createCount).toBe(1)
			expect(suspendCount).toBe(1)
			expect(resumeCount).toBe(1)
		}).pipe(Effect.provide(layer), Effect.provide(UnusedGitRequirements))
	})

	it.effect('stops waiting for stuck service drain and scope finalizers', () =>
		Effect.gen(function* () {
			const drainStarted = yield* Deferred.make<void>()
			const closeStarted = yield* Deferred.make<void>()
			const releaseClose = yield* Deferred.make<void>()
			const factory = Layer.succeed(TaskDiffServiceFactory, {
				create: () =>
					Effect.gen(function* () {
						const scope = yield* Scope.Scope
						yield* Scope.addFinalizer(
							scope,
							Deferred.succeed(closeStarted, undefined).pipe(
								Effect.andThen(Deferred.await(releaseClose)),
							),
						)
						return {
							requestCapture: () => Effect.void,
							suspend: Effect.void,
							resume: Effect.void,
							drain: Deferred.succeed(drainStarted, undefined),
						}
					}),
			})
			const layer = TaskDiffServiceRegistryLive.pipe(Layer.provide(factory))
			const program = Effect.gen(function* () {
				const registry = yield* TaskDiffServiceRegistry
				yield* registry.registerWorkspace(workspace)
				const drain = yield* registry.drain.pipe(Effect.forkChild)
				yield* Deferred.await(drainStarted)
				yield* Deferred.await(closeStarted)
				yield* TestClock.adjust('2 seconds')
				yield* Fiber.join(drain)
				yield* Deferred.succeed(releaseClose, undefined)
			})

			yield* program.pipe(Effect.provide(layer), Effect.provide(UnusedGitRequirements))
		}),
	)
})
