import { describe, it } from '@effect/vitest'
import { Cause, Effect, Exit, Result } from 'effect'

import {
	StripeCheckoutSessionNotFoundError,
	StripeOperationError,
} from '../../src/effects/services/stripe/stripe.errors'
import { StripeService } from '../../src/effects/services/stripe/stripe.service'
import { TestBillingKvService } from '../fixtures/billing-kv-runtime'
import {
	checkoutSessionResponse,
	makeStripeTestLayer,
	stripeErrorResponse,
	stripeResponse,
	subscriptionResponse,
} from '../fixtures/effect-stripe'

describe('StripeService', () => {
	it.effect('StripeService should encode checkout creation and its idempotency key', ({ expect }) => {
		const fixture = makeStripeTestLayer({
			responses: [
				stripeResponse(checkoutSessionResponse({ id: 'cs_created', url: 'https://checkout.test/cs_created' })),
			],
		})
		return Effect.gen(function* () {
			const stripe = yield* StripeService
			const checkout = yield* stripe.createCheckoutSession({
				checkoutAttemptId: '00000000-0000-4000-8000-000000000001',
				customerId: 'cus_123',
				organizationId: 'org_123',
				successUrl: 'https://api.example.test/success',
				cancelUrl: 'https://app.example.test/cancel',
				quantity: 2,
				promoCode: 'promo_123',
			})

			expect(checkout).toEqual({ url: 'https://checkout.test/cs_created' })
			expect(fixture.requests).toHaveLength(1)
			expect(fixture.requests[0]?.headers['idempotency-key']).toBe(
				'checkout:org_123:00000000-0000-4000-8000-000000000001',
			)
			expect(fixture.requestBody(0)).toMatchObject({
				customer: 'cus_123',
				mode: 'subscription',
				'line_items[0][price]': 'price_pro',
				'line_items[0][quantity]': '2',
				'metadata[organizationId]': 'org_123',
				'discounts[0][promotion_code]': 'promo_123',
			})
		}).pipe(Effect.provide(fixture.layer))
	})

	it.effect('StripeService should paginate subscriptions and project provider fields', ({ expect }) => {
		const fixture = makeStripeTestLayer({
			responses: [
				stripeResponse({ object: 'list', has_more: true, data: [subscriptionResponse({ id: 'sub_first' })] }),
				stripeResponse({
					object: 'list',
					has_more: false,
					data: [subscriptionResponse({ id: 'sub_second', created: 2 })],
				}),
			],
		})
		return Effect.gen(function* () {
			const stripe = yield* StripeService
			const subscriptions = yield* stripe.listCustomerSubscriptions({ customerId: 'cus_123' })

			expect(subscriptions.map(({ id, customerId, priceIds }) => ({ id, customerId, priceIds }))).toEqual([
				{ id: 'sub_first', customerId: 'cus_123', priceIds: ['price_pro'] },
				{ id: 'sub_second', customerId: 'cus_123', priceIds: ['price_pro'] },
			])
			expect(fixture.requestParams(0)).not.toHaveProperty('starting_after')
			expect(fixture.requestParams(1)).toMatchObject({ starting_after: 'sub_first' })
		}).pipe(Effect.provide(fixture.layer))
	})

	it.effect('StripeService should classify a missing checkout session', ({ expect }) => {
		const fixture = makeStripeTestLayer({
			responses: [stripeErrorResponse(404, 'req_missing', 'resource_missing')],
		})
		return Effect.gen(function* () {
			const stripe = yield* StripeService
			const result = yield* Effect.result(stripe.retrieveCheckoutSession({ sessionId: 'cs_missing' }))

			expect(Result.isFailure(result)).toBe(true)
			if (Result.isFailure(result)) {
				expect(result.failure).toBeInstanceOf(StripeCheckoutSessionNotFoundError)
				if (result.failure instanceof StripeCheckoutSessionNotFoundError) {
					expect(result.failure.cause.requestId).toBe('req_missing')
				}
			}
		}).pipe(Effect.provide(fixture.layer))
	})

	it.effect('StripeService should reject malformed provider responses', ({ expect }) => {
		const fixture = makeStripeTestLayer({ responses: [stripeResponse({ id: 'cs_bad' })] })
		return Effect.gen(function* () {
			const stripe = yield* StripeService
			const result = yield* Effect.result(stripe.retrieveCheckoutSession({ sessionId: 'cs_bad' }))

			expect(Result.isFailure(result)).toBe(true)
			if (Result.isFailure(result)) {
				expect(result.failure).toBeInstanceOf(StripeOperationError)
				if (result.failure instanceof StripeOperationError) {
					expect(result.failure.cause._tag).toBe('StripeResponseDecodeError')
				}
			}
		}).pipe(Effect.provide(fixture.layer))
	})

	it.effect('StripeService should defect when Stripe omits the required request id', ({ expect }) => {
		const fixture = makeStripeTestLayer({
			responses: [stripeResponse(checkoutSessionResponse(), { requestId: null })],
		})
		return Effect.gen(function* () {
			const stripe = yield* StripeService
			const exit = yield* Effect.exit(stripe.retrieveCheckoutSession({ sessionId: 'cs_123' }))

			expect(exit._tag).toBe('Failure')
			if (Exit.isFailure(exit)) expect(Cause.hasDies(exit.cause)).toBe(true)
		}).pipe(Effect.provide(fixture.layer))
	})

	it.effect('StripeService should persist synchronized billing cache state', ({ expect }) => {
		const kv = new TestBillingKvService()
		const fixture = makeStripeTestLayer({
			kv,
			organizationId: 'org_123',
			responses: [
				stripeResponse({ object: 'list', has_more: false, data: [subscriptionResponse({ id: 'sub_123' })] }),
				stripeResponse({
					object: 'list',
					data: [
						{
							id: 'in_123',
							object: 'invoice',
							status: 'paid',
							customer: 'cus_123',
							subscription: 'sub_123',
						},
					],
				}),
			],
		})
		return Effect.gen(function* () {
			const stripe = yield* StripeService
			const cache = yield* stripe.syncCustomerBillingToKv({ customerId: 'cus_123' })
			const persisted = yield* Effect.promise(() => kv.getSubscriptionCache('cus_123'))

			expect(cache).toMatchObject({ organizationId: 'org_123', subscriptionId: 'sub_123', hasPaidInvoice: true })
			expect(persisted).toMatchObject({
				organizationId: 'org_123',
				subscriptionId: 'sub_123',
				hasPaidInvoice: true,
			})
		}).pipe(Effect.provide(fixture.layer))
	})
})
