import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'

export const shutdownInputSchema = z.object({
	hostId: z.string(),
	reason: z.string().optional(),
})

export const shutdownOutputSchema = z.object({
	success: z.boolean(),
	sessionsUpdated: z.number(),
})

export const shutdownContract = contractBuilder.input(shutdownInputSchema).output(shutdownOutputSchema)
