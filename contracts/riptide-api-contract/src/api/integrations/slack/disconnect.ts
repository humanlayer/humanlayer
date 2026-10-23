import z from 'zod/v4'

import { contractBuilder } from '../../../contract-builder'

export const disconnectSlackContract = contractBuilder
	.input(z.object({}).optional())
	.output(z.object({ success: z.boolean() }))
