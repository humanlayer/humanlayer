import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'
import { DiffCommentIdSchema, DiffCommentMutationOutputSchema, DiffCommentTaskIdSchema } from './shared'

export const ResolveBatchDiffCommentsInputSchema = z.object({
	taskId: DiffCommentTaskIdSchema,
	rootCommentIds: z.array(DiffCommentIdSchema).min(1).max(500),
})
export const ResolveBatchDiffCommentsOutputSchema = DiffCommentMutationOutputSchema.extend({
	resolvedCount: z.number().int().nonnegative(),
})

export type ResolveBatchDiffCommentsInput = z.infer<typeof ResolveBatchDiffCommentsInputSchema>
export type ResolveBatchDiffCommentsOutput = z.infer<typeof ResolveBatchDiffCommentsOutputSchema>

export const resolveBatchDiffCommentsContract = contractBuilder
	.input(ResolveBatchDiffCommentsInputSchema)
	.output(ResolveBatchDiffCommentsOutputSchema)
