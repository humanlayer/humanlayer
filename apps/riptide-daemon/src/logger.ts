import * as NodeLogger from '@humanlayer/logger/node'
import z from 'zod/v4'

import { reportEmergencyError } from '@/lib/emergency-error-reporter'
import { daemonErrorLogFilePath, daemonLogFilePath } from '@/lib/log-paths'

const LogLevelSchema: z.ZodType<NodeLogger.LogLevel> = z.enum([
	'silly',
	'debug',
	'http',
	'info',
	'warn',
	'error',
	'fatal',
])
const configuredLogLevel = LogLevelSchema.safeParse(process.env.LOG_LEVEL)
const LOG_LEVEL = configuredLogLevel.success ? configuredLogLevel.data : undefined

const logTransports: [NodeLogger.LogTransport, ...Array<NodeLogger.LogTransport>] = [
	// Log Transport
	new NodeLogger.FileTransport(LOG_LEVEL ?? 'info', daemonLogFilePath),
	// Error Transport
	new NodeLogger.FileTransport('warn', daemonErrorLogFilePath),
]
if (LOG_LEVEL) logTransports.push(new NodeLogger.StandardStreamTransport(LOG_LEVEL, 'STDOUT'))

export const logger = new NodeLogger.Logger({
	properties: {},
	transports: logTransports,
	onTransportError: (error) => reportEmergencyError(error, 'logger_transport_error'),
})

export default logger
export { Logger } from '@humanlayer/logger/node'
