import * as Data from 'effect/Data'

export class SelfUpdateInstallError extends Data.TaggedError('SelfUpdateInstallError')<{
	readonly message: string
	readonly version: string
	readonly stderr: string
	readonly cause?: unknown
}> {}

export class SelfUpdateRestartError extends Data.TaggedError('SelfUpdateRestartError')<{
	readonly message: string
	readonly command: string
	readonly cause: unknown
}> {}

export class SelfUpdateReportError extends Data.TaggedError('SelfUpdateReportError')<{
	readonly message: string
	readonly cause: unknown
}> {}

export class DaemonAlreadyShuttingDown extends Data.TaggedError('DaemonAlreadyShuttingDown')<{
	readonly message: string
}> {}
