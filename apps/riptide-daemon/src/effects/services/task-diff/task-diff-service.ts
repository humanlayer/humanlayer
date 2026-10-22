import { Context, type Effect, type Scope } from 'effect'

import type { TaskDiffServiceRegistrationError } from './errors'
import type { GitCommandRunnerRequirements } from './git-command-runner.service'
import type { TaskDiffCaptureRequest, TaskDiffWorkspace } from './types'

export interface TaskDiffService {
	readonly requestCapture: (
		request: TaskDiffCaptureRequest,
	) => Effect.Effect<void, never, GitCommandRunnerRequirements>
	readonly suspend: Effect.Effect<void>
	readonly resume: Effect.Effect<void, TaskDiffServiceRegistrationError, GitCommandRunnerRequirements>
	readonly drain: Effect.Effect<void>
}

/** Creates one daemon-lifetime task-diff service per registered workspace. */
export class TaskDiffServiceFactory extends Context.Service<
	TaskDiffServiceFactory,
	{
		readonly create: (
			workspace: TaskDiffWorkspace,
		) => Effect.Effect<TaskDiffService, TaskDiffServiceRegistrationError, Scope.Scope>
	}
>()('TaskDiffServiceFactory') {}
