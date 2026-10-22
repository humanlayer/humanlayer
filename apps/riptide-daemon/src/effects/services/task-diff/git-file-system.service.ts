import { Context, type Effect, type Scope } from 'effect'

import type { GitCommandRunnerError, GitUnavailableError, TaskDiffBaseUnavailableError } from './errors'
import type { GitCommandRunnerRequirements } from './git-command-runner.service'
import type { PendingCapture, TaskDiffBaseResolution, TaskDiffCaptureRequirements, TaskDiffRepoContext } from './types'

export class GitFileSystem extends Context.Service<
	GitFileSystem,
	{
		readonly resolveBase: (
			repo: TaskDiffRepoContext,
		) => Effect.Effect<
			TaskDiffBaseResolution,
			GitCommandRunnerError | TaskDiffBaseUnavailableError,
			GitCommandRunnerRequirements
		>
		readonly beginRebuild: (
			repo: TaskDiffRepoContext,
			base: TaskDiffBaseResolution,
			requirements: TaskDiffCaptureRequirements,
		) => Effect.Effect<PendingCapture, GitUnavailableError, Scope.Scope | GitCommandRunnerRequirements>
		readonly markPublished: (pending: PendingCapture) => Effect.Effect<void, GitUnavailableError>
	}
>()('GitFileSystem') {}
