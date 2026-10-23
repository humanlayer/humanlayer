import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'

export const DeleteCommentInputSchema = z.object({
	commentId: z.uuid(),
})

export const DeleteCommentOutputSchema = z.object({
	success: z.boolean(),
	transactionId: z.string(),
})

export const deleteCommentContract = contractBuilder.input(DeleteCommentInputSchema).output(DeleteCommentOutputSchema)
