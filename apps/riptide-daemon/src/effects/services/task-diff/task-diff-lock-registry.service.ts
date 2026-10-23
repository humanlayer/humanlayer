import { Context, type Effect } from 'effect'

import type { TaskRepoLockKey } from './types'

export class TaskDiffLockRegistry extends Context.Service<
	TaskDiffLockRegistry,
	{
		readonly withTaskRepoLock: (
			key: TaskRepoLockKey,
		) => <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
	}
>()('TaskDiffLockRegistry') {}
