import type {
	StripeSubscriptionCache,
	StripeSubscriptionStatus as CanonicalStripeSubscriptionStatus,
} from './billing-kv/billing-kv.schemas'

export type StripeSubscriptionStatus = CanonicalStripeSubscriptionStatus

export type STRIPE_SUB_CACHE = StripeSubscriptionCache

export type BillingRolloutDisplayState = 'not_linked' | 'billing_linked' | 'billing_enrolled'

export type BillingTier = 'starter' | 'pro' | 'enterprise'

export type BillingVisibilitySubscriptionStatus =
	| 'trialing'
	| 'active'
	| 'paused'
	| 'past_due'
	| 'unpaid'
	| 'none'
	| null

export type BillingVisibilityModel = {
	rolloutDisplayState: BillingRolloutDisplayState
	tier: BillingTier | null
	subscriptionStatus: BillingVisibilitySubscriptionStatus
}
