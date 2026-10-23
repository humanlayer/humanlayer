import type { HostLogLevel } from '@humanlayer/riptide-electron-rpc'
import * as Context from 'effect/Context'
import * as Data from 'effect/Data'
import type * as Effect from 'effect/Effect'

export class HostLogFileSystemError extends Data.TaggedError('HostLogFileSystemError')<{
	readonly cause: unknown
	readonly message: string
}> {}

export interface HostLogServiceShape {
	readonly writeHostLog: (input: { readonly level: HostLogLevel; readonly message: string }) => Effect.Effect<void>
	readonly getLogDirectory: Effect.Effect<string>
	readonly getCurrentLogFiles: Effect.Effect<ReadonlyArray<string>, HostLogFileSystemError>
}

export class HostLogService extends Context.Service<HostLogService, HostLogServiceShape>()('HostLogService') {}
