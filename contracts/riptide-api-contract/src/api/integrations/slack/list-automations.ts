import z from 'zod/v4'

import { contractBuilder } from '../../../contract-builder'
import { SlackAutomationSchema } from './schemas'

export const ListSlackAutomationsInputSchema = z.object({}).optional()
export const ListSlackAutomationsOutputSchema = z.object({
	automations: z.array(SlackAutomationSchema),
})

export const listSlackAutomationsContract = contractBuilder
	.input(ListSlackAutomationsInputSchema)
	.output(ListSlackAutomationsOutputSchema)
