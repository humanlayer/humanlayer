import z from 'zod/v4'

import { contractBuilder } from '../../../contract-builder'

export const GetSlackStatusInputSchema = z.object({}).optional()
export const GetSlackStatusOutputSchema = z.object({
	connected: z.boolean(),
	enabled: z.boolean(),
	needsReauth: z.boolean(),
	teamName: z.string().nullable(),
	lastErrorCode: z.string().nullable(),
})

export const getSlackStatusContract = contractBuilder
	.input(GetSlackStatusInputSchema)
	.output(GetSlackStatusOutputSchema)
