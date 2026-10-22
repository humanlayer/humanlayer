import { Context, Effect } from 'effect'
import type { HttpClientRequest as StripeHttpClientRequest } from 'effect/http/HttpClientRequest'
import type { HttpClientResponse } from 'effect/http/HttpClientResponse'

import type { StripeTransportError } from './stripe.errors'

export type StripeHttpClientShape = {
	readonly execute: (request: StripeHttpClientRequest) => Effect.Effect<HttpClientResponse, StripeTransportError>
}

/** Authenticated Stripe HTTP transport used by Stripe API procedures. */
export class StripeHttpClient extends Context.Service<StripeHttpClient, StripeHttpClientShape>()('StripeHttpClient') {}
