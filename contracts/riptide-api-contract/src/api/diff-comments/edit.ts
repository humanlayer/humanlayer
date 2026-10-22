import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'
import { DiffCommentEditableContentSchema, DiffCommentIdSchema, DiffCommentMutationOutputSchema } from './shared'

export const EditDiffCommentInputSchema = DiffCommentEditableContentSchema.extend({
	commentId: DiffCommentIdSchema,
})

export const EditDiffCommentOutputSchema = DiffCommentMutationOutputSchema

export type EditDiffCommentInput = z.infer<typeof EditDiffCommentInputSchema>
export type EditDiffCommentOutput = z.infer<typeof EditDiffCommentOutputSchema>

export const editDiffCommentContract = contractBuilder
	.input(EditDiffCommentInputSchema)
	.output(EditDiffCommentOutputSchema)
