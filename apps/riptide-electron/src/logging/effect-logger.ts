import { SentryEffectLogger } from '@sentry/effect/server'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Logger from 'effect/Logger'
import * as Path from 'effect/Path'

import type { ElectronConfig } from '../config/electron-config'

const jsonConsoleLogger = Logger.withConsoleLog(Logger.formatJson)

export const makeEffectLoggerLive = (config: ElectronConfig) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const fileSystem = yield* FileSystem.FileSystem
			const pathService = yield* Path.Path
			yield* fileSystem.makeDirectory(pathService.dirname(config.logPath), { recursive: true })
			const fileLogger = Logger.formatJson.pipe(Logger.toFile(config.logPath, { flag: 'a' }))
			const loggers = config.isPackaged
				? [fileLogger, SentryEffectLogger]
				: [jsonConsoleLogger, fileLogger, SentryEffectLogger]

			return Logger.layer(loggers)
		}),
	)
