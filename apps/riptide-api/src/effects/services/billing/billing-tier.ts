import type { BillingTier } from '@humanlayer/billing/types'

export type PriceIdByTier = Readonly<Record<BillingTier, string | null | undefined>>

const BILLING_TIERS: readonly BillingTier[] = ['starter', 'pro', 'enterprise']

function trimmedOrNull(value: string | null | undefined): string | null {
	const trimmed = value?.trim()
	return trimmed ? trimmed : null
}

export function billingTierForPriceId(
	priceId: string | null | undefined,
	priceIdByTier: PriceIdByTier,
): BillingTier | null {
	const wanted = trimmedOrNull(priceId)
	if (!wanted) {
		return null
	}
	return BILLING_TIERS.find((tier) => trimmedOrNull(priceIdByTier[tier]) === wanted) ?? null
}

export function priceIdByTierFromEnvironment(): PriceIdByTier {
	return {
		starter: process.env.STRIPE_PRICE_STARTER,
		pro: process.env.STRIPE_PRICE_PRO,
		enterprise: process.env.STRIPE_PRICE_ENTERPRISE,
	}
}
