import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'
import { BillingCheckoutClientInputSchema } from '../../types/billing'

export const StartUpgradeInputSchema = BillingCheckoutClientInputSchema

export const StartUpgradeOutputSchema = z.object({
	url: z.string().url(),
	alreadyPro: z.boolean().optional(),
})

export const startUpgradeContract = contractBuilder.input(StartUpgradeInputSchema).output(StartUpgradeOutputSchema)
