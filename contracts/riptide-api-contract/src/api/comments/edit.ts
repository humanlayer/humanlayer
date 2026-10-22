import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'

export const EditCommentInputSchema = z.object({
	commentId: z.uuid(),
	contentText: z.string().min(1),
	contentJson: z.unknown().optional(),
})

export const EditCommentOutputSchema = z.object({
	success: z.boolean(),
	transactionId: z.string(),
})

export const editCommentContract = contractBuilder.input(EditCommentInputSchema).output(EditCommentOutputSchema)
