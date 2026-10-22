import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'

export const InterruptSessionInputSchema = z.object({
	sessionId: z.uuid(),
	message: z.string().optional(),
})

export const InterruptSessionOutputSchema = z.object({
	transactionId: z.string(),
	success: z.boolean(),
})

export const interruptSessionContract = contractBuilder
	.input(InterruptSessionInputSchema)
	.output(InterruptSessionOutputSchema)
