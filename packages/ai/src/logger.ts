import { ConsoleTransport, Logger, type LogLevel, logLevels } from '@humanlayer/logger/browser'

// Default to info; override with LOG_LEVEL env var
const DEFAULT_LOG_LEVEL: LogLevel = 'info'

const LOG_LEVEL: LogLevel =
	process.env.LOG_LEVEL && Object.keys(logLevels).includes(process.env.LOG_LEVEL)
		? (process.env.LOG_LEVEL as LogLevel)
		: DEFAULT_LOG_LEVEL

export const logger = new Logger({
	name: 'ai',
	properties: {},
	transports: [new ConsoleTransport(LOG_LEVEL)],
})
