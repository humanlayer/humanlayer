import z from 'zod/v4'

import { contractBuilder } from '../../../contract-builder'

export const DisconnectJiraInputSchema = z.object({}).optional()
export const DisconnectJiraOutputSchema = z.object({
	success: z.boolean(),
})
export const disconnectJiraContract = contractBuilder
	.input(DisconnectJiraInputSchema)
	.output(DisconnectJiraOutputSchema)
