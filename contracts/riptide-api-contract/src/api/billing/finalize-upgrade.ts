import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'

export const FinalizeUpgradeInputSchema = z.object({})

export const FinalizeUpgradeOutputSchema = z.object({
	finalized: z.boolean(),
	canceledStarterSubscriptionId: z.string().nullable().optional(),
	subscriptionStatus: z.string(),
})

/** @deprecated Use webhook-driven checkout synchronization. Earliest removal: 2026-08-11. */
export const finalizeUpgradeContract = contractBuilder
	.input(FinalizeUpgradeInputSchema)
	.output(FinalizeUpgradeOutputSchema)
