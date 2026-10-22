import { describe, it } from '@effect/vitest'
import { Cause, Effect, Exit, Layer, Match, Ref, Stream } from 'effect'
import { HttpClient, HttpClientResponse } from 'effect/http'

import { ConnectionMetrics } from '../../src/lib/effect/connection-metrics.service'
import { DurableStreamsHttpClient } from '../../src/lib/effect/durable-streams-http-client.service'
import { DurableStreamsProxy, DurableStreamsProxyLive } from '../../src/lib/effect/durable-streams-proxy.service'

const NoopConnectionMetrics = Layer.succeed(ConnectionMetrics, {
	withElectricConnection: <A, E, R>(effect: Effect.Effect<A, E, R>) => effect,
	withDurableStreamConnection: <A, E, R>(effect: Effect.Effect<A, E, R>) => effect,
	trackRequest: <A, E, R>(effect: Effect.Effect<A, E, R>) => effect,
	recordPoolSnapshot: () => Effect.void,
	recordProtocolObservation: () => Effect.void,
	recordConnectionLifecycle: () => Effect.void,
	recordRequestError: () => Effect.void,
	recordStreamAbort: () => Effect.void,
	recordProcessFdSnapshot: () => Effect.void,
})

function makeLayer(client: HttpClient.HttpClient) {
	return DurableStreamsProxyLive.pipe(
		Layer.provide(NoopConnectionMetrics),
		Layer.provide(Layer.succeed(DurableStreamsHttpClient, client)),
	)
}

function makeIncomingRequest(init?: {
	method?: string
	headers?: ConstructorParameters<typeof Headers>[0]
	body?: RequestInit['body']
}) {
	const method = init?.method ?? 'GET'
	const raw = new Request('http://proxy.test/streams/sessions/session-id', {
		method,
		headers: init?.headers,
		body: init?.body,
		duplex: init?.body ? 'half' : undefined,
	} as RequestInit)

	return {
		method,
		header: (name: string) => raw.headers.get(name) ?? undefined,
		raw,
	}
}

describe('DurableStreamsProxyLive', () => {
	it.effect('proxies GET stream requests', ({ expect }) =>
		Effect.gen(function* () {
			const requestedUrls = yield* Ref.make<string[]>([])
			const client = HttpClient.make((request) =>
				Ref.update(requestedUrls, (urls) => [...urls, request.url]).pipe(
					Effect.as(HttpClientResponse.fromWeb(request, new Response('stream', { status: 200 }))),
				),
			)

			const proxy = yield* DurableStreamsProxy.pipe(Effect.provide(makeLayer(client)))
			const response = yield* proxy.proxyStreamRequest(
				new URL('http://durable.test/v1/stream/sessions/session-id?cursor=1'),
				makeIncomingRequest(),
			)

			expect(response.status).toBe(200)
			expect(yield* Effect.promise(() => response.text())).toBe('stream')
			expect(yield* Ref.get(requestedUrls)).toEqual([
				'http://durable.test/v1/stream/sessions/session-id?cursor=1',
			])
		}),
	)

	it.effect('proxies POST requests with streaming request bodies', ({ expect }) =>
		Effect.gen(function* () {
			const observed = yield* Ref.make<{ method: string; body: string } | undefined>(undefined)
			const client = HttpClient.make(
				(request) =>
					Effect.gen(function* () {
						const body = yield* Match.value(request.body).pipe(
							Match.tags({
								Stream: (body) =>
									body.stream.pipe(
										Stream.runFold(
											() => '',
											(acc, chunk) => acc + new TextDecoder().decode(chunk),
										),
									),
								Uint8Array: (body) => Effect.succeed(new TextDecoder().decode(body.body)),
							}),
							Match.orElse(() => Effect.succeed('<unexpected body>')),
						)

						yield* Ref.set(observed, { method: request.method, body })
						return HttpClientResponse.fromWeb(request, new Response('ok', { status: 200 }))
					}) as never,
			)

			const proxy = yield* DurableStreamsProxy.pipe(Effect.provide(makeLayer(client)))
			const response = yield* proxy.proxyStreamRequest(
				new URL('http://durable.test/v1/stream/sessions/session-id'),
				makeIncomingRequest({
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: new ReadableStream({
						start(controller) {
							controller.enqueue(new TextEncoder().encode('{"event":"ping"}'))
							controller.close()
						},
					}),
				}),
			)

			expect(response.status).toBe(200)
			expect(yield* Ref.get(observed)).toEqual({ method: 'POST', body: '{"event":"ping"}' })
		}),
	)

	it.effect('forwards safe request headers only', ({ expect }) =>
		Effect.gen(function* () {
			const observedHeaders = yield* Ref.make<Record<string, string>>({})
			const client = HttpClient.make((request) =>
				Ref.set(observedHeaders, request.headers).pipe(
					Effect.as(HttpClientResponse.fromWeb(request, new Response('ok', { status: 200 }))),
				),
			)
			const proxy = yield* DurableStreamsProxy.pipe(Effect.provide(makeLayer(client)))

			yield* proxy.proxyStreamRequest(
				new URL('http://durable.test/v1/stream/sessions/session-id'),
				makeIncomingRequest({
					headers: {
						Authorization: 'Bearer secret',
						Connection: 'close',
						Host: 'proxy.test',
						'x-client': 'kept',
					},
				}),
			)

			const headers = yield* Ref.get(observedHeaders)
			expect(headers.authorization).toBeUndefined()
			expect(headers.connection).toBeUndefined()
			expect(headers.host).toBeUndefined()
			expect(headers['x-client']).toBe('kept')
		}),
	)

	it.effect('strips hop-by-hop response headers and preserves Vary', ({ expect }) =>
		Effect.gen(function* () {
			const client = HttpClient.make((request) =>
				Effect.succeed(
					HttpClientResponse.fromWeb(
						request,
						new Response('ok', {
							status: 200,
							headers: {
								Connection: 'close',
								'Transfer-Encoding': 'chunked',
								Vary: 'Accept-Encoding',
								'x-upstream': 'durable',
							},
						}),
					),
				),
			)
			const proxy = yield* DurableStreamsProxy.pipe(Effect.provide(makeLayer(client)))

			const response = yield* proxy.proxyStreamRequest(
				new URL('http://durable.test/v1/stream/sessions/session-id'),
				makeIncomingRequest(),
			)

			expect(response.headers.get('connection')).toBeNull()
			expect(response.headers.get('transfer-encoding')).toBeNull()
			expect(response.headers.get('Vary')).toBe('Authorization, Cookie, Accept-Encoding')
			expect(response.headers.get('x-upstream')).toBe('durable')
		}),
	)

	it.effect('maps upstream connection failures to the existing 502 response', ({ expect }) =>
		Effect.gen(function* () {
			const client = HttpClient.make(() => Effect.fail(new Error('ECONNREFUSED')) as never)
			const proxy = yield* DurableStreamsProxy.pipe(Effect.provide(makeLayer(client)))

			const response = yield* proxy.proxyStreamRequest(
				new URL('http://durable.test/v1/stream/sessions/session-id'),
				makeIncomingRequest(),
			)

			expect(response.status).toBe(502)
			expect(yield* Effect.promise(() => response.json())).toEqual({
				error: 'Unable to connect to Durable Streams server',
			})
		}),
	)

	it.effect('forwards an upstream 204 No Content without dying (does not fall through to 502/401)', ({ expect }) =>
		Effect.gen(function* () {
			// Upstream answered 204, but the proxy still has a (non-null) byte stream in hand.
			const client = HttpClient.make(() =>
				Effect.succeed({
					status: 204,
					headers: { 'content-type': 'text/plain' },
					stream: Stream.fromIterable([new TextEncoder().encode('unexpected body')]),
				} as unknown as HttpClientResponse.HttpClientResponse),
			)
			const proxy = yield* DurableStreamsProxy.pipe(Effect.provide(makeLayer(client)))

			const exit = yield* Effect.exit(
				proxy.proxyStreamRequest(
					new URL('http://durable.test/v1/stream/sessions/session-id'),
					makeIncomingRequest(),
				),
			)

			// On Node this dies with the 204 TypeError. The service's Effect.catch catches
			// only typed failures, so the defect escapes the 502 fallback — which is how it
			// surfaces as the spurious auth_failure 401 in production rather than a clean 502.
			if (Exit.isFailure(exit)) {
				yield* Effect.logError('proxyStreamRequest(204) →', Cause.pretty(exit.cause))
			}

			expect(Exit.isSuccess(exit)).toBe(true)
			if (Exit.isSuccess(exit)) {
				expect(exit.value.status).toBe(204)
				expect(exit.value.body).toBeNull()
			}
		}),
	)
})
