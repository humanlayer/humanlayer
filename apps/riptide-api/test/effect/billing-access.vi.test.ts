import { describe, it } from '@effect/vitest'
import { BillingKvCacheDecodeError, BillingKvUnavailableError } from '@humanlayer/billing/billing-kv'
import { RedisCommandError, RedisService } from '@humanlayer/billing/redis'
import type { STRIPE_SUB_CACHE } from '@humanlayer/billing/types'
import type { PgDatabase } from 'drizzle-orm/pg-core'
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js'
import { Effect, Layer } from 'effect'
import { expect } from 'vitest'

import { BillingAccessLive } from '../../src/effects/services/billing/billing-access-service-live'
import { decideBillingAccess } from '../../src/effects/services/billing/billing-access.service'
import { PostgresDbLive } from '../../src/effects/services/postgres/postgres-db.service'
import { StripeHttpClient } from '../../src/effects/services/stripe/stripe-http-client.service'
import { StripeBillingSyncError } from '../../src/effects/services/stripe/stripe.errors'
import { billingKvLayerFromTestService, TestBillingKvService } from '../fixtures/billing-kv-runtime'
import { createBillingLifecycleFixture } from '../fixtures/billing-lifecycle'
import { strictStripeEffectLayer } from '../fixtures/strict-stripe-effect.fixture'

const organizationId = 'org_billing_access'
const customerId = 'cus_billing_access'

function cache(overrides?: Partial<STRIPE_SUB_CACHE>): STRIPE_SUB_CACHE {
	return {
		customerId,
		organizationId,
		subscriptionId: 'sub_billing_access',
		status: 'active',
		priceId: 'price_pro',
		currentPeriodEnd: 123,
		hasPaidInvoice: false,
		hasPaymentMethod: true,
		pastDueAt: null,
		syncedAt: Date.now(),
		...overrides,
	}
}

function billingAccessLayerFor(input: {
	kv: TestBillingKvService
	syncCustomerBillingToKv?: () => Effect.Effect<STRIPE_SUB_CACHE, StripeBillingSyncError>
}) {
	return BillingAccessLive.pipe(
		Layer.provide(
			Layer.mergeAll(
				billingKvLayerFromTestService(input.kv),
				strictStripeEffectLayer(
					input.syncCustomerBillingToKv ? { syncCustomerBillingToKv: input.syncCustomerBillingToKv } : {},
				),
				Layer.succeed(RedisService, { send: () => Effect.die('Redis is not used by this test') }),
				Layer.succeed(StripeHttpClient, { execute: () => Effect.die('Stripe HTTP is not used by this test') }),
				PostgresDbLive({} as PgDatabase<PostgresJsQueryResultHKT>),
			),
		),
	)
}

const decideFor = (input: {
	kv: TestBillingKvService
	syncCustomerBillingToKv?: () => Effect.Effect<STRIPE_SUB_CACHE, StripeBillingSyncError>
}) =>
	decideBillingAccess({ organizationId, operation: 'sessions.launch' }).pipe(
		Effect.provide(billingAccessLayerFor(input)),
	)

describe('BillingAccess', () => {
	it.effect('blocks when organization has no customer mapping', () =>
		Effect.gen(function* () {
			const decision = yield* decideFor({ kv: new TestBillingKvService() })

			expect(decision).toBe('blocked')
		}),
	)

	it.effect('allows active and trialing subscription cache states', () =>
		Effect.gen(function* () {
			for (const status of ['active', 'trialing'] as const) {
				const fixture = yield* Effect.promise(() =>
					createBillingLifecycleFixture({ organizationId, customerId }),
				)
				yield* Effect.promise(() => fixture.seedCache(cache({ status })))

				const decision = yield* decideFor({ kv: fixture.kv })

				expect(decision).toBe('allowed')
			}
		}),
	)

	it.effect('blocks known non-good-standing cache states', () =>
		Effect.gen(function* () {
			for (const status of ['none', 'past_due', 'unpaid', 'canceled', 'paused', 'incomplete'] as const) {
				const fixture = yield* Effect.promise(() =>
					createBillingLifecycleFixture({ organizationId, customerId }),
				)
				yield* Effect.promise(() =>
					fixture.seedCache(
						cache({ status, subscriptionId: status === 'none' ? null : 'sub_billing_access' }),
					),
				)

				const decision = yield* decideFor({ kv: fixture.kv })

				expect(decision).toBe('blocked')
			}
		}),
	)

	it.effect('refreshes missing subscription cache before deciding', () =>
		Effect.gen(function* () {
			const kv = new TestBillingKvService()
			yield* Effect.promise(() => kv.setOrgCustomerId(organizationId, customerId))
			let syncCalled = false

			const decision = yield* decideFor({
				kv,
				syncCustomerBillingToKv: () => {
					syncCalled = true
					return Effect.succeed(cache({ status: 'trialing' }))
				},
			})

			expect(decision).toBe('allowed')
			expect(syncCalled).toBe(true)
		}),
	)

	it.effect('refreshes malformed subscription cache before deciding', () =>
		Effect.gen(function* () {
			let syncCalled = false
			const kv = new (class extends TestBillingKvService {
				override async getOrgCustomerId() {
					return customerId
				}

				override async getSubscriptionCache(): Promise<never> {
					throw new BillingKvCacheDecodeError({
						key: `stripe:customer:${customerId}`,
						cause: new Error('invalid cache shape'),
					})
				}
			})()

			const decision = yield* decideFor({
				kv,
				syncCustomerBillingToKv: () => {
					syncCalled = true
					return Effect.succeed(cache({ status: 'active' }))
				},
			})

			expect(decision).toBe('allowed')
			expect(syncCalled).toBe(true)
		}),
	)

	it.effect('blocks when non-KV subscription refresh fails', () =>
		Effect.gen(function* () {
			const kv = new TestBillingKvService()
			yield* Effect.promise(() => kv.setOrgCustomerId(organizationId, customerId))

			const decision = yield* decideFor({
				kv,
				syncCustomerBillingToKv: () => Effect.die(new Error('stripe unavailable')),
			})

			expect(decision).toBe('blocked')
		}),
	)

	it.effect('fails open when refresh fails due to KV', () =>
		Effect.gen(function* () {
			const kv = new TestBillingKvService()
			yield* Effect.promise(() => kv.setOrgCustomerId(organizationId, customerId))

			const decision = yield* decideFor({
				kv,
				syncCustomerBillingToKv: () =>
					Effect.fail(
						new StripeBillingSyncError({
							customerId,
							dependency: 'cache',
							cause: new BillingKvUnavailableError({
								operation: 'set_subscription_cache',
								cause: new RedisCommandError({ command: 'SET', cause: new Error('KV write failed') }),
							}),
						}),
					),
			})

			expect(decision).toBe('fail_open')
		}),
	)

	it.effect('returns only coarse internal decisions', () =>
		Effect.gen(function* () {
			const kv = new TestBillingKvService()
			yield* Effect.promise(() => kv.setOrgCustomerId(organizationId, customerId))
			yield* Effect.promise(() => kv.setSubscriptionCache(customerId, cache({ status: 'past_due' })))

			const decision = yield* decideFor({ kv })

			expect(['allowed', 'blocked', 'fail_open']).toContain(decision)
			expect(decision).toBe('blocked')
		}),
	)
})
