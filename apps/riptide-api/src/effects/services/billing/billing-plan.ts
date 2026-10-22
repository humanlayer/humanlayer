import { BillingKvService } from '@humanlayer/billing/billing-kv'
import type { RedisService } from '@humanlayer/billing/redis'
import type { BillingTier } from '@humanlayer/billing/types'
import { Effect } from 'effect'

import type { PostgresDb } from '../postgres/postgres-db.service'
import type { StripeHttpClient } from '../stripe/stripe-http-client.service'
import { StripeService } from '../stripe/stripe.service'
import { billingTierForPriceId, type PriceIdByTier } from './billing-tier'

export type BillingDependencies = BillingKvService | StripeService | PostgresDb | RedisService | StripeHttpClient

export type OrganizationBillingPlan = {
	readonly tier: BillingTier | null
	readonly status: string
	readonly subscriptionId: string | null
}

const GOOD_STANDING_STATUSES: ReadonlySet<string> = new Set(['active', 'trialing'])

export function isInGoodStanding(plan: OrganizationBillingPlan): boolean {
	return plan.subscriptionId !== null && GOOD_STANDING_STATUSES.has(plan.status)
}

// Null when the org has no Stripe customer. A missing cache is filled from Stripe first, the
// same way the billing middlewares do.
export const organizationBillingPlan = (organizationId: string, priceIdByTier: PriceIdByTier) =>
	Effect.gen(function* () {
		const kv = yield* BillingKvService
		const customerId = yield* kv.getOrgCustomerId({ organizationId })
		if (!customerId) return null

		const stripe = yield* StripeService
		const cache =
			(yield* kv.getSubscriptionCache({ customerId })) ?? (yield* stripe.syncCustomerBillingToKv({ customerId }))

		return {
			tier: billingTierForPriceId(cache.priceId, priceIdByTier),
			status: cache.status,
			subscriptionId: cache.subscriptionId,
		} satisfies OrganizationBillingPlan
	}).pipe(Effect.withSpan('billing_plan.organization_billing_plan'))
