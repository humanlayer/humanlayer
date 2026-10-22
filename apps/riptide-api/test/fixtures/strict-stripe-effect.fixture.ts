import { Effect, Layer } from 'effect'

import { StripeService } from '../../src/effects/services/stripe/stripe.service'
import type { StripeServiceShape } from '../../src/effects/services/stripe/stripe.types'

const unused = (method: keyof StripeServiceShape) => () => Effect.die(`Unexpected Stripe call: ${method}`)

export function strictStripeEffectLayer(overrides: Partial<StripeServiceShape>) {
	return Layer.succeed(StripeService, {
		createCheckoutSession: unused('createCheckoutSession'),
		createProUpgradeCheckoutSession: unused('createProUpgradeCheckoutSession'),
		retrieveCheckoutSession: unused('retrieveCheckoutSession'),
		retrieveSubscription: unused('retrieveSubscription'),
		listCustomerSubscriptions: unused('listCustomerSubscriptions'),
		cancelSubscription: unused('cancelSubscription'),
		listPaidInvoices: unused('listPaidInvoices'),
		findActivePaidProSubscription: unused('findActivePaidProSubscription'),
		findNonCanceledStarterSubscription: unused('findNonCanceledStarterSubscription'),
		syncCustomerBillingToKv: unused('syncCustomerBillingToKv'),
		processWebhook: unused('processWebhook'),
		...overrides,
	} as StripeServiceShape)
}
