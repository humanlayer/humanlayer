import { Effect } from 'effect'

import type { AppRuntime } from '@/lib/effect/runtime'
import { logger } from '@/lib/logger'

import { JWTValidator } from './effect/jwt-validator.service'

export function createJWTValidator(runtime: AppRuntime) {
	return async (token: string) =>
		runtime.runPromise(
			Effect.gen(function* () {
				const validator = yield* JWTValidator
				return yield* validator.validateJWT(token)
			}).pipe(
				Effect.catch((error) =>
					Effect.sync(() => {
						logger.error({ error: { _tag: error._tag } }, 'JWT validation failed')
						return null
					}),
				),
			),
		)
}
