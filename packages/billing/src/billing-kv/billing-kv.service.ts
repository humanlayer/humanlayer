import { Context, Effect, Layer, Option, Schema } from 'effect'

import { stripeBillingKeys } from '../keys'
import {
	decodeRedisNullableStringReply,
	decodeRedisOkayReply,
	RedisService,
	type RedisServiceError,
} from '../redis/redis-service'
import {
	BillingKvCacheDecodeError,
	BillingKvCacheEncodeError,
	BillingKvUnavailableError,
	type BillingKvOperation,
} from './billing-kv.errors'
import {
	PersistedStripeSubscriptionCache,
	type ReadableStripeSubscriptionCache,
	StripeSubscriptionCache,
	StripeSubscriptionStatus,
} from './billing-kv.schemas'

export interface GetOrgCustomerIdInput {
	readonly organizationId: string
}

export interface SetOrgCustomerIdInput {
	readonly organizationId: string
	readonly customerId: string
}

export interface GetCustomerOrgIdInput {
	readonly customerId: string
}

export interface SetCustomerOrgIdInput {
	readonly customerId: string
	readonly organizationId: string
}

export interface GetSubscriptionCacheInput {
	readonly customerId: string
}

export interface SetSubscriptionCacheInput {
	readonly customerId: string
	readonly cache: StripeSubscriptionCache
}

export interface BillingKvServiceShape {
	readonly getOrgCustomerId: (
		input: GetOrgCustomerIdInput,
	) => Effect.Effect<string | null, BillingKvUnavailableError, RedisService>
	readonly setOrgCustomerId: (
		input: SetOrgCustomerIdInput,
	) => Effect.Effect<void, BillingKvUnavailableError, RedisService>
	readonly getCustomerOrgId: (
		input: GetCustomerOrgIdInput,
	) => Effect.Effect<string | null, BillingKvUnavailableError, RedisService>
	readonly setCustomerOrgId: (
		input: SetCustomerOrgIdInput,
	) => Effect.Effect<void, BillingKvUnavailableError, RedisService>
	readonly getSubscriptionCache: (
		input: GetSubscriptionCacheInput,
	) => Effect.Effect<
		ReadableStripeSubscriptionCache | null,
		BillingKvUnavailableError | BillingKvCacheDecodeError,
		RedisService
	>
	readonly setSubscriptionCache: (
		input: SetSubscriptionCacheInput,
	) => Effect.Effect<void, BillingKvUnavailableError | BillingKvCacheEncodeError, RedisService>
}

export class BillingKvService extends Context.Service<BillingKvService, BillingKvServiceShape>()(
	'billing/BillingKvService',
) {}

const narrowRedisFailure = (operation: BillingKvOperation) => (cause: RedisServiceError) =>
	new BillingKvUnavailableError({ operation, cause })

const readNullableString = (operation: BillingKvOperation, key: string) =>
	Effect.gen(function* () {
		const redis = yield* RedisService
		const reply = yield* redis.send('GET', key)
		return yield* decodeRedisNullableStringReply('GET', reply)
	}).pipe(Effect.mapError(narrowRedisFailure(operation)))

const writeString = (operation: BillingKvOperation, key: string, value: string) =>
	Effect.gen(function* () {
		const redis = yield* RedisService
		const reply = yield* redis.send('SET', key, value)
		yield* decodeRedisOkayReply('SET', reply)
	}).pipe(Effect.mapError(narrowRedisFailure(operation)))

export const getOrgCustomerId = (input: GetOrgCustomerIdInput) =>
	readNullableString('get_org_customer_id', stripeBillingKeys.orgCustomer(input.organizationId)).pipe(
		Effect.withSpan('billing_kv.get_org_customer_id'),
	)

export const setOrgCustomerId = (input: SetOrgCustomerIdInput) =>
	writeString('set_org_customer_id', stripeBillingKeys.orgCustomer(input.organizationId), input.customerId).pipe(
		Effect.withSpan('billing_kv.set_org_customer_id'),
	)

export const getCustomerOrgId = (input: GetCustomerOrgIdInput) =>
	readNullableString('get_customer_org_id', stripeBillingKeys.customerOrg(input.customerId)).pipe(
		Effect.withSpan('billing_kv.get_customer_org_id'),
	)

export const setCustomerOrgId = (input: SetCustomerOrgIdInput) =>
	writeString('set_customer_org_id', stripeBillingKeys.customerOrg(input.customerId), input.organizationId).pipe(
		Effect.withSpan('billing_kv.set_customer_org_id'),
	)

const decodeSubscriptionCache = (key: string, serialized: string) =>
	Effect.try({
		try: (): unknown => JSON.parse(serialized),
		catch: (cause) => new BillingKvCacheDecodeError({ key, cause }),
	}).pipe(
		Effect.flatMap((parsed) =>
			Schema.decodeUnknownEffect(PersistedStripeSubscriptionCache)(parsed).pipe(
				Effect.mapError((cause) => new BillingKvCacheDecodeError({ key, cause })),
			),
		),
		Effect.map(
			(cache): ReadableStripeSubscriptionCache => ({
				customerId: cache.customerId,
				organizationId: cache.organizationId,
				subscriptionId: cache.subscriptionId,
				status: Schema.decodeUnknownOption(StripeSubscriptionStatus)(cache.status).pipe(
					Option.getOrElse((): StripeSubscriptionStatus => 'none'),
				),
				priceId: cache.priceId,
				currentPeriodEnd: cache.currentPeriodEnd,
				hasPaidInvoice: cache.hasPaidInvoice,
				hasPaymentMethod: cache.hasPaymentMethod ?? false,
				pastDueAt: cache.pastDueAt,
				syncedAt: cache.syncedAt,
			}),
		),
	)

export const getSubscriptionCache = (input: GetSubscriptionCacheInput) =>
	Effect.gen(function* () {
		const key = stripeBillingKeys.customerCache(input.customerId)
		const serialized = yield* readNullableString('get_subscription_cache', key)
		if (serialized === null) return null
		return yield* decodeSubscriptionCache(key, serialized)
	}).pipe(Effect.withSpan('billing_kv.get_subscription_cache'))

export const setSubscriptionCache = (input: SetSubscriptionCacheInput) =>
	Schema.encodeEffect(StripeSubscriptionCache)(input.cache).pipe(
		Effect.mapError((cause) => new BillingKvCacheEncodeError({ cause })),
		Effect.map((encoded) => JSON.stringify(encoded)),
		Effect.flatMap((serialized) =>
			writeString('set_subscription_cache', stripeBillingKeys.customerCache(input.customerId), serialized),
		),
		Effect.withSpan('billing_kv.set_subscription_cache'),
	)

export const BillingKvServiceLive = Layer.succeed(
	BillingKvService,
	BillingKvService.of({
		getOrgCustomerId,
		setOrgCustomerId,
		getCustomerOrgId,
		setCustomerOrgId,
		getSubscriptionCache,
		setSubscriptionCache,
	}),
)
