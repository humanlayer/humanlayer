import { createHash } from 'node:crypto'

export function sha256Hex(input: string | Uint8Array): string {
	return createHash('sha256').update(input).digest('hex')
}

/** Truncate a string to at most maxBytes UTF-8 bytes without splitting a multi-byte char. */
export function cutUtf8(s: string, maxBytes: number): string {
	const buf = Buffer.from(s, 'utf8')
	if (buf.byteLength <= maxBytes) return s
	let end = maxBytes
	while (end > 0 && ((buf[end] ?? 0) & 0xc0) === 0x80) end--
	const removed = buf.byteLength - end
	return `${buf.subarray(0, end).toString('utf8')}…[truncated ${removed} bytes]`
}
