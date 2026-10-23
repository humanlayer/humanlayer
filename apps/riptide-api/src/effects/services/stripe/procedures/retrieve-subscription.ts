import { Effect } from 'effect'
import * as HttpClientRequest from 'effect/http/HttpClientRequest'

import { StripeHttpClient } from '../stripe-http-client.service'
import { decodeStripeSuccessResponse } from '../stripe-http-response-decoding'
import { StripeSubscriptionSchema } from '../stripe.schema'
import type { RetrieveSubscriptionInput } from '../stripe.types'
import { transformStripeSubscriptionToSubscriptionDetails } from './projection'

export const retrieveSubscription = (input: RetrieveSubscriptionInput) =>
	Effect.gen(function* () {
		yield* Effect.annotateCurrentSpan({ subscription_id: input.subscriptionId })
		const stripeHttp = yield* StripeHttpClient
		const response = yield* stripeHttp.execute(
			HttpClientRequest.get(`/v1/subscriptions/${encodeURIComponent(input.subscriptionId)}`),
		)
		const subscription = yield* decodeStripeSuccessResponse(response, StripeSubscriptionSchema, 'subscription')
		return transformStripeSubscriptionToSubscriptionDetails(subscription)
	}).pipe(Effect.withSpan('stripe.retrieve_subscription'))
