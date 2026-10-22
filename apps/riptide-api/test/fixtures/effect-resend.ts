import { ConfigProvider, Effect, Layer } from 'effect'
import * as HttpClient from 'effect/http/HttpClient'
import * as HttpClientError from 'effect/http/HttpClientError'
import type { HttpClientRequest } from 'effect/http/HttpClientRequest'
import * as HttpClientResponse from 'effect/http/HttpClientResponse'
import * as Schema from 'effect/Schema'

import { ResendConfigLive } from '../../src/effects/services/resend/resend-config.service'
import { ResendHttpClientLive } from '../../src/effects/services/resend/resend-http-client.layer'
import { ResendHttpClient } from '../../src/effects/services/resend/resend-http-client.service'
import { ResendServiceLive } from '../../src/effects/services/resend/resend-service-live'

export type ResendResponseSpec = {
	readonly status: number
	readonly bodyText: string
	readonly headers?: Readonly<Record<string, string>>
}

export const resendResponse = (
	body: unknown,
	options: { readonly status?: number; readonly headers?: Readonly<Record<string, string>> } = {},
): ResendResponseSpec => ({
	status: options.status ?? 200,
	bodyText: JSON.stringify(body),
	headers: options.headers,
})

export const resendTextResponse = (
	bodyText: string,
	options: { readonly status?: number; readonly headers?: Readonly<Record<string, string>> } = {},
): ResendResponseSpec => ({
	status: options.status ?? 200,
	bodyText,
	headers: options.headers,
})

export const resendTransportFailure = (message: string): ResendResponseSpec => ({
	status: 0,
	bodyText: message,
})

export function makeResendTestLayer(input: { readonly responses: readonly ResendResponseSpec[] }) {
	const requests: HttpClientRequest[] = []
	let responseIndex = 0
	const transport = Layer.succeed(
		HttpClient.HttpClient,
		HttpClient.make((request) => {
			requests.push(request)
			const spec = input.responses[responseIndex++]
			if (!spec) return Effect.die(`Unexpected Resend request: ${request.method} ${request.url}`)
			if (spec.status === 0) {
				return Effect.fail(
					new HttpClientError.HttpClientError({
						reason: new HttpClientError.TransportError({
							request,
							cause: new Error(spec.bodyText),
						}),
					}),
				)
			}
			return Effect.succeed(
				HttpClientResponse.fromWeb(
					request,
					new Response(spec.bodyText, {
						status: spec.status,
						headers: { 'content-type': 'application/json', ...spec.headers },
					}),
				),
			)
		}),
	)
	const config = ConfigProvider.layer(
		ConfigProvider.fromUnknown({
			RESEND_API_KEY: 're_test_key',
			RESEND_API_BASE_URL: 'https://resend.example.test',
			RESEND_FROM_EMAIL: 'sender@example.test',
			CLOUD_ORIGIN: 'https://cloud.example.test',
			APP_ORIGIN: 'https://app.example.test',
		}),
	)
	const resendConfigLayer = ResendConfigLive.pipe(Layer.provide(config))
	const httpLayer = ResendHttpClientLive.pipe(Layer.provide(Layer.mergeAll(transport, resendConfigLayer)))
	const layer = ResendServiceLive.pipe(Layer.provide(Layer.mergeAll(httpLayer, resendConfigLayer)))
	return {
		layer,
		httpLayer,
		requests,
		requestBody: (index: number): unknown => {
			const body = requests[index]?.body
			if (body?._tag !== 'Uint8Array') return undefined
			return Schema.decodeUnknownSync(Schema.Json)(JSON.parse(new TextDecoder().decode(body.body)))
		},
		resendHttpClient: ResendHttpClient,
	}
}
