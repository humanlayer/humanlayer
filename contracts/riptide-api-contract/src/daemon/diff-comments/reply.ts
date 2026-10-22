import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'

export const DiffCommentSuffixSchema = z
	.string()
	.min(8)
	.max(12)
	.regex(/^[0-9a-fA-F]+$/, 'Comment ID suffix must contain only hexadecimal characters')
	.describe('Unique 8-12 character right-hand UUID suffix')

export const ReplyToDiffCommentInputSchema = z.object({
	taskId: z.uuid(),
	truncatedCommentId: DiffCommentSuffixSchema,
	contentText: z.string().trim().min(1).describe('Reply text content (Markdown supported)'),
})

export const ReplyToDiffCommentOutputSchema = z.object({
	success: z.literal(true),
	commentId: z.uuid(),
	parentCommentId: z.uuid(),
	transactionId: z.string().describe('Postgres transaction ID for sync verification'),
})

export const replyToDiffCommentContract = contractBuilder
	.input(ReplyToDiffCommentInputSchema)
	.output(ReplyToDiffCommentOutputSchema)
