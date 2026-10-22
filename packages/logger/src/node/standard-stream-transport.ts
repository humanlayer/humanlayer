import { stderr, stdout } from 'node:process'

import { formatSendProps, type LogLevel, LogTransport, type SendProps } from '../logger'

/**
 * Logs to stdin, stdout, or stderr using the optimized bun file APIs
 */
export class StandardStreamTransport extends LogTransport {
	public readonly level: LogLevel
	private stream: NodeJS.WriteStream
	private maxBufferSize: number
	private currentBufferSize: number = 0
	private logBuffer: Array<string>
	constructor(level: LogLevel, stream: 'STDOUT' | 'STDERR', bufferSize: number = 0) {
		super()
		this.level = level

		this.logBuffer = []
		this.maxBufferSize = bufferSize
		if (stream === 'STDERR') this.stream = stderr
		else this.stream = stdout
	}

	public override send(props: SendProps): void | Promise<void> {
		if (this.maxBufferSize === 0) {
			this.stream.write(formatSendProps(props))
		} else if (this.currentBufferSize < this.maxBufferSize) {
			const index = this.currentBufferSize
			this.currentBufferSize += 1
			this.logBuffer[index] = formatSendProps(props)
			return
		} else if (this.currentBufferSize >= this.maxBufferSize) {
			const lines: string = this.logBuffer.join('').concat(formatSendProps(props))

			this.currentBufferSize = 0
			this.logBuffer = new Array(this.maxBufferSize)
			this.stream.write(lines)
		}
	}

	public override async shutdown(): Promise<void> {
		if (this.currentBufferSize > 0) {
			this.stream.write(this.logBuffer.slice(0, this.currentBufferSize).join(''))
			this.currentBufferSize = 0
		}
	}
}
