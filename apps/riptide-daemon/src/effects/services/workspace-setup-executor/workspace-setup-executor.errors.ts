import type { WorkspaceSetupStage } from '@humanlayer/schemas/effect/workspace'
import { Data } from 'effect'

export type WorkspaceSetupExecutorErrorFields = {
	readonly taskId: string
	readonly hostId: string
	readonly localPath: string
	readonly stage: WorkspaceSetupStage
	readonly message: string
	readonly command?: string
	readonly workingDirectory?: string
	readonly exitCode?: number
	readonly stderr?: string
	readonly stdoutLogPath?: string
	readonly stderrLogPath?: string
	readonly cause?: unknown
}

export class WorkspacePreflightError extends Data.TaggedError(
	'WorkspacePreflightError',
)<WorkspaceSetupExecutorErrorFields> {}

export class WorkspaceWorktreeError extends Data.TaggedError(
	'WorkspaceWorktreeError',
)<WorkspaceSetupExecutorErrorFields> {}

export class WorkspaceCopyError extends Data.TaggedError('WorkspaceCopyError')<WorkspaceSetupExecutorErrorFields> {}

export class WorkspaceSetupCommandError extends Data.TaggedError(
	'WorkspaceSetupCommandError',
)<WorkspaceSetupExecutorErrorFields> {}

export class WorkspaceProcessError extends Data.TaggedError(
	'WorkspaceProcessError',
)<WorkspaceSetupExecutorErrorFields> {}

export type WorkspaceSetupExecutorError =
	| WorkspacePreflightError
	| WorkspaceWorktreeError
	| WorkspaceCopyError
	| WorkspaceSetupCommandError
	| WorkspaceProcessError

export type WorkspaceSetupProcessError = WorkspaceProcessError
