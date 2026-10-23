import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'

export const requestHostUpdateInputSchema = z.object({
	hostId: z.string(),
	version: z.string().min(1),
})

export const requestHostUpdateOutputSchema = z.object({
	hostId: z.string(),
	version: z.string(),
})

export const requestHostUpdateContract = contractBuilder
	.input(requestHostUpdateInputSchema)
	.output(requestHostUpdateOutputSchema)
