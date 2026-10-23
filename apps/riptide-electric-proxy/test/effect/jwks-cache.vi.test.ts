import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { describe, it } from '@effect/vitest'
import { Cause, Clock, Duration, Effect, Exit, Fiber, Layer, Ref } from 'effect'
import { FetchHttpClient, HttpClient, HttpClientResponse } from 'effect/http'
import { TestClock } from 'effect/testing'
import { exportJWK, generateKeyPair } from 'jose'

import {
	type JWKSFetchError,
	type JWKSFetchTimeoutError,
	type JWKSKeyImportError,
	JWKSKeyNotFoundError,
} from '../../src/auth/effect/errors'
import { JWKSConfig } from '../../src/auth/effect/jwks-cache-config.service'
import { JWKSCache, JWKSCacheLive } from '../../src/auth/effect/jwks-cache.service'
import { ConnectionMetricsLive } from '../../src/lib/effect/connection-metrics.service'
import { HttpPoolMetricsLive } from '../../src/lib/effect/http-pool-metrics.service'
import { JWKSHttpClientAsHttpClientLive } from '../../src/lib/effect/jwks-http-client.service'

// Fast config - retry window is too short for exponential retries
const JWKSConfigFailFast = Layer.succeed(JWKSConfig, {
	jwksUrl: 'http://test.local/jwks',
	keyFetchTimeoutMs: 200,
	refreshIntervalMs: 1,
})

// Config with enough retry window for retry tests
const JWKSConfigWithRetry = Layer.succeed(JWKSConfig, {
	jwksUrl: 'http://test.local/jwks',
	keyFetchTimeoutMs: 200,
	refreshIntervalMs: 15_000,
})

const JWKSConfigShortRefreshWithManyRetries = Layer.succeed(JWKSConfig, {
	jwksUrl: 'http://test.local/jwks',
	keyFetchTimeoutMs: 200,
	refreshIntervalMs: 1_000,
})

// Helper: generate a real RSA JWK for testing
async function generateTestJWKS(kid: string) {
	const { publicKey } = await generateKeyPair('RS256')
	const jwk = await exportJWK(publicKey)
	return {
		keys: [{ ...jwk, kid, use: 'sig', alg: 'RS256' }],
	}
}

// Helper: serve a fixed JWKS payload over real HTTP on a random port
async function startJwksServer(jwks: unknown): Promise<{ port: number; stop: () => void }> {
	const server = createServer((_req, res) => {
		res.writeHead(200, { 'Content-Type': 'application/json' })
		res.end(JSON.stringify(jwks))
	})
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
	const port = (server.address() as AddressInfo).port
	return {
		port,
		stop: () => {
			server.closeAllConnections()
			server.close()
		},
	}
}

// Helper: build a mock HTTP client that returns a given JSON body
function mockHttpClientJson(body: unknown, status = 200) {
	const client = HttpClient.make((request) =>
		Effect.succeed(
			HttpClientResponse.fromWeb(
				request,
				new Response(JSON.stringify(body), {
					status,
					headers: { 'Content-Type': 'application/json' },
				}),
			),
		),
	)
	return Layer.succeed(HttpClient.HttpClient, client)
}

// Helper: build a mock HTTP client that hangs forever (via custom fetch)
function mockHttpClientHang() {
	const mockFetch: typeof globalThis.fetch = (() => new Promise(() => {})) as unknown as typeof globalThis.fetch
	return FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch, mockFetch)))
}

// Helper: build a mock HTTP client that fails with a network error
function mockHttpClientNetworkError() {
	const client = HttpClient.make((request) => Effect.die(new Error('ECONNREFUSED')))
	return Layer.succeed(HttpClient.HttpClient, client)
}

// Helper: compose JWKSCacheLive with test config and a mock HTTP client
function makeTestLayer(httpLayer: Layer.Layer<HttpClient.HttpClient>, config = JWKSConfigFailFast) {
	return JWKSCacheLive.pipe(Layer.provide(config), Layer.provide(httpLayer))
}

function runFailedInitialization(
	layer: Layer.Layer<JWKSCache, JWKSFetchError | JWKSFetchTimeoutError | JWKSKeyImportError>,
) {
	return Effect.gen(function* () {
		const fiber = yield* Effect.exit(JWKSCache.pipe(Effect.provide(layer))).pipe(Effect.forkChild)
		yield* TestClock.adjust(Duration.seconds(20))
		return yield* Fiber.join(fiber)
	})
}

describe('JWKSCache - Happy Path', () => {
	it.effect('should fetch keys and return a valid CryptoKey by kid', ({ expect }) =>
		Effect.gen(function* () {
			const testKid = 'test-key-happy'
			const jwks = yield* Effect.promise(() => generateTestJWKS(testKid))

			const layer = makeTestLayer(mockHttpClientJson(jwks))
			const cache = yield* JWKSCache.pipe(Effect.provide(layer))

			const key = yield* cache.getKey(testKid)
			expect(key).toBeDefined()
		}),
	)

	it.effect('should report isReady after initialization', ({ expect }) =>
		Effect.gen(function* () {
			const jwks = yield* Effect.promise(() => generateTestJWKS('ready-test'))

			const layer = makeTestLayer(mockHttpClientJson(jwks))
			const cache = yield* JWKSCache.pipe(Effect.provide(layer))

			const ready = yield* cache.isReady
			expect(ready).toBe(true)
		}),
	)

	it.effect('should handle multiple keys', ({ expect }) =>
		Effect.gen(function* () {
			const { publicKey: pk1 } = yield* Effect.promise(() => generateKeyPair('RS256'))
			const { publicKey: pk2 } = yield* Effect.promise(() => generateKeyPair('RS256'))
			const jwk1 = yield* Effect.promise(() => exportJWK(pk1))
			const jwk2 = yield* Effect.promise(() => exportJWK(pk2))

			const jwks = {
				keys: [
					{ ...jwk1, kid: 'key-1', use: 'sig', alg: 'RS256' },
					{ ...jwk2, kid: 'key-2', use: 'sig', alg: 'RS256' },
				],
			}

			const layer = makeTestLayer(mockHttpClientJson(jwks))
			const cache = yield* JWKSCache.pipe(Effect.provide(layer))

			const key1 = yield* cache.getKey('key-1')
			const key2 = yield* cache.getKey('key-2')
			expect(key1).toBeDefined()
			expect(key2).toBeDefined()
		}),
	)

	it.effect('should skip keys without a kid', ({ expect }) =>
		Effect.gen(function* () {
			const { publicKey } = yield* Effect.promise(() => generateKeyPair('RS256'))
			const jwk = yield* Effect.promise(() => exportJWK(publicKey))

			const jwks = {
				keys: [
					{ ...jwk, use: 'sig', alg: 'RS256' }, // no kid
					{ ...jwk, kid: 'has-kid', use: 'sig', alg: 'RS256' },
				],
			}

			const layer = makeTestLayer(mockHttpClientJson(jwks))
			const cache = yield* JWKSCache.pipe(Effect.provide(layer))

			const key = yield* cache.getKey('has-kid')
			expect(key).toBeDefined()
		}),
	)
})

describe('JWKSCache - Key Not Found', () => {
	it.effect('should fail with JWKSKeyNotFoundError for unknown kid', ({ expect }) =>
		Effect.gen(function* () {
			const jwks = yield* Effect.promise(() => generateTestJWKS('existing-key'))

			const layer = makeTestLayer(mockHttpClientJson(jwks))
			const cache = yield* JWKSCache.pipe(Effect.provide(layer))

			const exit = yield* Effect.exit(cache.getKey('nonexistent-key'))
			expect(Exit.isFailure(exit)).toBe(true)
			if (Exit.isFailure(exit)) {
				const failures = exit.cause.reasons.filter(Cause.isFailReason).map((reason) => reason.error)
				const error = Array.from(failures)[0]
				expect(error).toBeInstanceOf(JWKSKeyNotFoundError)
				expect((error as JWKSKeyNotFoundError).kid).toBe('nonexistent-key')
			}
		}),
	)
})

describe('JWKSCache - Fetch Failures', () => {
	it.effect('should fail when server returns 500', ({ expect }) =>
		Effect.gen(function* () {
			const layer = makeTestLayer(mockHttpClientJson({ error: 'internal error' }, 500))
			const exit = yield* runFailedInitialization(layer)
			expect(Exit.isFailure(exit)).toBe(true)
		}),
	)

	it.effect('should fail when server returns invalid JSON schema', ({ expect }) =>
		Effect.gen(function* () {
			// Valid JSON but doesn't match JWKSResponse schema (missing 'keys' array)
			const layer = makeTestLayer(mockHttpClientJson({ not_keys: [] }))
			const exit = yield* runFailedInitialization(layer)
			expect(Exit.isFailure(exit)).toBe(true)
		}),
	)

	it.effect('should fail when server returns non-JSON', ({ expect }) => {
		const htmlClient = HttpClient.make((request) =>
			Effect.succeed(
				HttpClientResponse.fromWeb(
					request,
					new Response('<html>not json</html>', {
						status: 200,
						headers: { 'Content-Type': 'text/html' },
					}),
				),
			),
		)
		const htmlLayer = Layer.succeed(HttpClient.HttpClient, htmlClient)

		return Effect.gen(function* () {
			const layer = makeTestLayer(htmlLayer)
			const exit = yield* runFailedInitialization(layer)
			expect(Exit.isFailure(exit)).toBe(true)
		})
	})

	it.effect('should fail on network error', ({ expect }) =>
		Effect.gen(function* () {
			const layer = makeTestLayer(mockHttpClientNetworkError())
			const exit = yield* Effect.exit(JWKSCache.pipe(Effect.provide(layer)))
			expect(Exit.isFailure(exit)).toBe(true)
		}),
	)
})

describe('JWKSCache - Timeout', () => {
	it.effect('should fail when fetch hangs past timeout', ({ expect }) =>
		Effect.gen(function* () {
			const layer = makeTestLayer(mockHttpClientHang())
			const exit = yield* runFailedInitialization(layer)
			expect(Exit.isFailure(exit)).toBe(true)
		}),
	)
})

describe('JWKSCache - Malformed Keys', () => {
	it.effect('should fail when JWK has unsupported key type', ({ expect }) =>
		Effect.gen(function* () {
			const jwks = {
				keys: [
					{
						kty: 'UNSUPPORTED',
						kid: 'bad-key',
						alg: 'RS256',
						use: 'sig',
					},
				],
			}

			const layer = makeTestLayer(mockHttpClientJson(jwks))
			const exit = yield* runFailedInitialization(layer)
			expect(Exit.isFailure(exit)).toBe(true)
		}),
	)

	it.effect('should succeed with empty keys array', ({ expect }) =>
		Effect.gen(function* () {
			const jwks = { keys: [] }

			const layer = makeTestLayer(mockHttpClientJson(jwks))
			const cache = yield* JWKSCache.pipe(Effect.provide(layer))

			const ready = yield* cache.isReady
			expect(ready).toBe(true)

			// But getKey should fail since there are no keys
			const exit = yield* Effect.exit(cache.getKey('any-kid'))
			expect(Exit.isFailure(exit)).toBe(true)
		}),
	)
})

describe('JWKSCache - Retry Behavior', () => {
	it.effect('should retry and succeed when fetch fails then succeeds', ({ expect }) =>
		Effect.gen(function* () {
			const testKid = 'retry-key'
			const jwks = yield* Effect.promise(() => generateTestJWKS(testKid))

			// Track attempt count with a plain mutable variable (outside Effect)
			let attemptCount = 0

			// Fail on first attempt (invalid schema), succeed on second
			const mockFetch: typeof globalThis.fetch = (async () => {
				attemptCount++
				if (attemptCount === 1) {
					return new Response(JSON.stringify({ error: 'not jwks' }), {
						status: 200,
						headers: { 'Content-Type': 'application/json' },
					})
				}
				return new Response(JSON.stringify(jwks), {
					status: 200,
					headers: { 'Content-Type': 'application/json' },
				})
			}) as unknown as typeof globalThis.fetch
			const flakyLayer = FetchHttpClient.layer.pipe(
				Layer.provide(Layer.succeed(FetchHttpClient.Fetch, mockFetch)),
			)

			const layer = makeTestLayer(flakyLayer, JWKSConfigWithRetry)

			const fiber = yield* JWKSCache.pipe(Effect.provide(layer), Effect.forkChild)
			yield* TestClock.adjust(Duration.millis(250))
			const cache = yield* Fiber.join(fiber)
			const key = yield* cache.getKey(testKid)
			expect(key).toBeDefined()
			expect(attemptCount).toBeGreaterThan(1)
		}),
	)

	it.effect('bounds background retry backoff to the refresh interval', ({ expect }) =>
		Effect.gen(function* () {
			const firstJwks = yield* Effect.promise(() => generateTestJWKS('initial-key'))
			const attemptTimes = yield* Ref.make<Array<number>>([])

			const client = HttpClient.make((request) =>
				Effect.gen(function* () {
					const now = yield* Clock.currentTimeMillis
					const attempts = yield* Ref.updateAndGet(attemptTimes, (times) => [...times, now])
					const body = attempts.length === 1 ? firstJwks : { error: 'not jwks' }

					return HttpClientResponse.fromWeb(
						request,
						new Response(JSON.stringify(body), {
							status: 200,
							headers: { 'Content-Type': 'application/json' },
						}),
					)
				}),
			)
			const layer = makeTestLayer(
				Layer.succeed(HttpClient.HttpClient, client),
				JWKSConfigShortRefreshWithManyRetries,
			)

			yield* Effect.gen(function* () {
				const cache = yield* JWKSCache
				yield* Effect.yieldNow
				expect(yield* cache.getKey('initial-key')).toBeDefined()
				expect(yield* Ref.get(attemptTimes)).toEqual([0, 0])
				yield* Effect.yieldNow
				expect(yield* Ref.get(attemptTimes)).toEqual([0, 0])

				yield* TestClock.adjust(Duration.millis(250))
				yield* Effect.yieldNow
				expect(yield* Ref.get(attemptTimes)).toEqual([0, 0, 250])

				yield* TestClock.adjust(Duration.millis(500))
				yield* Effect.yieldNow
				expect(yield* Ref.get(attemptTimes)).toEqual([0, 0, 250, 750])

				yield* TestClock.adjust(Duration.millis(250))
				yield* Effect.yieldNow
				expect(yield* Ref.get(attemptTimes)).toEqual([0, 0, 250, 750])

				yield* TestClock.adjust(Duration.millis(1_000))
				yield* Effect.yieldNow
				expect(yield* Ref.get(attemptTimes)).toEqual([0, 0, 250, 750, 1750])
			}).pipe(Effect.provide(layer))
		}),
	)
})

describe('JWKSCache - Runtime HTTP Client Composition', () => {
	it.effect('can initialize through the isolated JWKS HTTP client without proxy runtime config', ({ expect }) =>
		Effect.gen(function* () {
			const testKid = 'isolated-client-key'
			const jwks = yield* Effect.promise(() => generateTestJWKS(testKid))
			const server = yield* Effect.promise(() => startJwksServer(jwks))

			try {
				const config = Layer.succeed(JWKSConfig, {
					jwksUrl: `http://127.0.0.1:${server.port}/jwks`,
					keyFetchTimeoutMs: 10_000,
					refreshIntervalMs: 300_000,
				})
				const layer = JWKSCacheLive.pipe(
					Layer.provide(config),
					Layer.provide(
						JWKSHttpClientAsHttpClientLive.pipe(
							Layer.provide(config),
							Layer.provide(HttpPoolMetricsLive),
							Layer.provide(ConnectionMetricsLive),
						),
					),
				)
				const cache = yield* JWKSCache.pipe(Effect.provide(layer))

				expect(yield* cache.isReady).toBe(true)
				expect(yield* cache.getKey(testKid)).toBeDefined()
			} finally {
				server.stop()
			}
		}),
	)
})
