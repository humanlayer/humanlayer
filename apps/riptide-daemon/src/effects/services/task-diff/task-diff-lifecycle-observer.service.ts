import { Context, type Effect } from 'effect'

import type { GitCommandRunnerRequirements } from './git-command-runner.service'
import type {
	TaskDiffLifecycleInitialState,
	TaskDiffTaskLifecycleState,
	TaskDiffWorkspaceLifecycleState,
} from './types'

export class TaskDiffLifecycleObserver extends Context.Service<
	TaskDiffLifecycleObserver,
	{
		readonly initialize: (state: TaskDiffLifecycleInitialState) => Effect.Effect<void>
		readonly observeTask: (
			state: TaskDiffTaskLifecycleState,
		) => Effect.Effect<void, never, GitCommandRunnerRequirements>
		readonly observeWorkspace: (state: TaskDiffWorkspaceLifecycleState) => Effect.Effect<void>
	}
>()('TaskDiffLifecycleObserver') {}
