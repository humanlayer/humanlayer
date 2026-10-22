import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'
import { DiffCommentIdSchema, DiffCommentMutationOutputSchema } from './shared'

export const ResolveDiffCommentInputSchema = z.object({
	commentId: DiffCommentIdSchema,
	isResolved: z.boolean(),
})
export const ResolveDiffCommentOutputSchema = DiffCommentMutationOutputSchema

export type ResolveDiffCommentInput = z.infer<typeof ResolveDiffCommentInputSchema>
export type ResolveDiffCommentOutput = z.infer<typeof ResolveDiffCommentOutputSchema>

export const resolveDiffCommentContract = contractBuilder
	.input(ResolveDiffCommentInputSchema)
	.output(ResolveDiffCommentOutputSchema)
