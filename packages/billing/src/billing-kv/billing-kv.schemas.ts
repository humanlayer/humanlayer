import { Schema } from 'effect'

export const StripeSubscriptionStatus = Schema.Literals([
	'active',
	'canceled',
	'incomplete',
	'incomplete_expired',
	'past_due',
	'paused',
	'trialing',
	'unpaid',
	'none',
])
export type StripeSubscriptionStatus = typeof StripeSubscriptionStatus.Type

export const PersistedStripeSubscriptionCache = Schema.Struct({
	customerId: Schema.String,
	organizationId: Schema.NullOr(Schema.String),
	subscriptionId: Schema.NullOr(Schema.String),
	status: Schema.String,
	priceId: Schema.NullOr(Schema.String),
	currentPeriodEnd: Schema.NullOr(Schema.Number),
	hasPaidInvoice: Schema.Boolean,
	hasPaymentMethod: Schema.optionalKey(Schema.Boolean),
	pastDueAt: Schema.NullOr(Schema.Number),
	syncedAt: Schema.Number,
})
export interface PersistedStripeSubscriptionCache extends Schema.Schema.Type<typeof PersistedStripeSubscriptionCache> {}

export const StripeSubscriptionCache = Schema.Struct({
	customerId: Schema.String,
	organizationId: Schema.NullOr(Schema.String),
	subscriptionId: Schema.NullOr(Schema.String),
	status: StripeSubscriptionStatus,
	priceId: Schema.NullOr(Schema.String),
	currentPeriodEnd: Schema.NullOr(Schema.Number),
	hasPaidInvoice: Schema.Boolean,
	hasPaymentMethod: Schema.Boolean,
	pastDueAt: Schema.NullOr(Schema.Number),
	syncedAt: Schema.Number,
})
export interface StripeSubscriptionCache extends Schema.Schema.Type<typeof StripeSubscriptionCache> {}

export interface ReadableStripeSubscriptionCache {
	readonly customerId: string
	readonly organizationId: string | null
	readonly subscriptionId: string | null
	readonly status: StripeSubscriptionStatus
	readonly priceId: string | null
	readonly currentPeriodEnd: number | null
	readonly hasPaidInvoice: boolean
	readonly hasPaymentMethod: boolean
	readonly pastDueAt: number | null
	readonly syncedAt: number
}
