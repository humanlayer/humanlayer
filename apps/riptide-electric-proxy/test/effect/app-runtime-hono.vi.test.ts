import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { describe, it } from '@effect/vitest'
import { Effect, Layer, Ref } from 'effect'
import { HttpClient, HttpClientResponse } from 'effect/http'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'

import { JWKSConfig } from '../../src/auth/effect/jwks-cache-config.service'
import { JWKSCacheLive } from '../../src/auth/effect/jwks-cache.service'
import { JWTValidator, JWTValidatorLive } from '../../src/auth/effect/jwt-validator.service'
import { makeProxyRuntimeConfig } from '../../src/lib/effect/proxy-runtime-config.service'
import { createAppRuntime, makeAppLayer } from '../../src/lib/effect/runtime'
import { createApp } from '../../src/server'

const mockRows = [
	{
		id: 'artifact-id',
		createdBy: 'user-123',
		resourceOwnerUserId: 'user-123',
		taskId: null,
		userIds: [],
		startedAt: null,
		expiresAt: null,
		featureEnabled: false,
	},
]

const mockQuery = {
	from: () => mockQuery,
	leftJoin: () => mockQuery,
	where: () => mockQuery,
	limit: () => Promise.resolve(mockRows),
	then: (resolve: (rows: typeof mockRows) => unknown) => Promise.resolve(mockRows).then(resolve),
}

const mockDb = {
	select: () => mockQuery,
}

async function createUpstreamRecorder(opts?: { chunkedBody?: string; headers?: Record<string, string> }) {
	const requests: URL[] = []
	const methods: string[] = []
	const bodies: string[] = []
	const server = createServer(async (req, res) => {
		requests.push(new URL(req.url ?? '/', 'http://127.0.0.1'))
		methods.push(req.method ?? '')
		let body = ''
		for await (const chunk of req) body += chunk.toString()
		bodies.push(body)
		res.writeHead(200, { 'content-type': 'application/json', ...opts?.headers })
		if (opts?.chunkedBody) {
			// write() before end() forces chunked encoding (no Content-Length), so the
			// compress middleware's size threshold cannot skip the response
			res.write(opts.chunkedBody)
			res.end()
		} else {
			res.end('{}')
		}
	})
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
	const port = (server.address() as AddressInfo).port

	return {
		shapeUrl: `http://127.0.0.1:${port}/v1/shape`,
		origin: `http://127.0.0.1:${port}`,
		requests,
		methods,
		bodies,
		stop: () => {
			server.closeAllConnections()
			server.close()
		},
	}
}

function mockHttpClientJson(body: unknown) {
	const client = HttpClient.make((request) =>
		Effect.succeed(
			HttpClientResponse.fromWeb(
				request,
				new Response(JSON.stringify(body), {
					status: 200,
					headers: { 'Content-Type': 'application/json' },
				}),
			),
		),
	)
	return Layer.succeed(HttpClient.HttpClient, client)
}

async function createSignedTestToken() {
	const { publicKey, privateKey } = await generateKeyPair('RS256')
	const jwk = await exportJWK(publicKey)
	const kid = 'runtime-jwks-key'
	const issuer = 'https://test.workos.local'
	const token = await new SignJWT({
		sub: 'user-123',
		org_id: 'workos-org-123',
		internal_org_id: 'org-123',
		role: 'admin',
		roles: [],
		permissions: [],
		entitlements: [],
		sid: 'session-123',
		jti: 'jwt-123',
	})
		.setProtectedHeader({ alg: 'RS256', kid })
		.setIssuer(issuer)
		.setIssuedAt()
		.setExpirationTime('1h')
		.sign(privateKey)

	return { token, jwks: { keys: [{ ...jwk, kid, use: 'sig', alg: 'RS256' }] } }
}

describe('Hono app with injected Effect runtime', () => {
	describe.each(['GET', 'POST'])('V2 repository setup access control via %s', (method) => {
		it.effect('rejects missing/invalid credentials and authenticated users before proxying', ({ expect }) =>
			Effect.gen(function* () {
				const { token, jwks } = yield* Effect.promise(createSignedTestToken)
				const upstream = yield* Effect.acquireRelease(
					Effect.promise(() => createUpstreamRecorder()),
					(recorder) => Effect.sync(() => recorder.stop()),
				)
				const runtime = yield* Effect.acquireRelease(
					Effect.sync(() =>
						createAppRuntime(
							makeAppLayer({
								proxyRuntimeConfig: makeProxyRuntimeConfig({
									electricShapeUrl: upstream.shapeUrl,
									durableStreamsOrigin: upstream.origin,
								}),
								authLayer: JWTValidatorLive.pipe(
									Layer.provide(JWKSCacheLive),
									Layer.provide(
										Layer.succeed(JWKSConfig, {
											jwksUrl: 'http://test.local/jwks',
											keyFetchTimeoutMs: 10_000,
											refreshIntervalMs: 300_000,
										}),
									),
									Layer.provide(mockHttpClientJson(jwks)),
								),
							}),
						),
					),
					(runtime) => runtime.disposeEffect,
				)
				const validatedDaemonTokens: string[] = []
				const app = createApp({
					electricShapeUrl: upstream.shapeUrl,
					durableStreamsOrigin: upstream.origin,
					effectRuntime: runtime,
					validateDaemonToken: async (token) => {
						validatedDaemonTokens.push(token)
						return null
					},
					get db(): never {
						throw new Error('Unexpected database access')
					},
				})
				for (const headers of [new Headers(), new Headers({ 'x-daemon-authorization': 'invalid-token' })]) {
					const response = yield* Effect.promise(() =>
						Promise.resolve(
							app.request('/v2/daemon/workspace-repository-statuses?offset=-1', { method, headers }),
						),
					)
					expect(response.status).toBe(401)
				}
				expect(validatedDaemonTokens).toEqual(['invalid-token'])
				const response = yield* Effect.promise(() =>
					Promise.resolve(
						app.request('/v2/daemon/workspace-repository-statuses?hostId=forged-host', {
							method,
							headers: { authorization: `Bearer ${token}` },
							...(method === 'POST' ? { body: JSON.stringify({ hostId: 'forged-host' }) } : {}),
						}),
					),
				)
				expect(response.status).toBe(400)
				expect(yield* Effect.promise(() => response.json())).toEqual({
					error: 'hostId required in daemon token',
				})
				expect(upstream.requests).toHaveLength(0)
			}).pipe(Effect.scoped),
		)
	})

	it.effect('scopes repository setup shapes to validated daemon identity despite query overrides', ({ expect }) =>
		Effect.gen(function* () {
			const upstream = yield* Effect.acquireRelease(
				Effect.promise(() => createUpstreamRecorder()),
				(recorder) => Effect.sync(() => recorder.stop()),
			)
			const runtime = yield* Effect.acquireRelease(
				Effect.sync(() =>
					createAppRuntime(
						makeAppLayer({
							proxyRuntimeConfig: makeProxyRuntimeConfig({
								electricShapeUrl: upstream.shapeUrl,
								durableStreamsOrigin: upstream.origin,
							}),
							authLayer: Layer.succeed(JWTValidator, {
								validateJWT: () => Effect.die('Unexpected user authentication'),
							}),
						}),
					),
				),
				(runtime) => runtime.disposeEffect,
			)
			const config = {
				electricShapeUrl: upstream.shapeUrl,
				durableStreamsOrigin: 'http://127.0.0.1:1',
				effectRuntime: runtime,
			}
			const validatedTokens: string[] = []
			const app = createApp({
				...config,
				get db(): never {
					throw new Error('Unexpected database access')
				},
				validateDaemonToken: async (token) => {
					validatedTokens.push(token)
					return token === 'valid-daemon-token'
						? { organizationId: 'org-123', userId: 'user-123', hostId: 'host-123', createdAt: 1 }
						: null
				},
			})
			for (const method of ['GET', 'POST']) {
				const response = yield* Effect.promise(() =>
					Promise.resolve(
						app.request(
							'/v2/daemon/workspace-repository-statuses?offset=-1&table=tasks&where=true&params[1]=other-org&params[2]=other-user&params[3]=other-host',
							{
								method,
								headers: { 'x-daemon-authorization': 'valid-daemon-token' },
								...(method === 'POST' ? { body: '{}' } : {}),
							},
						),
					),
				)
				expect(response.status).toBe(200)
			}
			expect(upstream.methods).toEqual(['GET', 'POST'])
			expect(validatedTokens).toEqual(['valid-daemon-token', 'valid-daemon-token'])
			for (const request of upstream.requests) {
				expect(request.searchParams.get('table')).toBe('workspace_repository_status_for_user_for_host')
				expect(request.searchParams.getAll('table')).toEqual(['workspace_repository_status_for_user_for_host'])
				expect(request.searchParams.getAll('where')).toEqual([
					'("organization_id" = $1 and "user_id" = $2 and "host_id" = $3)',
				])
				expect(request.searchParams.get('params[1]')).toBe('org-123')
				expect(request.searchParams.get('params[2]')).toBe('user-123')
				expect(request.searchParams.get('params[3]')).toBe('host-123')
			}
			expect(upstream.requests).toHaveLength(2)
		}).pipe(Effect.scoped),
	)

	describe.each([
		'/v1/tasks',
		'/v2/tasks',
		'/v2/artifacts/metadata',
		'/v3/hosts',
		'/v2/daemon/workspace-repository-statuses',
	])('POST authorization on %s', (route) => {
		it.effect('preserves the authenticated URL scope and forwards only subset fields', ({ expect }) =>
			Effect.gen(function* () {
				const upstream = yield* Effect.acquireRelease(
					Effect.promise(() => createUpstreamRecorder()),
					(recorder) => Effect.sync(() => recorder.stop()),
				)
				const runtime = yield* Effect.acquireRelease(
					Effect.sync(() =>
						createAppRuntime(
							makeAppLayer({
								proxyRuntimeConfig: makeProxyRuntimeConfig({
									electricShapeUrl: upstream.shapeUrl,
									durableStreamsOrigin: upstream.origin,
								}),
								authLayer: Layer.succeed(JWTValidator, {
									validateJWT: () => Effect.die('Unexpected user authentication'),
								}),
							}),
						),
					),
					(runtime) => runtime.disposeEffect,
				)
				const validatedTokens: string[] = []
				const app = createApp({
					electricShapeUrl: upstream.shapeUrl,
					durableStreamsOrigin: upstream.origin,
					effectRuntime: runtime,
					validateDaemonToken: async (token) => {
						validatedTokens.push(token)
						return token === 'valid-daemon-token'
							? { organizationId: 'org-123', userId: 'user-123', hostId: 'host-123', createdAt: 1 }
							: null
					},
					get db(): never {
						throw new Error('Unexpected database access')
					},
				})
				const baseline = yield* Effect.promise(() =>
					Promise.resolve(
						app.request(`${route}?offset=-1`, {
							headers: { 'x-daemon-authorization': 'valid-daemon-token' },
						}),
					),
				)
				expect(baseline.status).toBe(200)
				const subset = { where: 'id = $1', params: { '1': 'row-123' }, order_by: 'id ASC', limit: 1 }
				const response = yield* Effect.promise(() =>
					Promise.resolve(
						app.request(`${route}?offset=-1`, {
							method: 'POST',
							headers: {
								'x-daemon-authorization': 'valid-daemon-token',
								'content-type': 'application/json',
							},
							// Electric merges body fields over query fields when a subset object is present.
							body: JSON.stringify({
								table: 'tasks',
								where: 'true',
								params: { 1: 'other-org' },
								columns: '*',
								queryable_columns: '*',
								replica: 'full',
								shape_definition: 'unrestricted',
								subset,
							}),
						}),
					),
				)
				expect(validatedTokens).toEqual(['valid-daemon-token', 'valid-daemon-token'])
				expect(response.status).toBe(200)
				expect(upstream.methods).toEqual(['GET', 'POST'])
				expect(upstream.requests).toHaveLength(2)
				expect(upstream.requests[1]?.toString()).toBe(upstream.requests[0]?.toString())
				expect(JSON.parse(upstream.bodies[1] ?? 'null')).toEqual({ subset })
			}).pipe(Effect.scoped),
		)
	})

	it.effect('validates user auth through a real runtime built from a test layer', ({ expect }) =>
		Effect.gen(function* () {
			const upstream = yield* Effect.promise(() => createUpstreamRecorder())
			const validationCount = yield* Ref.make(0)

			try {
				const runtime = createAppRuntime(
					makeAppLayer({
						proxyRuntimeConfig: makeProxyRuntimeConfig({
							electricShapeUrl: upstream.shapeUrl,
							durableStreamsOrigin: 'http://127.0.0.1:1',
						}),
						authLayer: Layer.succeed(JWTValidator, {
							validateJWT: () =>
								Ref.update(validationCount, (count: number) => count + 1).pipe(
									Effect.as({
										userId: 'user-123',
										organizationId: 'org-123',
										workosOrganizationId: 'workos-org-123',
										roles: [],
										permissions: [],
										entitlements: [],
										sessionId: 'session-123',
									}),
								),
						}),
					}),
				)

				const app = createApp({
					electricShapeUrl: upstream.shapeUrl,
					durableStreamsOrigin: 'http://127.0.0.1:1',
					electricSecret: 'test-secret',
					effectRuntime: runtime,
					validateDaemonToken: async () => null,
					db: mockDb as any,
				})

				const response = yield* Effect.promise(() =>
					Promise.resolve(
						app.request('/v1/tasks?live=true', {
							method: 'GET',
							headers: { authorization: 'Bearer test-token' },
						}),
					),
				)

				expect(response.status).toBe(200)
				expect(yield* Ref.get(validationCount)).toBe(1)
				expect(upstream.requests).toHaveLength(1)
				expect(upstream.requests[0]?.searchParams.get('where')).toContain('task_user_acl')

				yield* runtime.disposeEffect
			} finally {
				upstream.stop()
			}
		}),
	)

	describe.each(['', '/', '/durable-streams', '/durable-streams/'])('Durable Streams URL suffix %j', (suffix) => {
		it.effect('proxies Durable Streams requests through the runtime-backed service path', ({ expect }) =>
			Effect.gen(function* () {
				const upstream = yield* Effect.promise(() => createUpstreamRecorder())
				const validationCount = yield* Ref.make(0)

				try {
					const runtime = createAppRuntime(
						makeAppLayer({
							proxyRuntimeConfig: makeProxyRuntimeConfig({
								electricShapeUrl: upstream.shapeUrl,
								durableStreamsOrigin: `${upstream.origin}${suffix}`,
							}),
							authLayer: Layer.succeed(JWTValidator, {
								validateJWT: () =>
									Ref.update(validationCount, (count: number) => count + 1).pipe(
										Effect.as({
											userId: 'user-123',
											organizationId: 'org-123',
											workosOrganizationId: 'workos-org-123',
											roles: [],
											permissions: [],
											entitlements: [],
											sessionId: 'session-123',
										}),
									),
							}),
						}),
					)

					const app = createApp({
						electricShapeUrl: upstream.shapeUrl,
						durableStreamsOrigin: `${upstream.origin}${suffix}`,
						effectRuntime: runtime,
						validateDaemonToken: async () => null,
						db: mockDb as any,
					})

					const sessionId = '00000000-0000-4000-8000-000000000001'
					const response = yield* Effect.promise(() =>
						Promise.resolve(
							app.request(`/streams/sessions/${sessionId}?cursor=abc`, {
								method: 'GET',
								headers: { authorization: 'Bearer test-token' },
							}),
						),
					)

					expect(response.status).toBe(200)
					expect(yield* Ref.get(validationCount)).toBe(1)
					expect(upstream.requests).toHaveLength(1)
					const prefix = suffix.replace(/\/+$/, '')
					expect(upstream.requests[0]?.pathname).toBe(`${prefix}/v1/stream/sessions/${sessionId}`)
					expect(upstream.requests[0]?.searchParams.get('cursor')).toBe('abc')
					expect(upstream.methods).toEqual(['GET'])

					yield* runtime.disposeEffect
				} finally {
					upstream.stop()
				}
			}),
		)
	})

	it.effect('validates auth with test JWT/JWKS layers while proxying Electric requests', ({ expect }) =>
		Effect.gen(function* () {
			const upstream = yield* Effect.promise(() => createUpstreamRecorder())
			const { token, jwks } = yield* Effect.promise(createSignedTestToken)

			try {
				const authLayer = JWTValidatorLive.pipe(
					Layer.provide(JWKSCacheLive),
					Layer.provide(
						Layer.succeed(JWKSConfig, {
							jwksUrl: 'http://test.local/jwks',
							keyFetchTimeoutMs: 10_000,
							refreshIntervalMs: 300_000,
						}),
					),
					Layer.provide(mockHttpClientJson(jwks)),
				)
				const runtime = createAppRuntime(
					makeAppLayer({
						proxyRuntimeConfig: makeProxyRuntimeConfig({
							electricShapeUrl: upstream.shapeUrl,
							durableStreamsOrigin: 'http://127.0.0.1:1',
						}),
						authLayer,
					}),
				)

				const app = createApp({
					electricShapeUrl: upstream.shapeUrl,
					durableStreamsOrigin: 'http://127.0.0.1:1',
					electricSecret: 'test-secret',
					effectRuntime: runtime,
					validateDaemonToken: async () => null,
					db: mockDb as any,
				})

				const response = yield* Effect.promise(() =>
					Promise.resolve(
						app.request('/v1/tasks?live=true', {
							method: 'GET',
							headers: { authorization: `Bearer ${token}` },
						}),
					),
				)

				expect(response.status).toBe(200)
				expect(upstream.requests).toHaveLength(1)
				expect(upstream.requests[0]?.searchParams.get('where')).toContain('task_user_acl')

				yield* runtime.disposeEffect
			} finally {
				upstream.stop()
			}
		}),
	)

	it.effect('gzips proxied shape responses but leaves /streams uncompressed', ({ expect }) =>
		Effect.gen(function* () {
			const upstreamBody = `{"pad":"${'x'.repeat(4096)}"}`
			const upstream = yield* Effect.promise(() =>
				createUpstreamRecorder({
					chunkedBody: upstreamBody,
					headers: { 'cache-control': 'public, max-age=300' },
				}),
			)

			try {
				const runtime = createAppRuntime(
					makeAppLayer({
						proxyRuntimeConfig: makeProxyRuntimeConfig({
							electricShapeUrl: upstream.shapeUrl,
							durableStreamsOrigin: upstream.origin,
						}),
						authLayer: Layer.succeed(JWTValidator, {
							validateJWT: () =>
								Effect.succeed({
									userId: 'user-123',
									organizationId: 'org-123',
									workosOrganizationId: 'workos-org-123',
									roles: [],
									permissions: [],
									entitlements: [],
									sessionId: 'session-123',
								}),
						}),
					}),
				)

				const app = createApp({
					electricShapeUrl: upstream.shapeUrl,
					durableStreamsOrigin: upstream.origin,
					effectRuntime: runtime,
					validateDaemonToken: async () => null,
					db: mockDb as any,
				})

				// Shape route: compressed, and the gzip round-trips back to the upstream body
				const shapeResponse = yield* Effect.promise(() =>
					Promise.resolve(
						app.request('/v1/tasks?offset=-1', {
							method: 'GET',
							headers: { authorization: 'Bearer test-token', 'accept-encoding': 'gzip' },
						}),
					),
				)
				expect(shapeResponse.status).toBe(200)
				expect(shapeResponse.headers.get('content-encoding')).toBe('gzip')
				const decompressed = yield* Effect.promise(() =>
					new Response(shapeResponse.body!.pipeThrough(new DecompressionStream('gzip'))).text(),
				)
				expect(decompressed).toBe(upstreamBody)

				// Streams route: declares no-transform, so compression (and any compliant
				// intermediary transform) is bypassed and incremental chunks are never buffered
				const streamResponse = yield* Effect.promise(() =>
					Promise.resolve(
						app.request('/streams/sessions/00000000-0000-4000-8000-000000000001?cursor=abc', {
							method: 'GET',
							headers: { authorization: 'Bearer test-token', 'accept-encoding': 'gzip' },
						}),
					),
				)
				expect(streamResponse.status).toBe(200)
				// upstream caching policy passes through untouched; only no-transform is appended
				expect(streamResponse.headers.get('cache-control')).toBe('public, max-age=300, no-transform')
				expect(streamResponse.headers.get('x-accel-buffering')).toBe('no')
				expect(streamResponse.headers.get('content-encoding')).toBeNull()
				expect(yield* Effect.promise(() => streamResponse.text())).toBe(upstreamBody)

				yield* runtime.disposeEffect
			} finally {
				upstream.stop()
			}
		}),
	)
})
