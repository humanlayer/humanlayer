import z from 'zod/v4'

import { contractBuilder } from '../../../contract-builder'

export const GetLinearStatusInputSchema = z.object({}).optional()
export const GetLinearStatusOutputSchema = z.object({
	enabled: z.boolean(),
	connected: z.boolean(),
	needsReauth: z.boolean(),
	/**
	 * False when this deployment has no Linear keys; the other fields then say not connected.
	 * Optional so older clients and servers stay compatible.
	 */
	configured: z.boolean().optional(),
})
export const getLinearStatusContract = contractBuilder
	.input(GetLinearStatusInputSchema)
	.output(GetLinearStatusOutputSchema)
