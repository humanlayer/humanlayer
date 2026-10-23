import type { Pool } from 'undici'

export type UndiciPoolOptions = NonNullable<ConstructorParameters<typeof Pool>[1]>

export const proxyPoolOptions = {
	// Undici uses "H2" to refer to HTTP/2.
	allowH2: true,
	connections: 5_000,
	pipelining: 1,
	headersTimeout: 300_000,
	bodyTimeout: 0,
	keepAliveTimeout: 30_000,
	connect: { timeout: 10_000 },
} satisfies UndiciPoolOptions

export const jwksPoolOptions = {
	// Undici uses "H2" to refer to HTTP/2.
	allowH2: true,
	connections: 10,
	pipelining: 1,
	headersTimeout: 10_000,
	bodyTimeout: 10_000,
	connect: { timeout: 10_000 },
} satisfies UndiciPoolOptions
