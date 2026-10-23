import {
	DaemonStartError as RpcDaemonStartError,
	DaemonStopError as RpcDaemonStopError,
	DaemonUnavailableError as RpcDaemonUnavailableError,
} from '@humanlayer/riptide-electron-rpc'
import * as Data from 'effect/Data'

export class DaemonUnavailableError extends RpcDaemonUnavailableError {}
export class DaemonStartError extends RpcDaemonStartError {}
export class DaemonStopError extends RpcDaemonStopError {}

export class DaemonGenerationError extends Data.TaggedError('DaemonGenerationError')<{
	readonly cause: unknown
	readonly message: string
}> {}

export class DaemonCandidateExitedBeforeLaunchResult extends Data.TaggedError(
	'DaemonCandidateExitedBeforeLaunchResult',
)<{
	readonly exitCode: number
	readonly generationId: string
}> {}

export class DaemonCandidateLaunchTimedOut extends Data.TaggedError('DaemonCandidateLaunchTimedOut')<{
	readonly generationId: string
	readonly timeoutSeconds: number
}> {}
