import { Effect } from 'effect'
import * as HttpClientRequest from 'effect/http/HttpClientRequest'

import { StripeHttpClient } from '../stripe-http-client.service'
import { decodeStripeSuccessResponse } from '../stripe-http-response-decoding'
import { StripeSubscriptionSchema } from '../stripe.schema'
import type { CancelSubscriptionInput } from '../stripe.types'

export const cancelSubscription = (input: CancelSubscriptionInput) =>
	Effect.gen(function* () {
		yield* Effect.annotateCurrentSpan({ subscription_id: input.subscriptionId })
		const stripeHttp = yield* StripeHttpClient
		const request = HttpClientRequest.delete(`/v1/subscriptions/${encodeURIComponent(input.subscriptionId)}`).pipe(
			HttpClientRequest.setHeader('Idempotency-Key', `cancel-subscription:${input.subscriptionId}`),
		)
		const response = yield* stripeHttp.execute(request)
		yield* decodeStripeSuccessResponse(response, StripeSubscriptionSchema, 'subscription.cancel')
	}).pipe(Effect.withSpan('stripe.cancel_subscription'))
