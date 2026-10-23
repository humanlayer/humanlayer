import z from 'zod/v4'

import { contractBuilder } from '../../../contract-builder'
import { SlackAutomationInputSchema, SlackAutomationSchema } from './schemas'

export const updateSlackAutomationContract = contractBuilder
	.input(SlackAutomationInputSchema.partial().extend({ id: z.string() }))
	.output(SlackAutomationSchema)
