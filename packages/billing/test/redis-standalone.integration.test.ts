import { describe, it } from '@effect/vitest'
import { ConfigProvider, Effect, Layer } from 'effect'
import { expect } from 'vitest'

import { BillingKvService, BillingKvServiceLive } from '../src/billing-kv/billing-kv.service'
import {
	decodeRedisIntegerReply,
	decodeRedisNullableStringReply,
	decodeRedisOkayReply,
	RedisService,
} from '../src/redis/redis-service'
import { RedisStandaloneLive } from '../src/redis/redis-standalone-live'

const testRedisUrl = process.env.HUMANLAYER_TEST_KV_URL ?? 'redis://127.0.0.1:17000'
const TestConfigLive = ConfigProvider.layer(
	ConfigProvider.fromUnknown({ KV_URL: testRedisUrl, REDIS_READINESS_TIMEOUT: '10 seconds' }),
)
const TestRedisLive = RedisStandaloneLive.pipe(Layer.provide(TestConfigLive))
const TestBillingKvLive = BillingKvServiceLive.pipe(Layer.provideMerge(TestRedisLive))

describe('RedisStandaloneLive integration', () => {
	it.effect('connects, executes decoded commands, and cleans up its scope', () =>
		Effect.gen(function* () {
			const redis = yield* RedisService
			const key = `billing:standalone:command:${crypto.randomUUID()}`
			yield* redis.send('SET', key, 'value').pipe(Effect.flatMap((reply) => decodeRedisOkayReply('SET', reply)))
			expect(
				yield* redis
					.send('GET', key)
					.pipe(Effect.flatMap((reply) => decodeRedisNullableStringReply('GET', reply))),
			).toBe('value')
			expect(
				yield* redis.send('DEL', key).pipe(Effect.flatMap((reply) => decodeRedisIntegerReply('DEL', reply))),
			).toBe(1)
		}).pipe(Effect.provide(TestRedisLive)),
	)

	it.effect('round trips billing mappings and canonical subscription records', () =>
		Effect.gen(function* () {
			const billingKv = yield* BillingKvService
			const redis = yield* RedisService
			const suffix = crypto.randomUUID()
			const organizationId = `org_${suffix}`
			const customerId = `cus_${suffix}`
			const keys = [
				`stripe:org:${organizationId}`,
				`stripe:customer:${customerId}:org`,
				`stripe:customer:${customerId}`,
			]

			yield* billingKv.setOrgCustomerId({ organizationId, customerId })
			yield* billingKv.setCustomerOrgId({ customerId, organizationId })
			yield* billingKv.setSubscriptionCache({
				customerId,
				cache: {
					customerId,
					organizationId,
					subscriptionId: 'sub_integration',
					status: 'active',
					priceId: 'price_integration',
					currentPeriodEnd: 123,
					hasPaidInvoice: true,
					hasPaymentMethod: true,
					pastDueAt: null,
					syncedAt: 456,
				},
			})

			expect(yield* billingKv.getOrgCustomerId({ organizationId })).toBe(customerId)
			expect(yield* billingKv.getCustomerOrgId({ customerId })).toBe(organizationId)
			expect(yield* billingKv.getSubscriptionCache({ customerId })).toMatchObject({
				customerId,
				organizationId,
				status: 'active',
			})

			yield* Effect.forEach(keys, (key) => redis.send('DEL', key), { discard: true })
		}).pipe(Effect.provide(TestBillingKvLive)),
	)
})
