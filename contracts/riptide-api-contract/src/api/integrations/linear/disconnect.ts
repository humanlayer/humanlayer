import z from 'zod/v4'

import { contractBuilder } from '../../../contract-builder'

export const DisconnectLinearInputSchema = z.object({}).optional()
export const DisconnectLinearOutputSchema = z.object({
	success: z.boolean(),
})
export const disconnectLinearContract = contractBuilder
	.input(DisconnectLinearInputSchema)
	.output(DisconnectLinearOutputSchema)
