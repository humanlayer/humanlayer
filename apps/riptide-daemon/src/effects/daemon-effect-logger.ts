import { dirname } from 'node:path'

import * as SentryEffect from '@sentry/effect/server'
import { Config, Effect, FileSystem, Layer, Logger } from 'effect'

import { daemonEffectLogFilePath } from '@/lib/log-paths'

/**
 * Native Effect JSONL logging. Logger.toFile owns its file handle and flushes
 * pending entries when the managed runtime releases the layer scope.
 */
const daemonEffectFileLogger = Effect.gen(function* () {
	const fileSystem = yield* FileSystem.FileSystem
	yield* fileSystem.makeDirectory(dirname(daemonEffectLogFilePath), { recursive: true })
	return yield* Logger.formatJson.pipe(Logger.toFile(daemonEffectLogFilePath, { flag: 'a' }))
})

export const DaemonEffectLoggerLive = Layer.unwrap(
	Effect.gen(function* () {
		const devMode = yield* Config.Boolean('RIPTIDE_DAEMON_DEV_MODE')
		const loggers = [daemonEffectFileLogger, SentryEffect.SentryEffectLogger, Logger.tracerLogger]
		if (devMode) loggers.push(Logger.defaultLogger)
		return Logger.layer(loggers)
	}),
)
