import { Effect, Layer, MutableHashMap, Option, Semaphore } from 'effect'

import { TaskDiffLockRegistry } from './task-diff-lock-registry.service'
import type { TaskRepoLockKey } from './types'

export const TaskDiffLockRegistryLive = Layer.sync(TaskDiffLockRegistry, () => {
	const locks = MutableHashMap.empty<TaskRepoLockKey, Semaphore.Semaphore>()
	const getLock = (key: TaskRepoLockKey): Semaphore.Semaphore => {
		const existing = MutableHashMap.get(locks, key)
		if (Option.isSome(existing)) return existing.value
		const created = Semaphore.makeUnsafe(1)
		MutableHashMap.set(locks, key, created)
		return created
	}

	return TaskDiffLockRegistry.of({
		withTaskRepoLock: (key) => (effect) =>
			getLock(key)
				.withPermits(1)(effect)
				.pipe(Effect.withSpan('task_diff.lock.with_task_repo_lock', { attributes: { lock_key: key } })),
	})
})
