import { describe, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'

import { JWKSConfig, JWKSConfigLive } from '../../src/auth/effect/jwks-cache-config.service'
import { WorkosConfig } from '../../src/auth/effect/workos.service'

describe('JWKSConfig', () => {
	// Create a test layer for WorkosConfig (JWKSConfig's dependency)
	const WorkosConfigTest = Layer.succeed(WorkosConfig, {
		workosClientId: 'test_client_id',
		workosRedirectUri: 'http://test.local/callback',
		workos: {} as any,
		jwksUrl: 'https://api.workos.com/sso/jwks/test_client_id',
	})

	// Compose: JWKSConfigLive needs WorkosConfig, we provide WorkosConfigTest
	const TestLayer = JWKSConfigLive.pipe(Layer.provide(WorkosConfigTest))

	it.effect('should build successfully when WorkosConfig is provided', ({ expect }) =>
		Effect.gen(function* () {
			const config = yield* JWKSConfig

			expect(config.jwksUrl).toBe('https://api.workos.com/sso/jwks/test_client_id')
			expect(config.keyFetchTimeoutMs).toBe(10_000)
			expect(config.refreshIntervalMs).toBe(300_000) // 5 minutes
		}).pipe(Effect.provide(TestLayer)),
	)

	it.effect('should use jwksUrl from WorkosConfig', ({ expect }) =>
		Effect.gen(function* () {
			// Create a different WorkosConfig to verify JWKSConfig uses it
			const CustomWorkosConfig = Layer.succeed(WorkosConfig, {
				workosClientId: 'custom_client',
				workosRedirectUri: 'http://custom.local/callback',
				workos: {} as any,
				jwksUrl: 'https://custom.workos.com/jwks',
			})

			const config = yield* JWKSConfig.pipe(Effect.provide(JWKSConfigLive), Effect.provide(CustomWorkosConfig))

			expect(config.jwksUrl).toBe('https://custom.workos.com/jwks')
		}),
	)
})

describe('JWKSConfig - Direct Test Layer', () => {
	// When testing services that depend on JWKSConfig,
	// you can skip WorkosConfig entirely with a direct test layer

	const JWKSConfigTest = Layer.succeed(JWKSConfig, {
		jwksUrl: 'http://localhost:9999/mock-jwks',
		keyFetchTimeoutMs: 100, // Fast for tests
		refreshIntervalMs: 1_000,
	})

	it.effect('can provide JWKSConfig directly without WorkosConfig', ({ expect }) =>
		Effect.gen(function* () {
			const config = yield* JWKSConfig

			expect(config.jwksUrl).toBe('http://localhost:9999/mock-jwks')
			expect(config.keyFetchTimeoutMs).toBe(100)
			expect(config.refreshIntervalMs).toBe(1_000)
		}).pipe(Effect.provide(JWKSConfigTest)),
	)
})
