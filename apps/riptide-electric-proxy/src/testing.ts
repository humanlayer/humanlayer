/**
 * Test-only helpers, exported as `@humanlayer/riptide-electric-proxy/testing`.
 * Not imported by production code (the build entry is `src/index.ts`).
 */
import { Effect, Layer } from 'effect'

import { JWTVerificationError } from './auth/effect/errors'
import { JWTValidator } from './auth/effect/jwt-validator.service'
import { makeProxyRuntimeConfig } from './lib/effect/proxy-runtime-config.service'
import { type AppRuntime, createAppRuntime, makeAppLayer } from './lib/effect/runtime'

export type { AppRuntime } from './lib/effect/runtime'

/**
 * Build an AppRuntime for tests that authenticate via `testAuthContext`.
 * JWT validation fails closed so any request that accidentally reaches the
 * real auth path is rejected instead of silently passing.
 *
 * Callers must `await runtime.dispose()` (or `void runtime.dispose()`) when
 * stopping the server to release pollers and metrics resources.
 */
export function createTestAppRuntime(options: { electricShapeUrl: string; durableStreamsOrigin: string }): AppRuntime {
	return createAppRuntime(
		makeAppLayer({
			proxyRuntimeConfig: makeProxyRuntimeConfig(options),
			authLayer: Layer.succeed(JWTValidator, {
				validateJWT: () =>
					Effect.fail(new JWTVerificationError({ cause: 'JWT validation is not configured in tests' })),
			}),
		}),
	)
}
