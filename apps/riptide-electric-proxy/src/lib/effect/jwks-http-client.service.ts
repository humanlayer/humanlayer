import { Context, Effect, Layer } from 'effect'
import { HttpClient } from 'effect/http'

import { JWKSConfig } from '@/auth/effect/jwks-cache-config.service'

import { makePooledHttpClient } from './pooled-http-client'
import { jwksPoolOptions } from './undici-pool-options'

export class JWKSHttpClient extends Context.Service<JWKSHttpClient, HttpClient.HttpClient>()('JWKSHttpClient') {}

export const JWKSHttpClientLive = Layer.effect(
	JWKSHttpClient,
	Effect.gen(function* () {
		const config = yield* JWKSConfig
		const jwksOrigin = new URL(config.jwksUrl).origin
		return yield* makePooledHttpClient({
			upstream: 'jwks',
			origin: jwksOrigin,
			poolOptions: jwksPoolOptions,
		})
	}),
)

export const JWKSHttpClientAsHttpClientLive = Layer.effect(HttpClient.HttpClient, JWKSHttpClient).pipe(
	Layer.provide(JWKSHttpClientLive),
)
