import { Context, Effect, Layer } from 'effect'
import type { HttpClient } from 'effect/http'

import { makePooledHttpClient } from './pooled-http-client'
import { ProxyRuntimeConfig } from './proxy-runtime-config.service'
import { proxyPoolOptions } from './undici-pool-options'

export class ElectricProxyHttpClient extends Context.Service<ElectricProxyHttpClient, HttpClient.HttpClient>()(
	'ElectricProxyHttpClient',
) {}

export const ElectricProxyHttpClientLive = Layer.effect(
	ElectricProxyHttpClient,
	Effect.gen(function* () {
		const config = yield* ProxyRuntimeConfig
		return yield* makePooledHttpClient({
			upstream: 'electric',
			origin: config.electricOrigin,
			poolOptions: proxyPoolOptions,
		})
	}),
)
