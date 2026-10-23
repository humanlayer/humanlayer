import { Config, Effect, Layer } from 'effect'
import * as HttpClient from 'effect/http/HttpClient'
import * as HttpClientRequest from 'effect/http/HttpClientRequest'

import { StripeHttpClient } from './stripe-http-client.service'
import { stripeRequestIdFromResponse } from './stripe-http-response-decoding'
import { StripeTransportError } from './stripe.errors'

/** Implements authenticated Stripe requests over Effect's HTTP client. */
export const StripeHttpClientLive = Layer.effect(
	StripeHttpClient,
	Effect.gen(function* () {
		const stripeSecretKey = yield* Config.Redacted('STRIPE_SECRET_KEY')
		const stripeApiBaseUrl = yield* Config.String('STRIPE_API_BASE_URL').pipe(
			Config.withDefault('https://api.stripe.com'),
		)
		const httpClient = yield* HttpClient.HttpClient

		return {
			execute: (request) => {
				const path = stripeRequestPathForTelemetry(request.url)
				const attributes = { method: request.method, path }
				const authedRequest = request.pipe(
					HttpClientRequest.prependUrl(stripeApiBaseUrl),
					HttpClientRequest.bearerToken(stripeSecretKey),
				)

				return httpClient.execute(authedRequest).pipe(
					Effect.tap((response) =>
						stripeRequestIdFromResponse(response).pipe(
							Effect.flatMap((requestId) =>
								Effect.logInfo('Stripe HTTP response').pipe(
									Effect.annotateLogs({
										...attributes,
										status: response.status,
										request_id: requestId,
									}),
								),
							),
						),
					),
					Effect.catchReason(
						'HttpClientError',
						'TransportError',
						(_reason, cause) =>
							Effect.fail(new StripeTransportError({ ...attributes, retryable: true, cause })),
						(_reasons, cause) =>
							Effect.fail(new StripeTransportError({ ...attributes, retryable: false, cause })),
					),
					Effect.withSpan('stripe.http_request', { attributes }),
				)
			},
		}
	}),
)

/** Removes query and fragment values so telemetry records stable paths without leaking request parameters. */
const stripeRequestPathForTelemetry = (url: string): string => {
	const parsed = URL.canParse(url, 'https://stripe.local') ? new URL(url, 'https://stripe.local') : null
	return parsed ? parsed.pathname : (url.split(/[?#]/, 1)[0] ?? '')
}
