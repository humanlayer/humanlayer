import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'
import {
	DiffCommentAnchorInputSchema,
	DiffCommentContentJsonSchema,
	DiffCommentContentTextSchema,
	DiffCommentIdSchema,
	DiffCommentMutationOutputSchema,
	DiffCommentTaskIdSchema,
} from './shared'

export const CreateDiffCommentInputSchema = z
	.object({
		id: DiffCommentIdSchema.optional(),
		taskId: DiffCommentTaskIdSchema,
		contentText: DiffCommentContentTextSchema.pipe(z.string().min(1)),
		contentJson: DiffCommentContentJsonSchema.optional(),
		anchor: DiffCommentAnchorInputSchema,
	})
	.strict()

export const CreateDiffCommentOutputSchema = DiffCommentMutationOutputSchema.extend({
	commentId: DiffCommentIdSchema,
})

export type CreateDiffCommentInput = z.infer<typeof CreateDiffCommentInputSchema>
export type CreateDiffCommentOutput = z.infer<typeof CreateDiffCommentOutputSchema>

export const createDiffCommentContract = contractBuilder
	.input(CreateDiffCommentInputSchema)
	.output(CreateDiffCommentOutputSchema)
