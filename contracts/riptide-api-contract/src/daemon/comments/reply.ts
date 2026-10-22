import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'

export const ReplyCommentInputSchema = z.object({
	taskId: z.uuid(),
	artifactFilename: z.string(),
	truncatedCommentId: z.string().min(8).max(12).describe('Truncated ID of comment to reply to'),
	contentText: z.string().min(1).describe('Reply text content (markdown supported)'),
})

export const ReplyCommentOutputSchema = z.object({
	success: z.boolean(),
	commentId: z.uuid(),
	parentCommentId: z.uuid(),
	transactionId: z.string().describe('Postgres transaction ID for sync verification'),
})

export const ReplyArtifactNotFoundDataSchema = z.object({
	validArtifacts: z.array(z.string()),
})

export const replyCommentContract = contractBuilder.input(ReplyCommentInputSchema).output(ReplyCommentOutputSchema)
