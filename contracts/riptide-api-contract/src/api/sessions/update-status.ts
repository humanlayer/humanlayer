import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'

export const UpdateSessionStatusInputSchema = z.object({
	sessionId: z.uuid(),
	status: z.enum([
		'launching',
		'running',
		'ready_for_input',
		'needs_approval',
		'failed',
		'interrupt_requested',
		'interrupted',
		'lost',
	]),
})

export const UpdateSessionStatusOutputSchema = z.object({
	success: z.boolean(),
	transactionId: z.string(),
})

export const updateSessionStatusContract = contractBuilder
	.route({ deprecated: true })
	.input(UpdateSessionStatusInputSchema)
	.output(UpdateSessionStatusOutputSchema)
