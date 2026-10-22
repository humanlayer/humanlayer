import { Context, type Duration, type Effect } from 'effect'
import type { ChildProcessSpawner } from 'effect/process'

import type { GitCommandRunnerError } from './errors'
import type { GitOutput } from './types'

export class GitRunnerConfiguration extends Context.Service<
	GitRunnerConfiguration,
	{
		readonly timeout: Duration.Duration
		readonly maxOutputBytes: number
		readonly inheritedSshCommand: string | undefined
		readonly inheritedSshExecutable: string | undefined
		readonly inheritedSshVariant: string | undefined
	}
>()('GitRunnerConfiguration') {}

export type GitCommandRunnerRequirements = GitRunnerConfiguration | ChildProcessSpawner.ChildProcessSpawner

export interface GitCommandOptions {
	readonly cwd: string
	readonly env?: Readonly<Record<string, string>>
	readonly okExitCodes?: ReadonlyArray<number>
	readonly timeout?: Duration.Input
	readonly nonInteractive?: boolean
}

export class GitCommandRunner extends Context.Service<
	GitCommandRunner,
	{
		// Captures complete output or fails at RIPTIDE_GIT_MAX_OUTPUT_BYTES (64 MiB combined by default).
		readonly run: (
			argv: ReadonlyArray<string>,
			opts: GitCommandOptions,
		) => Effect.Effect<GitOutput, GitCommandRunnerError, GitCommandRunnerRequirements>
	}
>()('GitCommandRunner') {}
