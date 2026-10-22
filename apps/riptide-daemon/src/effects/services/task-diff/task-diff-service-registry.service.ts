import { Context, type Effect } from 'effect'

import type { TaskDiffServiceRegistrationError } from './errors'
import type { GitCommandRunnerRequirements } from './git-command-runner.service'
import type { TaskDiffCaptureRequest, TaskDiffWorkspace } from './types'

export class TaskDiffServiceRegistry extends Context.Service<
	TaskDiffServiceRegistry,
	{
		readonly requestCapture: (
			request: TaskDiffCaptureRequest,
		) => Effect.Effect<void, never, GitCommandRunnerRequirements>
		readonly registerWorkspace: (
			workspace: TaskDiffWorkspace,
		) => Effect.Effect<void, TaskDiffServiceRegistrationError>
		readonly suspendWorkspace: (taskId: string) => Effect.Effect<void>
		readonly resumeWorkspace: (
			workspace: TaskDiffWorkspace,
		) => Effect.Effect<void, TaskDiffServiceRegistrationError, GitCommandRunnerRequirements>
		readonly drain: Effect.Effect<void>
	}
>()('TaskDiffServiceRegistry') {}
