import type { ReactNode } from 'react'

export type BillingRolloutDisplayState = 'not_linked' | 'billing_linked' | 'billing_enrolled'

export type BillingTier = 'starter' | 'pro' | 'enterprise' | null

export type StarterDowngradeEligibility = {
	isEligible: boolean
	activeMemberCount: number
	pendingInvitationCount: number
	usedCapacity: number
	freeCapacity: number
	disabledReason: string | null
}

export type SubscriptionStatus =
	| 'trialing'
	| 'active'
	| 'past_due'
	| 'paused'
	| 'canceled'
	| 'unpaid'
	| 'none'

export type BillingDiscount = {
	id: string
	promotionCodeId: string | null
	code: string | null
	name: string | null
	percentOff: number | null
	amountOff: number | null
	currency: string | null
	duration: string | null
}

export type BillingPaymentMethod = {
	brand: string | null
	last4: string | null
	expMonth: number | null
	expYear: number | null
}

export type BillingNextInvoice = {
	amountDue: number
	currency: string
}

export type BillingSectionProps = {
	organizationId?: string | null
	rolloutDisplayState: BillingRolloutDisplayState
	tier: BillingTier
	subscriptionStatus: SubscriptionStatus
	stripeCustomerId?: string | null
	subscriptionId?: string | null
	priceId?: string | null
	currentPeriodEnd?: number | null
	syncedAt?: number | null
	activeSeatCount?: number | null
	pendingInvitationCount?: number | null
	freeCapacity?: number | null
	discount?: BillingDiscount | null
	paymentMethod?: BillingPaymentMethod | null
	nextInvoice?: BillingNextInvoice | null
	promoCodeAction?: ReactNode
	diagnosticsDefaultOpen?: boolean
	children?: ReactNode
}
