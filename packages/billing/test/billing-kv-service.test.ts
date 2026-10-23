import { describe, it } from '@effect/vitest'
import { Effect, Layer, Ref } from 'effect'
import { expect } from 'vitest'

import { BillingKvCacheDecodeError } from '../src/billing-kv/billing-kv.errors'
import { BillingKvService, BillingKvServiceLive } from '../src/billing-kv/billing-kv.service'
import { stripeBillingKeys } from '../src/keys'
import { RecordingRedisControl, RecordingRedisTestLive } from './fixtures/recording-redis'

const BillingKvTestLive = BillingKvServiceLive.pipe(Layer.provideMerge(RecordingRedisTestLive))

describe('BillingKvService', () => {
	it.effect('preserves exact mapping keys, directions, misses, and values', () =>
		Effect.gen(function* () {
			const billingKv = yield* BillingKvService
			const control = yield* RecordingRedisControl

			expect(yield* billingKv.getOrgCustomerId({ organizationId: 'org_missing' })).toBeNull()
			yield* billingKv.setOrgCustomerId({ organizationId: 'org_123', customerId: 'cus_123' })
			yield* billingKv.setCustomerOrgId({ customerId: 'cus_123', organizationId: 'org_123' })
			expect(yield* billingKv.getOrgCustomerId({ organizationId: 'org_123' })).toBe('cus_123')
			expect(yield* billingKv.getCustomerOrgId({ customerId: 'cus_123' })).toBe('org_123')

			expect(yield* Ref.get(control.commands)).toEqual([
				{ command: 'GET', args: ['stripe:org:org_missing'] },
				{ command: 'SET', args: ['stripe:org:org_123', 'cus_123'] },
				{ command: 'SET', args: ['stripe:customer:cus_123:org', 'org_123'] },
				{ command: 'GET', args: ['stripe:org:org_123'] },
				{ command: 'GET', args: ['stripe:customer:cus_123:org'] },
			])
		}).pipe(Effect.provide(BillingKvTestLive)),
	)

	it.effect('normalizes unknown legacy status to none and defaults missing payment method', () =>
		Effect.gen(function* () {
			const billingKv = yield* BillingKvService
			const control = yield* RecordingRedisControl
			const customerId = 'cus_legacy'
			control.values.set(
				stripeBillingKeys.customerCache(customerId),
				JSON.stringify({
					customerId,
					organizationId: 'org_legacy',
					subscriptionId: 'sub_legacy',
					status: 'provider_added_status',
					priceId: 'price_legacy',
					currentPeriodEnd: 123,
					hasPaidInvoice: true,
					pastDueAt: null,
					syncedAt: 456,
					extensionField: 'ignored',
				}),
			)

			expect(yield* billingKv.getSubscriptionCache({ customerId })).toEqual({
				customerId,
				organizationId: 'org_legacy',
				subscriptionId: 'sub_legacy',
				status: 'none',
				priceId: 'price_legacy',
				currentPeriodEnd: 123,
				hasPaidInvoice: true,
				hasPaymentMethod: false,
				pastDueAt: null,
				syncedAt: 456,
			})
		}).pipe(Effect.provide(BillingKvTestLive)),
	)

	it.effect('separates malformed JSON and invalid record shapes from cache misses', () =>
		Effect.gen(function* () {
			const billingKv = yield* BillingKvService
			const control = yield* RecordingRedisControl
			expect(yield* billingKv.getSubscriptionCache({ customerId: 'cus_missing' })).toBeNull()

			for (const [customerId, serialized] of [
				['cus_json', '{not-json'],
				['cus_shape', JSON.stringify({ customerId: 'cus_shape' })],
			] as const) {
				control.values.set(stripeBillingKeys.customerCache(customerId), serialized)
				const error = yield* billingKv
					.getSubscriptionCache({ customerId })
					.pipe(Effect.catchTag('BillingKvUnavailableError', Effect.die), Effect.flip)
				expect(error).toBeInstanceOf(BillingKvCacheDecodeError)
				expect(error.key).toBe(stripeBillingKeys.customerCache(customerId))
			}
		}).pipe(Effect.provide(BillingKvTestLive)),
	)

	it.effect('writes only the canonical subscription cache fields', () =>
		Effect.gen(function* () {
			const billingKv = yield* BillingKvService
			const control = yield* RecordingRedisControl
			const customerId = 'cus_canonical'
			yield* billingKv.setSubscriptionCache({
				customerId,
				cache: {
					customerId,
					organizationId: 'org_canonical',
					subscriptionId: 'sub_canonical',
					status: 'active',
					priceId: 'price_canonical',
					currentPeriodEnd: 123,
					hasPaidInvoice: true,
					hasPaymentMethod: true,
					pastDueAt: null,
					syncedAt: 456,
				},
			})

			const stored = control.values.get(stripeBillingKeys.customerCache(customerId))
			expect(stored).toBe(
				JSON.stringify({
					customerId,
					organizationId: 'org_canonical',
					subscriptionId: 'sub_canonical',
					status: 'active',
					priceId: 'price_canonical',
					currentPeriodEnd: 123,
					hasPaidInvoice: true,
					hasPaymentMethod: true,
					pastDueAt: null,
					syncedAt: 456,
				}),
			)
			expect(yield* billingKv.getSubscriptionCache({ customerId })).toMatchObject({
				customerId,
				status: 'active',
			})
		}).pipe(Effect.provide(BillingKvTestLive)),
	)
})
