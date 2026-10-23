import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'
import { BillingSubscriptionStatusSchema } from '../../types/billing'

export const SyncCheckoutSessionInputSchema = z.object({})

export const SyncCheckoutSessionOutputSchema = z.object({
	syncedAt: z.number(),
	subscriptionStatus: BillingSubscriptionStatusSchema,
})

export const syncCheckoutSessionContract = contractBuilder
	.input(SyncCheckoutSessionInputSchema)
	.output(SyncCheckoutSessionOutputSchema)
