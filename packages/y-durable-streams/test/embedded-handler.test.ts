import { describe, it } from '@effect/vitest'
import { Deferred, Effect, Layer, Stream } from 'effect'
import { HttpClient, HttpClientResponse } from 'effect/http'
import { expect } from 'vitest'

import { parseYjsQuery, YjsGateway, YjsGatewayLive, YjsStorageConfig } from '../src/server'

const makeBrowserAbortController = () => new AbortController()

describe('embedded handler', () => {
	it('accepts Rust Durable Streams offsets and rejects non-canonical offsets', () => {
		expect(
			parseYjsQuery(
				new URL('http://local/v1/yjs/test/docs/document?offset=0000000000000001_000000000000000a&live=sse'),
			),
		).toEqual({ awareness: false })
		expect(parseYjsQuery(new URL('http://local/v1/yjs/test/docs/document?offset=1_10'))).toBeNull()
	})

	it.effect('preserves prefix, binary body, producer headers and fixed TTL without leaking credentials', () =>
		Effect.gen(function* () {
			const seen: { url: string; headers: Record<string, string>; method: string; bytes: number[] }[] = []
			const client = HttpClient.make((request) => {
				seen.push({
					url: request.url,
					headers: request.headers,
					method: request.method,
					bytes: request.body._tag === 'Uint8Array' ? [...request.body.body] : [],
				})
				return Effect.succeed(
					HttpClientResponse.fromWeb(
						request,
						new Response('', {
							status: 201,
							headers: { 'stream-next-offset': '123', 'stream-up-to-date': 'true' },
						}),
					),
				)
			})
			const run = Effect.gen(function* () {
				const gateway = yield* YjsGateway
				for (const suffix of ['', '?awareness=default']) {
					const request = new Request(`http://local/v1/yjs/test/docs/document${suffix}`, {
						method: 'PUT',
						headers: {
							authorization: 'secret',
							cookie: 'secret',
							'x-daemon-authorization': 'secret',
							'stream-ttl': '1',
							'stream-expires-at': 'tomorrow',
							'stream-closed': 'true',
							'content-type': 'application/json',
						},
						body: new Uint8Array([0, 128, 255]),
					})
					const response = yield* gateway.handle(request, request.signal)
					yield* Effect.promise(() => response.arrayBuffer())
					expect(response.headers.get('stream-next-offset')).toBe('123')
					expect(response.headers.get('cache-control')).toContain('no-transform')
				}
				const post = new Request('http://local/v1/yjs/test/docs/document', {
					method: 'POST',
					headers: {
						'producer-id': 'producer',
						'producer-epoch': '0',
						'producer-seq': '1',
						'stream-closed': 'true',
					},
					body: new Uint8Array([2, 1, 2]),
				})
				const response = yield* gateway.handle(post, post.signal)
				yield* Effect.promise(() => response.arrayBuffer())
			})
			yield* run.pipe(
				Effect.provide(
					YjsGatewayLive.pipe(
						Layer.provide(
							Layer.mergeAll(
								Layer.succeed(HttpClient.HttpClient, client),
								Layer.succeed(YjsStorageConfig, { baseUrl: 'http://durable-streams.test/prefix/' }),
							),
						),
					),
				),
			)
			expect(seen.map((r) => r.url)).toEqual([
				'http://durable-streams.test/prefix/v1/stream/yjs/test/docs/document/.updates',
				'http://durable-streams.test/prefix/v1/stream/yjs/test/docs/document/.awareness/default',
				'http://durable-streams.test/prefix/v1/stream/yjs/test/docs/document/.updates',
			])
			expect(seen[0]?.bytes).toEqual([0, 128, 255])
			for (const request of seen.slice(0, 2))
				expect(request.headers).toMatchObject({
					'content-type': 'application/octet-stream',
					'stream-ttl': '3600',
				})
			for (const request of seen)
				for (const name of [
					'authorization',
					'cookie',
					'x-daemon-authorization',
					'stream-expires-at',
					'stream-closed',
				])
					expect(request.headers[name]).toBeUndefined()
			expect(seen[2]?.headers).toMatchObject({
				'content-type': 'application/octet-stream',
				'producer-id': 'producer',
				'producer-epoch': '0',
				'producer-seq': '1',
			})
		}),
	)

	it.effect('cancels upstream read when the browser aborts', () =>
		Effect.gen(function* () {
			const opened = yield* Deferred.make<void>()
			const closed = yield* Deferred.make<void>()
			const client = HttpClient.make((request) =>
				Effect.gen(function* () {
					const stream: Stream.Stream<Uint8Array> = Stream.fromEffect(
						Deferred.succeed(opened, undefined).pipe(Effect.as(new Uint8Array([1]))),
					).pipe(Stream.concat(Stream.never), Stream.ensuring(Deferred.succeed(closed, undefined)))
					const body = yield* Stream.toReadableStreamEffect(stream)
					return HttpClientResponse.fromWeb(request, new Response(body))
				}),
			)
			yield* Effect.gen(function* () {
				const gateway = yield* YjsGateway
				const controller = makeBrowserAbortController()
				const response = yield* gateway.handle(
					new Request('http://local/v1/yjs/test/docs/document?offset=-1&live=sse'),
					controller.signal,
				)
				const read = response.arrayBuffer()
				yield* Deferred.await(opened)
				controller.abort()
				yield* Deferred.await(closed)
				yield* Effect.promise(() => read)
			}).pipe(
				Effect.provide(
					YjsGatewayLive.pipe(
						Layer.provide(
							Layer.mergeAll(
								Layer.succeed(HttpClient.HttpClient, client),
								Layer.succeed(YjsStorageConfig, { baseUrl: 'http://durable-streams.test/prefix' }),
							),
						),
					),
				),
			)
		}),
	)

	it.effect('rejects unsupported targets without executing HTTP', () =>
		Effect.gen(function* () {
			const gateway = yield* YjsGateway
			for (const suffix of [
				'?awareness=',
				'?awareness=default&awareness=default',
				'?awareness=other',
				'?offset=snapshot',
				'?offset=123_snapshot',
				'/.updates',
			]) {
				const request = new Request(`http://local/v1/yjs/test/docs/document${suffix}`)
				const response = yield* gateway.handle(request, request.signal)
				expect(response.status).toBe(400)
			}
		}).pipe(
			Effect.provide(
				YjsGatewayLive.pipe(
					Layer.provide(
						Layer.mergeAll(
							Layer.succeed(
								HttpClient.HttpClient,
								HttpClient.make(() => Effect.die('Unexpected HTTP')),
							),
							Layer.succeed(YjsStorageConfig, { baseUrl: 'http://durable-streams.test' }),
						),
					),
				),
			),
		),
	)
})
