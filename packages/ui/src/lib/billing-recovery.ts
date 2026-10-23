import type { BillingRolloutDisplayState, SubscriptionStatus } from '../components/billing/types'

export function recoveryRequired(
	rolloutDisplayState: BillingRolloutDisplayState,
	status: SubscriptionStatus,
): boolean {
	if (rolloutDisplayState === 'not_linked') {
		return false
	}

	return rolloutDisplayState === 'billing_linked' || status === 'none' || status === 'canceled'
}
