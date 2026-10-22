import type {
	BillingRolloutDisplayState,
	BillingTier,
	BillingVisibilityModel,
	BillingVisibilitySubscriptionStatus,
} from './types'

type DeriveBillingVisibilityInput = {
	stripeCustomerId: string | null | undefined
	tier?: BillingTier | null
	subscriptionStatus?: BillingVisibilitySubscriptionStatus
}

function toDisplayState(input: {
	stripeCustomerId: string | null | undefined
	subscriptionStatus: BillingVisibilitySubscriptionStatus
}): BillingRolloutDisplayState {
	if (!input.stripeCustomerId) {
		return 'not_linked'
	}

	if (input.subscriptionStatus === null || input.subscriptionStatus === 'none') {
		return 'billing_linked'
	}

	return 'billing_enrolled'
}

export function deriveBillingVisibilityModel(input: DeriveBillingVisibilityInput): BillingVisibilityModel {
	const subscriptionStatus: BillingVisibilitySubscriptionStatus =
		input.subscriptionStatus ?? (input.stripeCustomerId ? 'none' : null)

	return {
		rolloutDisplayState: toDisplayState({
			stripeCustomerId: input.stripeCustomerId,
			subscriptionStatus,
		}),
		tier: input.tier ?? null,
		subscriptionStatus,
	}
}
