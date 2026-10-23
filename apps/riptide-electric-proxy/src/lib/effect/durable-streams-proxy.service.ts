import { Context, Effect, Layer } from 'effect'
import { HttpClientRequest } from 'effect/http'

import { logger } from '../logger'
import type { proxyToStream } from '../proxy-stream'
import { ConnectionMetrics } from './connection-metrics.service'
import { DurableStreamsHttpClient } from './durable-streams-http-client.service'
import { toWebResponse } from './http-client-response'
import { copyProxyRequestHeaders } from './proxy-headers'

export type DurableStreamsIncomingRequest = Parameters<typeof proxyToStream>[1]

export class DurableStreamsProxy extends Context.Service<
	DurableStreamsProxy,
	{
		readonly proxyStreamRequest: (
			url: URL,
			incomingRequest: DurableStreamsIncomingRequest,
		) => Effect.Effect<Response>
	}
>()('DurableStreamsProxy') {}

function makeBadGatewayResponse() {
	return new Response(JSON.stringify({ error: 'Unable to connect to Durable Streams server' }), {
		status: 502,
		statusText: 'Bad Gateway',
		headers: { 'Content-Type': 'application/json' },
	})
}

function headersToRecord(headers: Headers) {
	const record: Record<string, string> = {}
	for (const [key, value] of headers) record[key] = value
	return record
}

function buildHeaders(incomingRequest: DurableStreamsIncomingRequest) {
	const headers = copyProxyRequestHeaders(incomingRequest.raw.headers)
	const contentType = incomingRequest.header('Content-Type')
	if (contentType) headers.set('Content-Type', contentType)
	return headers
}

function buildDurableStreamsRequest(
	url: URL,
	incomingRequest: DurableStreamsIncomingRequest,
	body: Uint8Array | undefined,
) {
	const headers = buildHeaders(incomingRequest)
	let request = HttpClientRequest.make(incomingRequest.method as never)(url.toString(), {
		headers: headersToRecord(headers),
	} as never)

	if (!body) return request

	request = request.pipe(HttpClientRequest.bodyUint8Array(body, headers.get('Content-Type') ?? undefined))
	return request
}

export const DurableStreamsProxyLive = Layer.effect(
	DurableStreamsProxy,
	Effect.gen(function* () {
		const metrics = yield* ConnectionMetrics
		const httpClient = yield* DurableStreamsHttpClient

		return DurableStreamsProxy.of({
			proxyStreamRequest: (url, incomingRequest) =>
				metrics.withDurableStreamConnection(
					Effect.gen(function* () {
						const hasBody = !['GET', 'HEAD'].includes(incomingRequest.method) && incomingRequest.raw.body
						const body = hasBody
							? yield* Effect.promise(() =>
									incomingRequest.raw.arrayBuffer().then((value) => new Uint8Array(value)),
								)
							: undefined
						const request = buildDurableStreamsRequest(url, incomingRequest, body)
						const response = yield* httpClient.execute(request)
						return yield* toWebResponse(response)
					}).pipe(
						Effect.catch((cause) =>
							Effect.sync(() => logger.error('Durable Streams upstream request failed', { cause })).pipe(
								Effect.as(makeBadGatewayResponse()),
							),
						),
					),
				),
		})
	}),
)
