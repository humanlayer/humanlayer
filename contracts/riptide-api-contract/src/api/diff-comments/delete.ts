import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'
import { DiffCommentIdSchema, DiffCommentMutationOutputSchema } from './shared'

export const DeleteDiffCommentInputSchema = z.object({ commentId: DiffCommentIdSchema })
export const DeleteDiffCommentOutputSchema = DiffCommentMutationOutputSchema

export type DeleteDiffCommentInput = z.infer<typeof DeleteDiffCommentInputSchema>
export type DeleteDiffCommentOutput = z.infer<typeof DeleteDiffCommentOutputSchema>

export const deleteDiffCommentContract = contractBuilder
	.input(DeleteDiffCommentInputSchema)
	.output(DeleteDiffCommentOutputSchema)
