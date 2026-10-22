import { Data } from 'effect'

export class WorkspaceRepositoryLocalOperationError extends Data.TaggedError('WorkspaceRepositoryLocalOperationError')<{
	readonly message: string
	readonly command?: string
	readonly exitCode?: number
	readonly stderr?: string
	readonly stdoutLogPath?: string
	readonly stderrLogPath?: string
}> {}
