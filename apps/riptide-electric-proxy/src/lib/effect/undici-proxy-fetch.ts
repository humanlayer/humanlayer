import { Readable } from 'node:stream'

import { type Pool, request as undiciRequest } from 'undici'

import { isNullBodyStatus } from './proxy-headers'

type UndiciRequest = typeof undiciRequest

type WebHeadersInit = ConstructorParameters<typeof Headers>[0]
type WebFetchInput = Parameters<typeof globalThis.fetch>[0]
type WebBodyInit = NonNullable<RequestInit['body']>

function headersToRecord(headers: WebHeadersInit | undefined): Record<string, string> | undefined {
	if (!headers) return undefined
	const normalized = new Headers(headers)
	const record: Record<string, string> = {}
	for (const [key, value] of normalized) record[key] = value
	return record
}

function undiciHeadersToWebHeaders(headers: Record<string, string | string[] | undefined>) {
	const webHeaders = new Headers()
	for (const [key, value] of Object.entries(headers)) {
		if (Array.isArray(value)) {
			for (const entry of value) webHeaders.append(key, entry)
		} else if (value !== undefined) {
			webHeaders.append(key, value)
		}
	}
	return webHeaders
}

async function bodyToUndiciBody(body: WebBodyInit | null | undefined) {
	if (!body) return undefined
	if (body instanceof ReadableStream) {
		// Bun's undici compatibility layer cannot consume a Node Readable created from
		// a Web ReadableStream, so materialize the bounded proxy request batch first.
		return new Uint8Array(await new Response(body).arrayBuffer())
	}
	return body
}

async function getRequestInput(input: WebFetchInput | URL, init?: RequestInit) {
	if (input instanceof Request) {
		return {
			url: input.url,
			method: init?.method ?? input.method,
			headers: init?.headers ?? input.headers,
			body: await bodyToUndiciBody(init?.body ?? input.body),
			signal: init?.signal ?? input.signal,
		}
	}

	return {
		url: input.toString(),
		method: init?.method,
		headers: init?.headers,
		body: await bodyToUndiciBody(init?.body),
		signal: init?.signal,
	}
}

/** Invoked when an upstream response body errors mid-stream (peer closed the socket after headers). */
export type UpstreamStreamErrorHandler = (error: unknown) => void

export function createRequestProxyWithSocketPool(
	pool: Pool,
	onStreamError: UpstreamStreamErrorHandler,
	requestWithPool?: UndiciRequest,
): typeof globalThis.fetch {
	const proxyFetch = async (input: WebFetchInput | URL, init?: RequestInit) => {
		const requestInput = await getRequestInput(input, init)
		const requestImpl = requestWithPool ?? undiciRequest
		const response = await requestImpl(requestInput.url, {
			method: requestInput.method,
			headers: headersToRecord(requestInput.headers),
			body: requestInput.body as never,
			signal: requestInput.signal,
			dispatcher: pool,
		})

		if (isNullBodyStatus(response.statusCode)) {
			// 204/205/304 must not carry a body, or the Response constructor throws on Node.
			// Drain undici's (always non-null) stream so the pooled socket is released; the
			// error listener keeps a mid-drain socket reset from surfacing as an unhandled error.
			response.body.on('error', onStreamError).resume()
			return new Response(null, {
				status: response.statusCode,
				headers: undiciHeadersToWebHeaders(response.headers),
			})
		}

		// Upstream body is a socket-backed Node Readable; if the peer closes mid-stream undici emits
		// 'error' (UND_ERR_SOCKET "other side closed"). With no listener Node re-throws it as an
		// uncaughtException and the process exits, dropping every concurrent stream on this task.
		response.body.on('error', onStreamError)

		return new Response(Readable.toWeb(response.body) as ReadableStream<Uint8Array>, {
			status: response.statusCode,
			headers: undiciHeadersToWebHeaders(response.headers),
		})
	}

	return Object.assign(proxyFetch, { preconnect: () => {} }) as typeof globalThis.fetch
}
