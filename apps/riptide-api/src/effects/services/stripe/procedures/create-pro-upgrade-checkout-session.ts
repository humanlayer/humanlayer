import type { CreateProUpgradeCheckoutSessionInput } from '../stripe.types'
import { createSubscriptionCheckoutSession } from './create-subscription-checkout-session'

export const createProUpgradeCheckoutSession = (input: CreateProUpgradeCheckoutSessionInput, priceId: string) =>
	createSubscriptionCheckoutSession({
		checkout: input,
		priceId,
		idempotencyKeyPrefix: 'checkout-upgrade',
		extraUrlParams: { 'metadata[upgrade]': 'starter_to_pro' },
		spanName: 'stripe.create_pro_upgrade_checkout_session',
	})
