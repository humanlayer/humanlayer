import type { STRIPE_SUB_CACHE } from '@humanlayer/billing/types'

import type { LinkedBillingFixture } from './linked-billing-kv'
import { createLinkedBillingFixture } from './linked-billing-kv'

/** Creates linked in-memory billing storage with canonical subscription-cache seeding. */
export async function createBillingLifecycleFixture(input?: { organizationId?: string; customerId?: string }): Promise<
	LinkedBillingFixture & {
		seedCache(cache?: Partial<STRIPE_SUB_CACHE>): Promise<STRIPE_SUB_CACHE>
	}
> {
	const linked = await createLinkedBillingFixture(input)
	await linked.linkCustomerToOrg()

	return {
		...linked,
		async seedCache(cache?: Partial<STRIPE_SUB_CACHE>) {
			const seeded: STRIPE_SUB_CACHE = {
				customerId: linked.customerId,
				organizationId: linked.organizationId,
				subscriptionId: null,
				status: 'none',
				priceId: null,
				currentPeriodEnd: null,
				hasPaidInvoice: false,
				hasPaymentMethod: false,
				pastDueAt: null,
				syncedAt: Date.now(),
				...cache,
			}

			await linked.kv.setSubscriptionCache(linked.customerId, seeded)
			return seeded
		},
	}
}
