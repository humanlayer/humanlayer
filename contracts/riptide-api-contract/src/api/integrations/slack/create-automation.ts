import { contractBuilder } from '../../../contract-builder'
import { SlackAutomationInputSchema, SlackAutomationSchema } from './schemas'

export const createSlackAutomationContract = contractBuilder
	.input(SlackAutomationInputSchema)
	.output(SlackAutomationSchema)
