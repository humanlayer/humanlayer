import type { STRIPE_SUB_CACHE } from '@humanlayer/billing/types'
import { Effect, Layer } from 'effect'

import {
	BillingAccess,
	type BillingAccessDecision,
	type BillingAccessInput,
} from '../../src/effects/services/billing/billing-access.service'
import { Entitlements, type Feature } from '../../src/effects/services/billing/entitlements.service'

export function stubStripeBillingCache(customerId: string): STRIPE_SUB_CACHE {
	return {
		customerId,
		organizationId: null,
		subscriptionId: 'sub_test',
		status: 'active',
		priceId: 'price_starter',
		currentPeriodEnd: null,
		hasPaidInvoice: false,
		hasPaymentMethod: false,
		pastDueAt: null,
		syncedAt: Date.now(),
	}
}

export function billingAccessLayer(overrides?: {
	decision?: BillingAccessDecision
	decide?: (input: BillingAccessInput) => Promise<BillingAccessDecision>
	refreshStripeBillingCache?: (customerId: string) => Promise<STRIPE_SUB_CACHE>
}): Layer.Layer<BillingAccess> {
	const decide = overrides?.decide
	const refresh = overrides?.refreshStripeBillingCache
	return Layer.succeed(BillingAccess, {
		decideForOperation: decide
			? (input) => Effect.promise(() => decide(input))
			: () => Effect.succeed(overrides?.decision ?? 'allowed'),
		refreshStripeBillingCache: refresh
			? (customerId) => Effect.promise(() => refresh(customerId))
			: (customerId) => Effect.succeed(stubStripeBillingCache(customerId)),
	})
}

export function entitlementsLayer(features: Partial<Record<Feature, boolean>>): Layer.Layer<Entitlements> {
	return Layer.succeed(Entitlements, {
		hasFeature: (_organizationId, feature) => Effect.succeed(features[feature] ?? true),
	})
}
