import { Context, Effect, Layer } from 'effect'
import type { HttpClient } from 'effect/http'

import { makePooledHttpClient } from './pooled-http-client'
import { ProxyRuntimeConfig } from './proxy-runtime-config.service'
import { proxyPoolOptions } from './undici-pool-options'

export class DurableStreamsHttpClient extends Context.Service<DurableStreamsHttpClient, HttpClient.HttpClient>()(
	'DurableStreamsHttpClient',
) {}

export const DurableStreamsHttpClientLive = Layer.effect(
	DurableStreamsHttpClient,
	Effect.gen(function* () {
		const config = yield* ProxyRuntimeConfig
		return yield* makePooledHttpClient({
			upstream: 'durable_stream',
			origin: config.durableStreamsOrigin,
			poolOptions: proxyPoolOptions,
		})
	}),
)
