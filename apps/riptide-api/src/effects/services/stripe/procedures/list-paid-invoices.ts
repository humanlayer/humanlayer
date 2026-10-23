import { Effect } from 'effect'
import * as HttpClientRequest from 'effect/http/HttpClientRequest'

import { StripeHttpClient } from '../stripe-http-client.service'
import { decodeStripeSuccessResponse } from '../stripe-http-response-decoding'
import { StripeInvoiceListSchema } from '../stripe.schema'
import type { ListPaidInvoicesInput } from '../stripe.types'
import { transformStripePaidInvoiceToPaidInvoiceDetails } from './projection'

export const listPaidInvoices = (input: ListPaidInvoicesInput) =>
	Effect.gen(function* () {
		yield* Effect.annotateCurrentSpan({ customer_id: input.customerId, subscription_id: input.subscriptionId })
		const stripeHttp = yield* StripeHttpClient
		let request = HttpClientRequest.get('/v1/invoices').pipe(
			HttpClientRequest.setUrlParams({
				customer: input.customerId,
				status: 'paid',
				limit: '1',
			}),
		)
		if (input.subscriptionId) {
			request = HttpClientRequest.setUrlParam(request, 'subscription', input.subscriptionId)
		}
		const response = yield* stripeHttp.execute(request)
		const list = yield* decodeStripeSuccessResponse(response, StripeInvoiceListSchema, 'invoice.list')
		return list.data.map(transformStripePaidInvoiceToPaidInvoiceDetails)
	}).pipe(Effect.withSpan('stripe.list_paid_invoices'))
