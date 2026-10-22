// Codex writes each thread to a rollout file: one JSON record per line, only ever appended to.
// RolloutTail reads the lines added since its offset, and keeps a partial last line for the next
// read. Each record carries the byte offset it starts at, which stays the same however often the
// file is read again, so it can name events.
//
// Codex says the transcript format is not a stable interface. The mapper reads it defensively:
// a record it does not know goes up hidden, never as an error.

import { open, stat } from 'node:fs/promises'

export interface RolloutRecord {
	/** Byte offset of the line in the file. */
	offset: number
	/** Byte offset just past the line, where the next read starts. */
	end: number
	type: string
	timestamp?: string
	payload: Record<string, unknown>
}

/** Reads at most this much per read, so a large backlog does not block the event loop for long. */
const CHUNK = 4 * 1024 * 1024

export class RolloutTail {
	readonly path: string
	private offset: number
	private reading: Promise<RolloutRecord[]> | undefined

	constructor(path: string, offset: number) {
		this.path = path
		this.offset = offset
	}

	/** Where the next read starts: past the last whole line read. */
	get position(): number {
		return this.offset
	}

	/** Reads on from offset, skipping what lies between. */
	skipTo(offset: number): void {
		this.offset = Math.max(this.offset, offset)
	}

	/** The file's size now: a read from here sees only what Codex writes next. */
	static async size(path: string): Promise<number> {
		return (await stat(path).catch(() => undefined))?.size ?? 0
	}

	/** The whole lines added since the last read. Calls at once share one read. */
	read(): Promise<RolloutRecord[]> {
		this.reading ??= this.readOnce().finally(() => {
			this.reading = undefined
		})
		return this.reading
	}

	private async readOnce(): Promise<RolloutRecord[]> {
		const records: RolloutRecord[] = []
		const file = await open(this.path, 'r').catch(() => undefined)
		if (!file) return records
		try {
			for (;;) {
				const { size } = await file.stat()
				if (size <= this.offset) return records
				const length = Math.min(size - this.offset, CHUNK)
				const buf = Buffer.alloc(length)
				const { bytesRead } = await file.read(buf, 0, length, this.offset)
				const last = buf.subarray(0, bytesRead).lastIndexOf(0x0a)
				if (last < 0) {
					// A line longer than CHUNK, or one Codex is still writing.
					if (length < CHUNK) return records
					throw new Error(`rollout line over ${CHUNK} bytes at ${this.offset}`)
				}
				let start = 0
				while (start <= last) {
					const nl = buf.indexOf(0x0a, start)
					const line = buf.subarray(start, nl).toString('utf8')
					const record = parse(line, this.offset + start, this.offset + nl + 1)
					if (record) records.push(record)
					start = nl + 1
				}
				this.offset += last + 1
			}
		} finally {
			await file.close()
		}
	}
}

function parse(line: string, offset: number, end: number): RolloutRecord | undefined {
	if (!line.trim()) return undefined
	try {
		const raw = JSON.parse(line) as { type?: unknown; timestamp?: unknown; payload?: unknown }
		if (typeof raw.type !== 'string') return undefined
		const payload = raw.payload && typeof raw.payload === 'object' ? (raw.payload as Record<string, unknown>) : {}
		const record: RolloutRecord = { offset, end, type: raw.type, payload }
		if (typeof raw.timestamp === 'string') record.timestamp = raw.timestamp
		return record
	} catch {
		return undefined
	}
}
