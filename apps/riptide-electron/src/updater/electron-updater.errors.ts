import {
	UpdateCheckError as RpcUpdateCheckError,
	UpdateDownloadError as RpcUpdateDownloadError,
	UpdateNotAvailableError as RpcUpdateNotAvailableError,
	UpdateNotReadyError as RpcUpdateNotReadyError,
} from '@humanlayer/riptide-electron-rpc'
import * as Data from 'effect/Data'

// Public errors -- re-exported from RPC contract. These cross the RPC boundary.
export class UpdateCheckError extends RpcUpdateCheckError {}
export class UpdateNotAvailableError extends RpcUpdateNotAvailableError {}
export class UpdateDownloadError extends RpcUpdateDownloadError {}
export class UpdateNotReadyError extends RpcUpdateNotReadyError {}

// Internal error -- never serialized across the RPC boundary.
export class AutoUpdaterConfigurationError extends Data.TaggedError('AutoUpdaterConfigurationError')<{
	readonly cause: unknown
	readonly message: string
}> {}
