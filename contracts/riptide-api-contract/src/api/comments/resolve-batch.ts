import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'

export const ResolveBatchCommentsInputSchema = z.object({
	artifactId: z.uuid(),
	rootCommentIds: z.array(z.uuid()).min(1).max(500),
})

export const ResolveBatchCommentsOutputSchema = z.object({
	success: z.literal(true),
	transactionId: z.string(),
	resolvedCount: z.number().int().nonnegative(),
})

export const resolveBatchCommentsContract = contractBuilder
	.input(ResolveBatchCommentsInputSchema)
	.output(ResolveBatchCommentsOutputSchema)
