import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'

export const ResolveCommentInputSchema = z.object({
	commentId: z.uuid(),
	isResolved: z.boolean(),
})

export const ResolveCommentOutputSchema = z.object({
	success: z.boolean(),
	transactionId: z.string(),
})

export const resolveCommentContract = contractBuilder
	.input(ResolveCommentInputSchema)
	.output(ResolveCommentOutputSchema)
