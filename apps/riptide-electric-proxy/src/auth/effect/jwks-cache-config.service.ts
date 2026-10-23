import { Context, Effect, Layer } from 'effect'

import { WorkosConfig } from '@/auth/effect/workos.service'

/**
 * This is the config service that will be injected into the JWKS Cache Effect
 * The service defines the interface of the dependency, a layer will define the implementation
 *
 * This ensures we can provide a test layer which matches the service's interface but has its own logic
 *
 * https://effect.website/docs/requirements-management/services/
 *
 * Services define the interface (for DI)
 *
 */
export class JWKSConfig extends Context.Service<
	JWKSConfig,
	{
		readonly jwksUrl: string
		readonly keyFetchTimeoutMs: number
		readonly refreshIntervalMs: number
	}
>()('JWKSConfig') {}

/**
 * This is a builder for the JWKS Config live layer
 *
 * It creates a layer but must be provided with a workos service
 *
 */
export const JWKSConfigLive = Layer.effect(
	JWKSConfig,
	Effect.gen(function* () {
		const workosConfig = yield* WorkosConfig

		return {
			jwksUrl: workosConfig.jwksUrl,
			keyFetchTimeoutMs: 10_000,
			refreshIntervalMs: 300_000, // 5 minutes
		}
	}),
)
