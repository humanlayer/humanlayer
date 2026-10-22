import { Data } from 'effect'

export class GitBinaryMissingError extends Data.TaggedError('GitBinaryMissingError')<{
	readonly message: string
	readonly cause?: unknown
}> {}

export class GitCommandFailedError extends Data.TaggedError('GitCommandFailedError')<{
	readonly message: string
	readonly argv: ReadonlyArray<string>
	readonly exitCode: number
	readonly stderr: string
	readonly cause?: unknown
}> {}

export class GitTimeoutError extends Data.TaggedError('GitTimeoutError')<{
	readonly message: string
	readonly argv: ReadonlyArray<string>
	readonly cause?: unknown
}> {}

export class ShadowIndexWriteError extends Data.TaggedError('ShadowIndexWriteError')<{
	readonly message: string
	readonly cause?: unknown
}> {}

export class GitCommandIoError extends Data.TaggedError('GitCommandIoError')<{
	readonly message: string
}> {}

export class GitOutputLimitExceededError extends Data.TaggedError('GitOutputLimitExceededError')<{
	readonly message: string
	readonly maxOutputBytes: number
}> {}

export type GitCommandRunnerError =
	| GitBinaryMissingError
	| GitCommandFailedError
	| GitTimeoutError
	| GitCommandIoError
	| GitOutputLimitExceededError
export type GitUnavailableError = GitCommandRunnerError | ShadowIndexWriteError

export interface TaskDiffBaseResolutionFailure {
	readonly strategy: string
	readonly input: string
	readonly detail: string
}

export class TaskDiffBaseUnavailableError extends Data.TaggedError('TaskDiffBaseUnavailableError')<{
	readonly message: string
	readonly taskId: string
	readonly repoId: string
	readonly repoPath: string
	readonly sourceCommit?: string
	readonly sourceRef: string
	readonly configuredRemotes: ReadonlyArray<string>
	readonly attemptedRefs: ReadonlyArray<string>
	readonly failures: ReadonlyArray<TaskDiffBaseResolutionFailure>
}> {}

export class StreamAppendError extends Data.TaggedError('StreamAppendError')<{
	readonly message: string
	readonly stream: 'versions' | 'files'
	readonly cause?: unknown
}> {}

export class StreamFlushError extends Data.TaggedError('StreamFlushError')<{
	readonly message: string
	readonly stream: 'versions' | 'files'
	readonly cause?: unknown
}> {}

export class StreamInitializationError extends Data.TaggedError('StreamInitializationError')<{
	readonly message: string
	readonly cause?: unknown
}> {}

export class StreamRecoveryRequiredError extends Data.TaggedError('StreamRecoveryRequiredError')<{
	readonly message: string
}> {}

export type DurableStreamsDiffProducerError =
	| StreamAppendError
	| StreamFlushError
	| StreamInitializationError
	| StreamRecoveryRequiredError

export type TaskDiffCaptureInternalError = GitUnavailableError | DurableStreamsDiffProducerError

export class TaskDiffWorkspaceUnavailableError extends Data.TaggedError('TaskDiffWorkspaceUnavailableError')<{
	readonly message: string
	readonly taskId: string
	readonly cause?: unknown
}> {}

export class TaskDiffUnavailableError extends Data.TaggedError('TaskDiffUnavailableError')<{
	readonly message: string
	readonly taskId: string
	readonly cause?: unknown
}> {}

export class TaskDiffServiceRegistrationError extends Data.TaggedError('TaskDiffServiceRegistrationError')<{
	readonly message: string
	readonly taskId: string
	readonly cause?: unknown
}> {}

export type TaskDiffRegistrationError = TaskDiffServiceRegistrationError
