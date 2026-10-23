import z from 'zod/v4'

import { contractBuilder } from '../../../contract-builder'

export const deleteSlackAutomationContract = contractBuilder
	.input(z.object({ id: z.string() }))
	.output(z.object({ success: z.boolean() }))
