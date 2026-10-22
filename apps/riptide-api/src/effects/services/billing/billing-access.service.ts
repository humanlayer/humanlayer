import type { STRIPE_SUB_CACHE } from '@humanlayer/billing/types'
import { Context, Effect } from 'effect'

import type { StripeSyncCustomerBillingError } from '../stripe/stripe.errors'

export type BillingAccessDecision = 'allowed' | 'blocked' | 'fail_open'

export interface BillingAccessInput {
	readonly organizationId: string
	readonly operation: string
}

/** Postgres is a dependency of the Stripe refresh only, never read on the decision path. */
export class BillingAccess extends Context.Service<
	BillingAccess,
	{
		readonly decideForOperation: (input: BillingAccessInput) => Effect.Effect<BillingAccessDecision>
		readonly refreshStripeBillingCache: (
			customerId: string,
		) => Effect.Effect<STRIPE_SUB_CACHE, StripeSyncCustomerBillingError>
	}
>()('BillingAccess') {}

export const decideBillingAccess = (input: BillingAccessInput) =>
	Effect.gen(function* () {
		const billingAccess = yield* BillingAccess
		return yield* billingAccess.decideForOperation(input)
	})

export const refreshStripeBillingCache = (customerId: string) =>
	Effect.gen(function* () {
		const billingAccess = yield* BillingAccess
		return yield* billingAccess.refreshStripeBillingCache(customerId)
	})
