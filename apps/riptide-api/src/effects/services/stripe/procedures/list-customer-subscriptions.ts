import { Effect } from 'effect'
import * as HttpClientRequest from 'effect/http/HttpClientRequest'

import { StripeHttpClient } from '../stripe-http-client.service'
import { decodeStripeSuccessResponse, stripeRequestIdFromResponse } from '../stripe-http-response-decoding'
import { StripeUnexpectedResponseError } from '../stripe.errors'
import { StripeSubscriptionListSchema } from '../stripe.schema'
import type { ListCustomerSubscriptionsInput, SubscriptionDetails } from '../stripe.types'
import { transformStripeSubscriptionToSubscriptionDetails } from './projection'

export const listCustomerSubscriptions = (input: ListCustomerSubscriptionsInput) =>
	Effect.gen(function* () {
		yield* Effect.annotateCurrentSpan({ customer_id: input.customerId })
		const stripeHttp = yield* StripeHttpClient
		const subscriptions: SubscriptionDetails[] = []
		let startingAfter: string | undefined

		while (true) {
			let request = HttpClientRequest.get('/v1/subscriptions').pipe(
				HttpClientRequest.setUrlParams({
					customer: input.customerId,
					status: 'all',
					limit: '100',
					'expand[0]': 'data.default_payment_method',
				}),
			)
			if (startingAfter) {
				request = HttpClientRequest.setUrlParam(request, 'starting_after', startingAfter)
			}
			const response = yield* stripeHttp.execute(request)
			const page = yield* decodeStripeSuccessResponse(response, StripeSubscriptionListSchema, 'subscription.list')
			subscriptions.push(...page.data.map(transformStripeSubscriptionToSubscriptionDetails))
			if (!page.has_more) return subscriptions

			const lastSubscription = page.data.at(-1)
			if (!lastSubscription) {
				const requestId = yield* stripeRequestIdFromResponse(response)
				return yield* Effect.fail(
					new StripeUnexpectedResponseError({
						status: response.status,
						requestId,
						reason: 'subscription_list_has_more_without_data',
					}),
				)
			}

			startingAfter = lastSubscription.id
		}
	}).pipe(Effect.withSpan('stripe.list_customer_subscriptions'))
