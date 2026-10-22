import { describe, it } from '@effect/vitest'
import { Deferred, Effect, Fiber } from 'effect'
import { expect } from 'vitest'

import { TaskDiffLockRegistryLive } from '../../src/effects/services/task-diff/task-diff-lock-registry.layer'
import { TaskDiffLockRegistry } from '../../src/effects/services/task-diff/task-diff-lock-registry.service'
import { makeTaskRepoLockKey } from '../../src/effects/services/task-diff/types'

describe('TaskDiffLockRegistry', () => {
	it.effect('serializes equal keys and allows different keys in parallel', () =>
		Effect.gen(function* () {
			const registry = yield* TaskDiffLockRegistry
			const firstEntered = yield* Deferred.make<void>()
			const releaseFirst = yield* Deferred.make<void>()
			const order: string[] = []
			const key = makeTaskRepoLockKey('task-1', 'repo-1')

			const first = registry.withTaskRepoLock(key)(
				Effect.sync(() => order.push('first-start')).pipe(
					Effect.andThen(Deferred.succeed(firstEntered, undefined)),
					Effect.andThen(Deferred.await(releaseFirst)),
					Effect.andThen(Effect.sync(() => order.push('first-end'))),
				),
			)
			const second = registry.withTaskRepoLock(makeTaskRepoLockKey('task-1', 'repo-1'))(
				Effect.sync(() => order.push('second')),
			)
			const other = registry.withTaskRepoLock(makeTaskRepoLockKey('task-1', 'repo-2'))(
				Effect.sync(() => order.push('other')),
			)

			const firstFiber = yield* Effect.forkChild(first)
			yield* Deferred.await(firstEntered)
			const secondFiber = yield* Effect.forkChild(second)
			yield* other
			expect(order).toEqual(['first-start', 'other'])
			yield* Deferred.succeed(releaseFirst, undefined)
			yield* Fiber.join(firstFiber)
			yield* Fiber.join(secondFiber)
			expect(order).toEqual(['first-start', 'other', 'first-end', 'second'])
		}).pipe(Effect.scoped, Effect.provide(TaskDiffLockRegistryLive)),
	)

	it.effect('releases a held lock when the owning fiber is interrupted', () =>
		Effect.gen(function* () {
			const registry = yield* TaskDiffLockRegistry
			const entered = yield* Deferred.make<void>()
			const key = makeTaskRepoLockKey('task-1', 'repo-1')
			const owner = yield* Effect.forkChild(
				registry.withTaskRepoLock(key)(Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never))),
			)
			yield* Deferred.await(entered)
			yield* Fiber.interrupt(owner)
			const acquired = yield* registry.withTaskRepoLock(makeTaskRepoLockKey('task-1', 'repo-1'))(
				Effect.succeed(true),
			)
			expect(acquired).toBe(true)
		}).pipe(Effect.scoped, Effect.provide(TaskDiffLockRegistryLive)),
	)
})
