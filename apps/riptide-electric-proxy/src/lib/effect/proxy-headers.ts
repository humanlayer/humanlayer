/*
 * WHATWG "null body statuses". The Response constructor throws
 * `TypeError: Invalid response status code N` if one of these is paired with a
 * non-null body. A proxy must drop the body for these statuses.
 */
export const nullBodyStatuses = new Set([204, 205, 304])

export function isNullBodyStatus(status: number): boolean {
	return nullBodyStatuses.has(status)
}

/* Headers that must not be forwarded when proxying requests. */
export const hopByHopHeaders = new Set([
	'connection',
	'keep-alive',
	'proxy-authenticate',
	'proxy-authorization',
	'te',
	'trailer',
	'transfer-encoding',
	'upgrade',
])

export function copyProxyHeaders(headers: WebHeadersInit) {
	const copied = new Headers(headers)
	for (const header of hopByHopHeaders) copied.delete(header)
	// Accept-Encoding: shape responses are gzipped per-request by the compress
	// middleware, and v1 GETs are publicly cacheable — caches must key on encoding.
	copied.set('Vary', 'Authorization, Cookie, Accept-Encoding')
	return copied
}

export function copyProxyRequestHeaders(headers: WebHeadersInit) {
	const copied = new Headers(headers)
	for (const header of hopByHopHeaders) copied.delete(header)
	copied.delete('host')
	copied.delete('authorization')
	copied.delete('content-length')
	return copied
}
type WebHeadersInit = ConstructorParameters<typeof Headers>[0]
