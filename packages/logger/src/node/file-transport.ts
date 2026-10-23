import { existsSync, mkdirSync } from 'node:fs'
import * as fs from 'node:fs/promises'
import { dirname } from 'node:path'

import { formatSendProps, type LogLevel, LogTransport, type SendProps } from '../logger'
import { normalizePath } from './utils'

/**
 * Logs to a file using bun's Bun.FileSink API.
 * **IMPORTANT** this will overwrite the file, so make sure your filepath is timestamped from boot time.
 *
 * Use buffersize = 0 to disable buffering
 */
export class FileTransport extends LogTransport {
	public readonly level: LogLevel
	protected filePath: string

	private maxBufferSize: number
	private appendBuffer: Array<string>
	private currentBufferLength = 0

	constructor(level: LogLevel, filePath: string, bufferSize: number = 0) {
		super()
		this.level = level
		this.filePath = normalizePath(filePath)
		const logFileDirName = dirname(this.filePath)

		// Create the directory if it does not exist
		if (!existsSync(logFileDirName)) {
			mkdirSync(logFileDirName, { recursive: true })
		}
		this.maxBufferSize = bufferSize

		// Declare it as the size so that it isn't constantly resized
		this.appendBuffer = new Array(this.maxBufferSize)
	}

	public override async send(props: SendProps): Promise<void> {
		if (this.maxBufferSize === 0) {
			await fs.appendFile(this.filePath, formatSendProps(props))
			return
		} else if (this.currentBufferLength < this.maxBufferSize) {
			const index = this.currentBufferLength
			this.currentBufferLength += 1
			this.appendBuffer[index] = formatSendProps(props)
			return
		} else if (this.currentBufferLength >= this.maxBufferSize) {
			const lines: string = this.appendBuffer.join('').concat(formatSendProps(props))

			this.currentBufferLength = 0
			this.appendBuffer = new Array(this.maxBufferSize)
			await fs.appendFile(this.filePath, lines)
		}
	}

	public override async shutdown(): Promise<void> {
		if (this.currentBufferLength > 0) {
			await fs.appendFile(this.filePath, this.appendBuffer.slice(0, this.currentBufferLength).join(''))
			this.currentBufferLength = 0
		}
	}
}
