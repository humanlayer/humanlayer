import type { IStripeService } from '../../src/lib/stripe-service'

const notImplemented =
	(method: string) =>
	async (..._args: any[]) => {
		throw new Error(`Mock Stripe method not implemented: ${method}`)
	}

export function createMockStripeService(overrides?: Partial<IStripeService>): IStripeService {
	return {
		prices: overrides?.prices ?? { pro: 'price_pro_test', starter: 'price_starter_test' },
		verifyWebhook: overrides?.verifyWebhook ?? notImplemented('verifyWebhook'),
		isProPriceId: overrides?.isProPriceId ?? (() => false),
		isStarterPriceId: overrides?.isStarterPriceId ?? (() => false),
		createCheckoutSession:
			overrides?.createCheckoutSession ??
			(async () => {
				throw new Error('Mock Stripe method not implemented: createCheckoutSession')
			}),
		createProUpgradeCheckoutSession:
			overrides?.createProUpgradeCheckoutSession ?? notImplemented('createProUpgradeCheckoutSession'),
		downgradeProToStarter: overrides?.downgradeProToStarter ?? notImplemented('downgradeProToStarter'),
		findActivePaidProSubscription:
			overrides?.findActivePaidProSubscription ?? notImplemented('findActivePaidProSubscription'),
		findNonCanceledStarterSubscription:
			overrides?.findNonCanceledStarterSubscription ?? notImplemented('findNonCanceledStarterSubscription'),
		cancelSubscription: overrides?.cancelSubscription ?? notImplemented('cancelSubscription'),
		createPortalSession:
			overrides?.createPortalSession ??
			(async () => {
				throw new Error('Mock Stripe method not implemented: createPortalSession')
			}),
		resolvePromotionCode: overrides?.resolvePromotionCode ?? notImplemented('resolvePromotionCode'),
		applyPromotionCode: overrides?.applyPromotionCode ?? notImplemented('applyPromotionCode'),
		getCurrentSubscriptionDetails:
			overrides?.getCurrentSubscriptionDetails ?? notImplemented('getCurrentSubscriptionDetails'),
		getUpcomingInvoice: overrides?.getUpcomingInvoice ?? notImplemented('getUpcomingInvoice'),
		ensureStripeCustomerForOrg:
			overrides?.ensureStripeCustomerForOrg ??
			(async () => {
				throw new Error('Mock Stripe method not implemented: ensureStripeCustomerForOrg')
			}),
		ensureBillingOrgMappings: overrides?.ensureBillingOrgMappings ?? notImplemented('ensureBillingOrgMappings'),
		ensureProTrialSubscription:
			overrides?.ensureProTrialSubscription ??
			(async () => {
				throw new Error('Mock Stripe method not implemented: ensureProTrialSubscription')
			}),
		ensureStarterSubscription:
			overrides?.ensureStarterSubscription ??
			(async () => {
				throw new Error('Mock Stripe method not implemented: ensureStarterSubscription')
			}),
		findCurrentSubscriptionItemForCustomer:
			overrides?.findCurrentSubscriptionItemForCustomer ??
			notImplemented('findCurrentSubscriptionItemForCustomer'),
		updateSubscriptionItemQuantity:
			overrides?.updateSubscriptionItemQuantity ?? notImplemented('updateSubscriptionItemQuantity'),
		deleteCustomer: overrides?.deleteCustomer ?? notImplemented('deleteCustomer'),
	}
}
