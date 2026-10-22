import { diffCommentInsertSchema, diffCommentUpdateSchema } from '@humanlayer/db/tables/diff-comments'
import z from 'zod/v4'

export const DiffCommentIdSchema = diffCommentInsertSchema.shape.id.unwrap()
export const DiffCommentTaskIdSchema = diffCommentInsertSchema.shape.task_id
export const DiffCommentContentTextSchema = diffCommentInsertSchema.shape.content_text
export const DiffCommentContentJsonSchema = diffCommentInsertSchema.shape.content_json
export const DiffCommentAnchorInputSchema = diffCommentInsertSchema.shape.anchor_json.unwrap().unwrap()

export const DiffCommentMutationOutputSchema = z.object({
	success: z.literal(true),
	transactionId: z.string(),
})

export const DiffCommentEditableContentSchema = z.object({
	contentText: diffCommentUpdateSchema.shape.content_text.unwrap().pipe(z.string().min(1)),
	contentJson: diffCommentUpdateSchema.shape.content_json.optional(),
})
