/**
 * Postgres rejects U+0000 in both `text` columns ("invalid byte sequence for encoding
 * UTF8: 0x00") and `jsonb` columns ("unsupported Unicode escape sequence", SQLSTATE 22P05).
 *
 * Coding agents produce that character when they write or edit code that talks about
 * null bytes: the model types the text `backslash-u0000` inside a JSON tool argument, the harness
 * decodes the escape, and a real NUL lands in the tool input, the tool result, or the
 * artifact content (RIPTIDE-API-NE, RIPTIDE-API-JD, RIPTIDE-DAEMON-CB).
 *
 * Strip on VALUES, never on serialized JSON text. A text-level replace of the escape
 * sequence corrupts strings that legitimately hold the six characters `backslash-u0000` (source
 * code): `JSON.stringify` writes those as `\\u0000`, the replace eats the tail, and the
 * dangling backslash makes `JSON.parse` throw (RIPTIDE-API-ND).
 */

const NULL_BYTE = '\0'

export function stripNullBytesFromString(value: string): string {
	return value.includes(NULL_BYTE) ? value.replaceAll(NULL_BYTE, '') : value
}

/**
 * `JSON.stringify` replacer for callers that serialize once and hand the text straight to
 * Postgres (`::jsonb`), so they do not pay for a parse round trip on large payloads.
 */
export const nullByteReplacer = (_key: string, value: unknown): unknown =>
	typeof value === 'string' ? stripNullBytesFromString(value) : value

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (value === null || typeof value !== 'object') return false
	const prototype = Object.getPrototypeOf(value)
	return prototype === Object.prototype || prototype === null
}

/**
 * Deep-strips U+0000 from every string (values and keys) in a JSON-shaped value.
 * Returns the same reference when nothing changed, so untouched payloads cost one walk
 * and no allocation. Non-plain objects (Date, class instances) pass through untouched.
 */
export function stripNullBytes<T>(value: T): T {
	if (typeof value === 'string') return stripNullBytesFromString(value) as T

	if (Array.isArray(value)) {
		let changed = false
		const stripped = value.map((item: unknown) => {
			const next = stripNullBytes(item)
			if (next !== item) changed = true
			return next
		})
		return (changed ? stripped : value) as T
	}

	if (!isPlainObject(value)) return value

	let changed = false
	const stripped: Record<string, unknown> = {}
	for (const [key, item] of Object.entries(value)) {
		const nextKey = stripNullBytesFromString(key)
		const next = stripNullBytes(item)
		if (nextKey !== key || next !== item) changed = true
		stripped[nextKey] = next
	}
	return (changed ? stripped : value) as T
}
