import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'

export const ResolveAllCommentsInputSchema = z.object({
	artifactId: z.uuid(),
})

export const ResolveAllCommentsOutputSchema = z.object({
	success: z.boolean(),
	transactionId: z.string(),
	resolvedCount: z.number(),
})

export const resolveAllCommentsContract = contractBuilder
	.input(ResolveAllCommentsInputSchema)
	.output(ResolveAllCommentsOutputSchema)
