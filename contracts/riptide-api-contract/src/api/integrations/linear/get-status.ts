import z from 'zod/v4'

import { contractBuilder } from '../../../contract-builder'

export const GetLinearStatusInputSchema = z.object({}).optional()
export const GetLinearStatusOutputSchema = z.object({
	enabled: z.boolean(),
	connected: z.boolean(),
	needsReauth: z.boolean(),
})
export const getLinearStatusContract = contractBuilder
	.input(GetLinearStatusInputSchema)
	.output(GetLinearStatusOutputSchema)
