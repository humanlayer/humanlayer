import { STREAM_CONFIG } from '@humanlayer/streams/config'
import { Config, Context, Effect, Layer } from 'effect'

/**
 * This service provides the configuration for the durable streams server
 */
export class DurableStreamsConfig extends Context.Service<
	DurableStreamsConfig,
	{
		readonly origin: string
		readonly contentType: string
		readonly ttlSeconds: number
		readonly streamUrl: (sessionId: string) => string
	}
>()('DurableStreamsConfig') {}

export const DurableStreamsConfigLive = Layer.effect(
	DurableStreamsConfig,
	Effect.gen(function* () {
		const origin = (yield* Config.String('DURABLE_STREAMS_ORIGIN')).replace(/\/+$/, '')

		return {
			origin,
			contentType: STREAM_CONFIG.contentType,
			ttlSeconds: STREAM_CONFIG.ttlSeconds,
			streamUrl: (sessionId: string) => `${origin}/v1/stream/sessions/${sessionId}`,
		}
	}),
)
