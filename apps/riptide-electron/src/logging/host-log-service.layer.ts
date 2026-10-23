import type { HostLogLevel } from '@humanlayer/riptide-electron-rpc'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Path from 'effect/Path'

import type { ElectronConfig } from '../config/electron-config'
import { Sentry } from '../instrument'
import { HostLogFileSystemError, HostLogService } from './host-log-service'

function logRendererMessage(input: { readonly level: HostLogLevel; readonly message: string }) {
	switch (input.level) {
		case 'fatal':
			return Effect.logFatal(input.message)
		case 'error':
			return Effect.logError(input.message)
		case 'warn':
			return Effect.logWarning(input.message)
		case 'info':
			return Effect.logInfo(input.message)
		case 'debug':
			return Effect.logDebug(input.message)
		case 'trace':
			return Effect.logTrace(input.message)
	}
}

export const makeHostLogServiceLive = (config: ElectronConfig) =>
	Layer.effect(
		HostLogService,
		Effect.gen(function* () {
			const fileSystem = yield* FileSystem.FileSystem
			const pathService = yield* Path.Path
			const logDirectory = pathService.dirname(config.logPath)

			const writeHostLog = Effect.fn('host_log.write')(function* (input: {
				readonly level: HostLogLevel
				readonly message: string
			}) {
				yield* logRendererMessage(input).pipe(Effect.annotateLogs({ type: 'frontend' }))
			})

			const getLogDirectory = Effect.succeed(logDirectory).pipe(Effect.withSpan('host_log.get_directory'))

			const getCurrentLogFiles = fileSystem.readDirectory(logDirectory).pipe(
				Effect.catchTag('PlatformError', (error) =>
					Match.value(error.reason).pipe(
						Match.when({ _tag: 'NotFound' }, () => Effect.succeed([])),
						Match.orElse(() => Effect.fail(error)),
					),
				),
				Effect.map((entries) =>
					entries
						.filter((entry) => entry.endsWith('.log') || entry.endsWith('.jsonl'))
						.sort()
						.reverse(),
				),
				Effect.tapError((e) => Effect.logError(e)),
				Effect.tapError((e) => Effect.sync(() => Sentry.captureException(e))),
				Effect.mapError((error) => new HostLogFileSystemError({ cause: error, message: error.message })),
				Effect.withSpan('host_log.get_current_files'),
			)

			return HostLogService.of({ writeHostLog, getLogDirectory, getCurrentLogFiles })
		}),
	)
