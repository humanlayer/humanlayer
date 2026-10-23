import { Effect, Layer } from 'effect'
import * as HttpClient from 'effect/http/HttpClient'
import * as HttpClientRequest from 'effect/http/HttpClientRequest'

import { ResendConfig } from './resend-config.service'
import { ResendTransportError } from './resend-errors'
import { ResendHttpClient } from './resend-http-client.service'

/** Implements authenticated Resend requests over Effect's HTTP client. */
export const ResendHttpClientLive = Layer.effect(
	ResendHttpClient,
	Effect.gen(function* () {
		const config = yield* ResendConfig
		const httpClient = yield* HttpClient.HttpClient

		return {
			execute: (request) => {
				const path = resendRequestPathForTelemetry(request.url)
				const attributes = { method: request.method, path_template: path }
				const authedRequest = request.pipe(
					HttpClientRequest.prependUrl(config.apiBaseUrl),
					HttpClientRequest.bearerToken(config.apiKey),
					HttpClientRequest.acceptJson,
				)

				return httpClient.execute(authedRequest).pipe(
					Effect.tap((response) =>
						Effect.logInfo('Resend HTTP response').pipe(
							Effect.annotateLogs({ ...attributes, status: response.status }),
						),
					),
					Effect.catchReason(
						'HttpClientError',
						'TransportError',
						(reason) =>
							Effect.fail(
								new ResendTransportError({
									...attributes,
									status: null,
									providerErrorName: null,
									message: reason.description ?? 'Resend transport request failed',
									retryable: true,
									cause: reason.cause ?? new Error('Resend transport request failed without a cause'),
								}),
							),
						(_reasons, error) =>
							Effect.fail(
								new ResendTransportError({
									...attributes,
									status: null,
									providerErrorName: null,
									message: error.reason.description ?? 'Resend HTTP request failed',
									retryable: false,
									cause:
										error.reason.cause ?? new Error('Resend HTTP request failed without a cause'),
								}),
							),
					),
					Effect.withSpan('resend.http_request', { attributes }),
				)
			},
		}
	}),
)

/** Removes query data and replaces provider identifiers before telemetry sees request paths. */
const resendRequestPathForTelemetry = (url: string): string => {
	const parsed = URL.canParse(url, 'https://resend.local') ? new URL(url, 'https://resend.local') : null
	const path = parsed ? parsed.pathname : (url.split(/[?#]/, 1)[0] ?? '')
	if (/^\/contacts\/[^/]+$/.test(path)) return '/contacts/{identifier}'
	if (/^\/emails\/[^/]+\/cancel$/.test(path)) return '/emails/{id}/cancel'
	return path
}
