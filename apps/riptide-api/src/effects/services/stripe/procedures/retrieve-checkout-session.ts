import { Effect } from 'effect'
import * as HttpClientRequest from 'effect/http/HttpClientRequest'

import { StripeHttpClient } from '../stripe-http-client.service'
import { decodeStripeSuccessResponse } from '../stripe-http-response-decoding'
import { StripeCheckoutSessionSchema } from '../stripe.schema'
import type { RetrieveCheckoutSessionInput } from '../stripe.types'
import { transformStripeCheckoutSessionToCheckoutSessionDetails } from './projection'

export const retrieveCheckoutSession = (input: RetrieveCheckoutSessionInput) =>
	Effect.gen(function* () {
		yield* Effect.annotateCurrentSpan({ checkout_session_id: input.sessionId })
		const stripeHttp = yield* StripeHttpClient
		const response = yield* stripeHttp.execute(
			HttpClientRequest.get(`/v1/checkout/sessions/${encodeURIComponent(input.sessionId)}`),
		)
		const session = yield* decodeStripeSuccessResponse(response, StripeCheckoutSessionSchema, 'checkout.session')
		yield* Effect.logInfo('Stripe checkout session retrieved').pipe(
			Effect.annotateLogs({ checkout_session_id: input.sessionId, status: session.status }),
		)
		return transformStripeCheckoutSessionToCheckoutSessionDetails(session)
	}).pipe(Effect.withSpan('stripe.retrieve_checkout_session'))
