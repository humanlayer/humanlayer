import { Effect } from 'effect'
import * as HttpClientRequest from 'effect/http/HttpClientRequest'

import { StripeHttpClient } from '../stripe-http-client.service'
import { decodeStripeSuccessResponse, stripeRequestIdFromResponse } from '../stripe-http-response-decoding'
import { StripeUnexpectedResponseError } from '../stripe.errors'
import { StripeCheckoutSessionSchema } from '../stripe.schema'
import { transformStripeCheckoutSessionToCheckoutSessionDetails } from './projection'

type CreateSubscriptionCheckoutSessionInput = {
	readonly checkoutAttemptId: string
	readonly customerId: string
	readonly organizationId: string
	readonly successUrl: string
	readonly cancelUrl: string
	readonly quantity: number
}

/** Creates a Stripe subscription checkout session with shared metadata, idempotency, and response decoding. */
export const createSubscriptionCheckoutSession = (input: {
	readonly checkout: CreateSubscriptionCheckoutSessionInput
	readonly priceId: string
	readonly idempotencyKeyPrefix: string
	readonly extraUrlParams?: Readonly<Record<string, string>>
	readonly spanName: string
}) =>
	Effect.gen(function* () {
		yield* Effect.annotateCurrentSpan({
			customer_id: input.checkout.customerId,
			organization_id: input.checkout.organizationId,
		})
		const stripeHttp = yield* StripeHttpClient
		const request = HttpClientRequest.post('/v1/checkout/sessions').pipe(
			HttpClientRequest.bodyUrlParams({
				customer: input.checkout.customerId,
				mode: 'subscription',
				'line_items[0][price]': input.priceId,
				'line_items[0][quantity]': String(input.checkout.quantity),
				allow_promotion_codes: 'true',
				success_url: input.checkout.successUrl,
				cancel_url: input.checkout.cancelUrl,
				'metadata[organizationId]': input.checkout.organizationId,
				'metadata[internal_org_id]': input.checkout.organizationId,
				'metadata[organization_id]': input.checkout.organizationId,
				...input.extraUrlParams,
			}),
			HttpClientRequest.setHeader(
				'Idempotency-Key',
				`${input.idempotencyKeyPrefix}:${input.checkout.organizationId}:${input.checkout.checkoutAttemptId}`,
			),
		)
		const response = yield* stripeHttp.execute(request)
		const session = transformStripeCheckoutSessionToCheckoutSessionDetails(
			yield* decodeStripeSuccessResponse(response, StripeCheckoutSessionSchema, 'checkout.session.create'),
		)
		if (!session.url) {
			const requestId = yield* stripeRequestIdFromResponse(response)
			return yield* Effect.fail(
				new StripeUnexpectedResponseError({
					status: response.status,
					requestId,
					reason: 'checkout_session_missing_url',
				}),
			)
		}
		return { url: session.url }
	}).pipe(Effect.withSpan(input.spanName))
