import { type LogLevel, LogTransport, type SendProps } from '../logger'

/**
 * Maps log levels to the appropriate console method
 */
const levelToConsoleMethod = {
	silly: 'debug',
	debug: 'debug',
	http: 'debug',
	info: 'info',
	warn: 'warn',
	error: 'error',
	fatal: 'error',
} as const satisfies Record<LogLevel, keyof Pick<Console, 'debug' | 'info' | 'warn' | 'error'>>

/**
 * Browser-safe console transport that outputs structured logs to the browser console.
 * Uses appropriate console methods (debug, info, warn, error) based on log level.
 */
export class ConsoleTransport extends LogTransport {
	public readonly level: LogLevel
	private readonly stringifyData: boolean

	constructor(level: LogLevel = 'info', options?: { stringifyData?: boolean }) {
		super()
		this.level = level
		this.stringifyData = options?.stringifyData ?? false
	}

	public override send(props: SendProps): void {
		const method = levelToConsoleMethod[props.level]
		const timestamp = new Date(props.timestamp).toLocaleString()

		const levelStr = props.level.toUpperCase().padEnd(5)
		const loggerStr = props.logger ? `[${props.logger}]` : ''

		// Format: LEVEL [logger] timestamp message {data}
		const prefix = `${levelStr} ${loggerStr} ${timestamp}`

		if (props.data && Object.keys(props.data).length > 0) {
			const data = this.stringifyData ? JSON.stringify(props.data) : props.data
			console[method](prefix, props.msg ?? '', data)
		} else {
			console[method](prefix, props.msg ?? '')
		}
	}

	public override shutdown(): void {
		// No cleanup needed for console transport
	}
}
