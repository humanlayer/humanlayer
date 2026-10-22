import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'
import { BillingCheckoutClientInputSchema } from '../../types/billing'

export const CreateCheckoutSessionInputSchema = BillingCheckoutClientInputSchema.and(
	z.object({ promoCode: z.string().trim().nonempty().optional() }),
)

export const CreateCheckoutSessionOutputSchema = z.object({
	url: z.string().url(),
})

export const createCheckoutSessionContract = contractBuilder
	.input(CreateCheckoutSessionInputSchema)
	.output(CreateCheckoutSessionOutputSchema)
