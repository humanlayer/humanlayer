import { ConsoleTransport, Logger, type LogLevel, logLevels } from '@humanlayer/logger/browser'

// Default to info; override with LOG_LEVEL env var (set to 'debug' in dev cloud)
const DEFAULT_LOG_LEVEL: LogLevel = 'info'

// Use LOG_LEVEL env var if valid, otherwise use default
const LOG_LEVEL: LogLevel =
	process.env.LOG_LEVEL && Object.keys(logLevels).includes(process.env.LOG_LEVEL)
		? (process.env.LOG_LEVEL as LogLevel)
		: DEFAULT_LOG_LEVEL

export const logger = new Logger({
	name: 'riptide-api',
	properties: {},
	transports: [new ConsoleTransport(LOG_LEVEL, { stringifyData: true })],
})

export default logger
export { Logger, type LogLevel }
