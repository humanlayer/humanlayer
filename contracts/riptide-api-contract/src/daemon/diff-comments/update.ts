import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'
import { DiffCommentSuffixSchema } from './reply'

export const UpdateDiffCommentsInputSchema = z.object({
	taskId: z.uuid(),
	truncatedCommentIds: z.array(DiffCommentSuffixSchema).min(1),
	resolved: z.boolean().optional().describe('Resolve or reopen each matched thread'),
	deleted: z.literal(true).optional().describe('Soft-delete each matched comment authored by the driving user'),
})

export const UpdateDiffCommentsOutputSchema = z.object({
	success: z.boolean(),
	updated: z.array(
		z.object({
			truncatedId: DiffCommentSuffixSchema,
			commentId: z.uuid(),
		}),
	),
	failed: z.array(
		z.object({
			truncatedId: DiffCommentSuffixSchema,
			reason: z.enum(['not_found', 'ambiguous', 'forbidden']),
		}),
	),
	transactionId: z.string().describe('Postgres transaction ID for sync verification'),
})

export const updateDiffCommentsContract = contractBuilder
	.input(UpdateDiffCommentsInputSchema)
	.output(UpdateDiffCommentsOutputSchema)
