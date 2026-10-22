import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'
import {
	DiffCommentContentJsonSchema,
	DiffCommentContentTextSchema,
	DiffCommentIdSchema,
	DiffCommentMutationOutputSchema,
	DiffCommentTaskIdSchema,
} from './shared'

export const ReplyDiffCommentInputSchema = z
	.object({
		id: DiffCommentIdSchema.optional(),
		taskId: DiffCommentTaskIdSchema,
		rootCommentId: DiffCommentIdSchema,
		contentText: DiffCommentContentTextSchema.pipe(z.string().min(1)),
		contentJson: DiffCommentContentJsonSchema.optional(),
	})
	.strict()

export const ReplyDiffCommentOutputSchema = DiffCommentMutationOutputSchema.extend({
	commentId: DiffCommentIdSchema,
})

export type ReplyDiffCommentInput = z.infer<typeof ReplyDiffCommentInputSchema>
export type ReplyDiffCommentOutput = z.infer<typeof ReplyDiffCommentOutputSchema>

export const replyDiffCommentContract = contractBuilder
	.input(ReplyDiffCommentInputSchema)
	.output(ReplyDiffCommentOutputSchema)
