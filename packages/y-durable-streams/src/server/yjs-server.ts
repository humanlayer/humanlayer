// Adapted from upstream YjsServer 0.2.8. No listener, snapshot or raw fallback ownership.
import { Effect, Layer, Stream } from 'effect'
import { HttpClient, HttpClientRequest } from 'effect/http'

import {
	parseYjsQuery,
	YJS_CONTENT_TYPE,
	YJS_STREAM_TTL_SECONDS,
	YjsGateway,
	YjsGatewayError,
	YjsStorageConfig,
	YjsStreamPaths,
} from './types'

const waitForAbort = (signal: AbortSignal) =>
	Effect.callback<void>((resume) => {
		const onAbort = () => resume(Effect.void)
		if (signal.aborted) {
			onAbort()
			return
		}
		signal.addEventListener('abort', onAbort, { once: true })
		return Effect.sync(() => signal.removeEventListener('abort', onAbort))
	})

const producerHeaders = [
	'producer-id',
	'producer-epoch',
	'producer-seq',
	'stream-producer-id',
	'stream-producer-epoch',
	'stream-producer-seq',
]

export const YjsGatewayLive = Layer.effect(
	YjsGateway,
	Effect.gen(function* () {
		const client = yield* HttpClient.HttpClient
		const config = yield* YjsStorageConfig
		const shutdown = yield* Effect.abortSignal
		const baseUrl = config.baseUrl.replace(/\/+$/, '')

		return YjsGateway.of({
			handle: Effect.fn('yjs.handle')(function* (incoming: Request, signal: AbortSignal) {
				const url = new URL(incoming.url)
				const match = /^\/v1\/yjs\/([a-zA-Z0-9_-]+)\/docs\/([a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*)$/.exec(
					url.pathname,
				)
				const query = parseYjsQuery(url)
				const service = match?.[1]
				const docPath = match?.[2]
				if (!service || !docPath || !query) return new Response(null, { status: 400 })
				const method = incoming.method
				if (method !== 'GET' && method !== 'HEAD' && method !== 'PUT' && method !== 'POST')
					return new Response(null, { status: 405 })
				if (
					(method === 'PUT' || method === 'POST') &&
					[...url.searchParams.keys()].some((key) => key !== 'awareness')
				)
					return new Response(null, { status: 400 })

				const aborted = waitForAbort(signal).pipe(Effect.raceFirst(waitForAbort(shutdown)))
				const run = Effect.gen(function* () {
					const path = query.awareness
						? YjsStreamPaths.awarenessStream(service, docPath)
						: YjsStreamPaths.dsStream(service, docPath)
					const target = new URL(`${baseUrl}${path}`)
					for (const key of ['offset', 'live', 'cursor']) {
						const value = url.searchParams.get(key)
						if (value !== null)
							target.searchParams.set(key, value === 'true' && key === 'live' ? 'long-poll' : value)
					}
					const headers: Record<string, string> = { 'content-type': YJS_CONTENT_TYPE }
					for (const key of producerHeaders) {
						const value = incoming.headers.get(key)
						if (value !== null && method === 'POST') headers[key] = value
					}
					if (method === 'PUT') headers['stream-ttl'] = String(YJS_STREAM_TTL_SECONDS)
					const body =
						method === 'PUT' || method === 'POST'
							? yield* Effect.tryPromise({
									try: () => incoming.arrayBuffer().then((b) => new Uint8Array(b)),
									catch: (cause) => new YjsGatewayError({ cause }),
								})
							: undefined
					const request = HttpClientRequest.make(method)(target.href, { headers })
					let response = yield* client.execute(
						body === undefined
							? request
							: HttpClientRequest.bodyUint8Array(request, body, YJS_CONTENT_TYPE),
					)
					// Only awareness auto-creates. Never create document content on a presence request.
					if (query.awareness && method === 'POST' && response.status === 404) {
						yield* Stream.runDrain(response.stream)
						const created = yield* client.put(`${baseUrl}${path}`, {
							headers: { 'content-type': YJS_CONTENT_TYPE, 'stream-ttl': String(YJS_STREAM_TTL_SECONDS) },
						})
						if (created.status !== 200 && created.status !== 201) response = created
						else {
							yield* Stream.runDrain(created.stream)
							response = yield* client.execute(
								HttpClientRequest.bodyUint8Array(request, body ?? new Uint8Array(), YJS_CONTENT_TYPE),
							)
						}
					}
					const responseHeaders = new Headers(response.headers)
					for (const key of [
						'connection',
						'transfer-encoding',
						'content-length',
						'content-encoding',
						'set-cookie',
						'keep-alive',
					])
						responseHeaders.delete(key)
					responseHeaders.set('cache-control', 'no-store, no-transform')
					responseHeaders.set('x-accel-buffering', 'no')
					responseHeaders.set(
						'access-control-expose-headers',
						'stream-next-offset, stream-up-to-date, stream-cursor, stream-sse-data-encoding, producer-epoch, producer-seq',
					)
					const stream = response.stream.pipe(Stream.interruptWhen(aborted))
					if (method === 'HEAD' || [204, 205, 304].includes(response.status)) {
						yield* response.arrayBuffer
						return new Response(null, { status: response.status, headers: responseHeaders })
					}
					if (method === 'PUT' || method === 'POST') {
						const body = yield* response.arrayBuffer
						return new Response(body, { status: response.status, headers: responseHeaders })
					}
					const readable = yield* Stream.toReadableStreamEffect(stream)
					return new Response(readable, { status: response.status, headers: responseHeaders })
				}).pipe(Effect.mapError((cause) => new YjsGatewayError({ cause })))
				return yield* run.pipe(Effect.raceFirst(aborted.pipe(Effect.andThen(Effect.interrupt))))
			}),
		})
	}),
)
