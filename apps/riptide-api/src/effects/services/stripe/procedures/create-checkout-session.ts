import type { CreateCheckoutSessionInput } from '../stripe.types'
import { createSubscriptionCheckoutSession } from './create-subscription-checkout-session'

export const createCheckoutSession = (input: CreateCheckoutSessionInput, priceId: string) =>
	createSubscriptionCheckoutSession({
		checkout: input,
		priceId,
		idempotencyKeyPrefix: 'checkout',
		extraUrlParams: input.promoCode ? { 'discounts[0][promotion_code]': input.promoCode } : undefined,
		spanName: 'stripe.create_checkout_session',
	})
