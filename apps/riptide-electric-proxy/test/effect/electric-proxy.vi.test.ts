import { describe, it } from '@effect/vitest'
import { Effect, Layer, Predicate, Ref } from 'effect'
import { HttpClient, HttpClientResponse } from 'effect/http'

import { ConnectionMetrics } from '../../src/lib/effect/connection-metrics.service'
import { ElectricProxyHttpClient } from '../../src/lib/effect/electric-http-client.service'
import { ElectricProxy, ElectricProxyLive } from '../../src/lib/effect/electric-proxy.service'

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
	return ElectricProxyLive.pipe(
		Layer.provide(NoopConnectionMetrics),
		Layer.provide(Layer.succeed(ElectricProxyHttpClient, client)),
	)
}

const subset = {
	where: 'id = $1',
	params: { '1': 'repository-123' },
	order_by: 'id ASC',
	limit: 10,
	offset: 2,
	where_expr: {
		type: 'func',
		name: 'eq',
		args: [
			{ type: 'ref', column: 'id' },
			{ type: 'val', paramIndex: 1 },
		],
	},
	order_by_expr: [{ column: 'id', direction: 'asc' }],
}

const shapeOverrides = {
	table: 'secrets',
	where: 'true',
	params: { '1': 'other-org' },
	columns: '*',
	queryable_columns: '*',
	replica: 'full',
	shape_definition: 'unrestricted',
	secret: 'attacker-secret',
	source_id: 'other-source',
	experimental_compaction: true,
	'params[1]': 'other-org',
	future_shape_option: 'must-not-pass-through',
}

describe('ElectricProxyLive', () => {
	it.effect('proxies GET shape requests', ({ expect }) =>
		Effect.gen(function* () {
			const requestedUrls = yield* Ref.make<string[]>([])
			const client = HttpClient.make((request) =>
				Ref.update(requestedUrls, (urls) => [...urls, request.url]).pipe(
					Effect.as(HttpClientResponse.fromWeb(request, new Response('shape', { status: 200 }))),
				),
			)

			const proxy = yield* ElectricProxy.pipe(Effect.provide(makeLayer(client)))
			const response = yield* proxy.proxyShapeRequest(new URL('http://electric.test/v1/shape?table=tasks'))

			expect(response.status).toBe(200)
			expect(yield* Effect.promise(() => response.text())).toBe('shape')
			expect(yield* Ref.get(requestedUrls)).toEqual(['http://electric.test/v1/shape?table=tasks'])
		}),
	)

	describe.each([
		{ name: 'flat subset fields', body: JSON.stringify(subset), expected: { subset } },
		{ name: 'nested subset fields', body: JSON.stringify({ subset }), expected: { subset } },
		{ name: 'empty body', body: '', expected: {} },
		{ name: 'empty object', body: '{}', expected: {} },
		{ name: 'explicit empty subset', body: '{"subset":{}}', expected: { subset: {} } },
		{
			name: 'flat subset offset is not a log offset',
			body: '{"offset":2,"handle":"handle-1"}',
			expected: { subset: { offset: 2 }, handle: 'handle-1' },
		},
		{
			name: 'nested subset keeps log offset and handle',
			body: JSON.stringify({
				subset,
				offset: '42_0',
				handle: 'handle-1',
				live: 'true',
				live_sse: 'true',
				experimental_live_sse: 'true',
				log: 'changes_only',
			}),
			expected: {
				subset,
				offset: '42_0',
				handle: 'handle-1',
				live: 'true',
				live_sse: 'true',
				experimental_live_sse: 'true',
				log: 'changes_only',
			},
		},
		{
			name: 'nested subset strips root and nested shape overrides',
			body: JSON.stringify({ ...shapeOverrides, subset: { ...shapeOverrides, ...subset } }),
			expected: { subset },
		},
		{
			name: 'flat subset strips shape overrides',
			body: JSON.stringify({ ...shapeOverrides, ...subset }),
			expected: { subset },
		},
	])('$name', ({ body, expected }) => {
		it.effect('proxies only subset/request controls and preserves the trusted URL', ({ expect }) =>
			Effect.gen(function* () {
				const observed = yield* Ref.make<{ method: string; body: string; url: string } | undefined>(undefined)
				const client = HttpClient.make((request) =>
					Ref.set(observed, {
						method: request.method,
						url: request.url,
						body: Predicate.isTagged(request.body, 'Uint8Array')
							? new TextDecoder().decode(request.body.body)
							: '<unexpected body>',
					}).pipe(Effect.as(HttpClientResponse.fromWeb(request, new Response('ok', { status: 200 })))),
				)

				const proxy = yield* ElectricProxy.pipe(Effect.provide(makeLayer(client)))
				const url = new URL(
					'http://electric.test/v1/shape?table=tasks&where=organization_id%3D%241&params[1]=org-123&columns=id&replica=default&offset=-1&handle=trusted-handle&secret=trusted-secret&subset__where=id%3D%242',
				)
				const response = yield* proxy.proxyShapeRequest(url, undefined, {
					method: 'POST',
					text: () => Promise.resolve(body),
				})

				expect(response.status).toBe(200)
				const request = yield* Ref.get(observed)
				expect(request).toMatchObject({ method: 'POST', url: url.toString() })
				expect(JSON.parse(request?.body ?? 'null')).toEqual(expected)
			}),
		)
	})

	describe.each(['{', 'null', '[]', '1', '"string"', '{"subset":null}', '{"subset":[]}', '{"subset":"bad"}'])(
		'invalid POST body %s',
		(body) => {
			it.effect('returns 400 without contacting Electric', ({ expect }) =>
				Effect.gen(function* () {
					const requests = yield* Ref.make(0)
					const client = HttpClient.make((request) =>
						Ref.update(requests, (count) => count + 1).pipe(
							Effect.as(HttpClientResponse.fromWeb(request, new Response('unexpected'))),
						),
					)
					const proxy = yield* ElectricProxy.pipe(Effect.provide(makeLayer(client)))
					const response = yield* proxy.proxyShapeRequest(
						new URL('http://electric.test/v1/shape'),
						undefined,
						{
							method: 'POST',
							text: () => Promise.resolve(body),
						},
					)
					expect(response.status).toBe(400)
					expect(yield* Effect.promise(() => response.json())).toEqual({
						error: 'Expected a JSON object with an optional subset object',
					})
					expect(yield* Ref.get(requests)).toBe(0)
				}),
			)
		},
	)

	it.effect('maps upstream connection failures to the existing 502 response', ({ expect }) =>
		Effect.gen(function* () {
			const client = HttpClient.make(() => Effect.fail(new Error('ECONNREFUSED')) as never)
			const proxy = yield* ElectricProxy.pipe(Effect.provide(makeLayer(client)))

			const response = yield* proxy.proxyShapeRequest(new URL('http://electric.test/v1/shape'))

			expect(response.status).toBe(502)
			expect(yield* Effect.promise(() => response.json())).toEqual({ error: 'Unable to connect to Electric' })
		}),
	)

	it.effect('sets Vary for authorization-sensitive Electric responses', ({ expect }) =>
		Effect.gen(function* () {
			const client = HttpClient.make((request) =>
				Effect.succeed(
					HttpClientResponse.fromWeb(
						request,
						new Response('ok', {
							status: 200,
							headers: { Vary: 'Accept-Encoding', 'x-upstream': 'electric' },
						}),
					),
				),
			)
			const proxy = yield* ElectricProxy.pipe(Effect.provide(makeLayer(client)))

			const response = yield* proxy.proxyShapeRequest(new URL('http://electric.test/v1/shape'))

			expect(response.headers.get('Vary')).toBe('Authorization, Cookie, Accept-Encoding')
			expect(response.headers.get('x-upstream')).toBe('electric')
		}),
	)

	it.effect('passes Electric error responses through to the client', ({ expect }) =>
		Effect.gen(function* () {
			const client = HttpClient.make((request) =>
				Effect.succeed(
					HttpClientResponse.fromWeb(
						request,
						new Response('{"error":"upstream"}', {
							status: 500,
							headers: { 'Content-Type': 'application/json' },
						}),
					),
				),
			)
			const proxy = yield* ElectricProxy.pipe(Effect.provide(makeLayer(client)))

			const response = yield* proxy.proxyShapeRequest(new URL('http://electric.test/v1/shape'), {
				routePath: '/v1/tasks',
				tableName: 'tasks',
				authContext: {
					userId: 'user-123',
					organizationId: 'org-123',
				},
			})

			expect(response.status).toBe(500)
			expect(yield* Effect.promise(() => response.json())).toEqual({ error: 'upstream' })
		}),
	)
})
