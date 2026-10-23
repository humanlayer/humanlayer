import type { JsonValue, LogLevel } from './types'

export interface SendProps {
	msg?: string
	data?: JsonValue
	logger?: string
	level: LogLevel
	timestamp: number
}
export abstract class LogTransport {
	public abstract send(props: SendProps): void | Promise<void>
	public abstract shutdown(): void | Promise<void>
	public abstract readonly level: LogLevel
}

/**
 * Format the props from the send function into a log line (with newline)
 */
export function formatSendProps(props: SendProps): string {
	const data = props.data && Object.keys(props.data).length > 0 ? props.data : undefined
	const logLine: {
		level: LogLevel
		time: number
		logger?: string
		data?: JsonValue
		msg?: string
	} = {
		level: props.level,
		time: props.timestamp,
		logger: props.logger,
		msg: props.msg,
	}
	if (data) logLine.data = data
	return `${JSON.stringify(logLine)}\n`
}
