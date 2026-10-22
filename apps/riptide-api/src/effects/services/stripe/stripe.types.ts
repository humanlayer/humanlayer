import type { BillingKvService } from '@humanlayer/billing/billing-kv'
import type { RedisService } from '@humanlayer/billing/redis'
import type { Effect } from 'effect'
import * as Schema from 'effect/Schema'

import type { PostgresDb } from '../postgres/postgres-db.service'
import type { StripeHttpClient } from './stripe-http-client.service'
import type {
	StripeCancelSubscriptionError,
	StripeCheckoutSessionCreateError,
	StripeListCustomerSubscriptionsError,
	StripeRetrieveCheckoutSessionError,
	StripeRetrieveSubscriptionError,
	StripeSyncCustomerBillingError,
	StripeWebhookError,
} from './stripe.errors'
import type { StripeSubscriptionStatus } from './stripe.schema'
import { StripeSubscriptionStatusSchema } from './stripe.schema'

const NullableNonEmptyStringSchema = Schema.Union([Schema.NonEmptyString, Schema.Null])
const CheckoutAttemptId = Schema.String.pipe(
	Schema.check(Schema.isUUID()),
	Schema.annotate({ identifier: 'CheckoutAttemptId' }),
)

export const PositiveQuantity = Schema.Number.pipe(
	Schema.check(
		Schema.isInt({ message: 'Expected a whole-number Stripe quantity' }),
		Schema.isGreaterThanOrEqualTo(1, { message: 'Expected a positive Stripe quantity' }),
	),
	Schema.annotate({ identifier: 'PositiveQuantity' }),
)
export type PositiveQuantity = Schema.Schema.Type<typeof PositiveQuantity>

export const CheckoutSessionDetails = Schema.Struct({
	id: Schema.NonEmptyString,
	status: Schema.Union([Schema.Literal('complete'), Schema.Literal('open'), Schema.Literal('expired'), Schema.Null]),
	paymentStatus: Schema.Union([
		Schema.Literal('paid'),
		Schema.Literal('unpaid'),
		Schema.Literal('no_payment_required'),
	]),
	mode: Schema.Union([
		Schema.Literal('subscription'),
		Schema.Literal('payment'),
		Schema.Literal('setup'),
		Schema.Null,
	]),
	customerId: NullableNonEmptyStringSchema,
	subscriptionId: NullableNonEmptyStringSchema,
	url: Schema.Union([Schema.String, Schema.Null]),
})
export type CheckoutSessionDetails = Schema.Schema.Type<typeof CheckoutSessionDetails>

export const SubscriptionDetails = Schema.Struct({
	id: Schema.NonEmptyString,
	customerId: Schema.NonEmptyString,
	status: StripeSubscriptionStatusSchema,
	created: Schema.Number,
	priceIds: Schema.Array(Schema.NonEmptyString),
	quantity: Schema.Union([Schema.Number, Schema.Null]),
	currentPeriodEnd: Schema.Union([Schema.Number, Schema.Null]),
	hasPaymentMethod: Schema.Boolean,
}) satisfies Schema.Schema<{
	readonly id: string
	readonly customerId: string
	readonly status: StripeSubscriptionStatus
	readonly created: number
	readonly priceIds: readonly string[]
	readonly quantity: number | null
	readonly currentPeriodEnd: number | null
	readonly hasPaymentMethod: boolean
}>
export type SubscriptionDetails = Schema.Schema.Type<typeof SubscriptionDetails>

export const PaidInvoiceDetails = Schema.Struct({
	id: Schema.NonEmptyString,
	customerId: NullableNonEmptyStringSchema,
	subscriptionId: NullableNonEmptyStringSchema,
})
export type PaidInvoiceDetails = Schema.Schema.Type<typeof PaidInvoiceDetails>

export const StripeBillingSubscriptionStatus = Schema.Union([StripeSubscriptionStatusSchema, Schema.Literal('none')])
export type StripeBillingSubscriptionStatus = Schema.Schema.Type<typeof StripeBillingSubscriptionStatus>

export const StripeBillingCache = Schema.Struct({
	customerId: Schema.NonEmptyString,
	organizationId: NullableNonEmptyStringSchema,
	subscriptionId: NullableNonEmptyStringSchema,
	status: StripeBillingSubscriptionStatus,
	priceId: NullableNonEmptyStringSchema,
	currentPeriodEnd: Schema.Union([Schema.Number, Schema.Null]),
	hasPaidInvoice: Schema.Boolean,
	hasPaymentMethod: Schema.Boolean,
	pastDueAt: Schema.Union([Schema.Number, Schema.Null]),
	syncedAt: Schema.Number,
})
export type StripeBillingCache = Schema.Schema.Type<typeof StripeBillingCache>

export const CreateCheckoutSessionInput = Schema.Struct({
	checkoutAttemptId: CheckoutAttemptId,
	customerId: Schema.NonEmptyString,
	organizationId: Schema.NonEmptyString,
	successUrl: Schema.NonEmptyString,
	cancelUrl: Schema.NonEmptyString,
	quantity: PositiveQuantity,
	promoCode: Schema.optional(Schema.NonEmptyString),
})
export type CreateCheckoutSessionInput = Schema.Schema.Type<typeof CreateCheckoutSessionInput>

export const CreateProUpgradeCheckoutSessionInput = Schema.Struct({
	checkoutAttemptId: CheckoutAttemptId,
	customerId: Schema.NonEmptyString,
	organizationId: Schema.NonEmptyString,
	successUrl: Schema.NonEmptyString,
	cancelUrl: Schema.NonEmptyString,
	quantity: PositiveQuantity,
})
export type CreateProUpgradeCheckoutSessionInput = Schema.Schema.Type<typeof CreateProUpgradeCheckoutSessionInput>

export const RetrieveCheckoutSessionInput = Schema.Struct({ sessionId: Schema.NonEmptyString })
export type RetrieveCheckoutSessionInput = Schema.Schema.Type<typeof RetrieveCheckoutSessionInput>

export const RetrieveSubscriptionInput = Schema.Struct({ subscriptionId: Schema.NonEmptyString })
export type RetrieveSubscriptionInput = Schema.Schema.Type<typeof RetrieveSubscriptionInput>

export const ListCustomerSubscriptionsInput = Schema.Struct({ customerId: Schema.NonEmptyString })
export type ListCustomerSubscriptionsInput = Schema.Schema.Type<typeof ListCustomerSubscriptionsInput>

export const CancelSubscriptionInput = Schema.Struct({ subscriptionId: Schema.NonEmptyString })
export type CancelSubscriptionInput = Schema.Schema.Type<typeof CancelSubscriptionInput>

export const ListPaidInvoicesInput = Schema.Struct({
	customerId: Schema.NonEmptyString,
	subscriptionId: Schema.optional(Schema.NonEmptyString),
})
export type ListPaidInvoicesInput = Schema.Schema.Type<typeof ListPaidInvoicesInput>

export const SyncCustomerBillingToKvInput = Schema.Struct({ customerId: Schema.NonEmptyString })
export type SyncCustomerBillingToKvInput = Schema.Schema.Type<typeof SyncCustomerBillingToKvInput>

export const ProcessWebhookInput = Schema.Struct({
	body: Schema.String,
	signature: Schema.NonEmptyString,
})
export type ProcessWebhookInput = Schema.Schema.Type<typeof ProcessWebhookInput>

export const CheckoutSessionCreateResult = Schema.Struct({ url: Schema.NonEmptyString })
export type CheckoutSessionCreateResult = Schema.Schema.Type<typeof CheckoutSessionCreateResult>

export type StripeServiceShape = {
	createCheckoutSession: (
		input: CreateCheckoutSessionInput,
	) => Effect.Effect<CheckoutSessionCreateResult, StripeCheckoutSessionCreateError, StripeHttpClient>
	createProUpgradeCheckoutSession: (
		input: CreateProUpgradeCheckoutSessionInput,
	) => Effect.Effect<CheckoutSessionCreateResult, StripeCheckoutSessionCreateError, StripeHttpClient>
	retrieveCheckoutSession: (
		input: RetrieveCheckoutSessionInput,
	) => Effect.Effect<CheckoutSessionDetails, StripeRetrieveCheckoutSessionError, StripeHttpClient>
	retrieveSubscription: (
		input: RetrieveSubscriptionInput,
	) => Effect.Effect<SubscriptionDetails, StripeRetrieveSubscriptionError, StripeHttpClient>
	listCustomerSubscriptions: (
		input: ListCustomerSubscriptionsInput,
	) => Effect.Effect<readonly SubscriptionDetails[], StripeListCustomerSubscriptionsError, StripeHttpClient>
	cancelSubscription: (
		input: CancelSubscriptionInput,
	) => Effect.Effect<void, StripeCancelSubscriptionError, StripeHttpClient>
	listPaidInvoices: (
		input: ListPaidInvoicesInput,
	) => Effect.Effect<readonly PaidInvoiceDetails[], StripeListCustomerSubscriptionsError, StripeHttpClient>
	findActivePaidProSubscription: (
		input: ListCustomerSubscriptionsInput,
	) => Effect.Effect<
		{ readonly subscriptionId: string } | null,
		StripeListCustomerSubscriptionsError,
		StripeHttpClient
	>
	findNonCanceledStarterSubscription: (
		input: ListCustomerSubscriptionsInput,
	) => Effect.Effect<
		{ readonly subscriptionId: string } | null,
		StripeListCustomerSubscriptionsError,
		StripeHttpClient
	>
	syncCustomerBillingToKv: (
		input: SyncCustomerBillingToKvInput,
	) => Effect.Effect<
		StripeBillingCache,
		StripeSyncCustomerBillingError,
		BillingKvService | PostgresDb | RedisService | StripeHttpClient
	>
	processWebhook: (
		input: ProcessWebhookInput,
	) => Effect.Effect<
		{ readonly received: true },
		StripeWebhookError,
		BillingKvService | PostgresDb | RedisService | StripeHttpClient
	>
}
