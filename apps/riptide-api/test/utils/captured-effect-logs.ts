import { Logger } from 'effect'

export type CapturedEffectLog = { readonly level: string; readonly message: string }

const renderLogMessage = (message: unknown): string =>
	(Array.isArray(message) ? message : [message]).map((part) => String(part)).join(' ')

/**
 * Records every Effect log line written while the returned layer is provided, so a test can assert
 * what startup said (for example, which keys an integration is missing).
 */
export const makeCapturedEffectLogs = () => {
	const logs: CapturedEffectLog[] = []
	const layer = Logger.layer([
		Logger.make<unknown, void>((options) => {
			logs.push({ level: options.logLevel, message: renderLogMessage(options.message) })
		}),
	])
	return { logs, layer }
}
