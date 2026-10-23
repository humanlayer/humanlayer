import { YjsGateway, YjsGatewayLive, YjsStorageConfig } from '@humanlayer/y-durable-streams/server'
import { Effect, Layer } from 'effect'
import { HttpClient } from 'effect/http'

import { DurableStreamsHttpClient } from './durable-streams-http-client.service'
import { ProxyRuntimeConfig } from './proxy-runtime-config.service'

export { YjsGateway }

export const ResponseEditorGatewayLive = YjsGatewayLive.pipe(
	Layer.provide(
		Layer.mergeAll(
			Layer.effect(HttpClient.HttpClient, DurableStreamsHttpClient),
			Layer.effect(
				YjsStorageConfig,
				ProxyRuntimeConfig.pipe(Effect.map((config) => ({ baseUrl: config.durableStreamsBaseUrl }))),
			),
		),
	),
)
