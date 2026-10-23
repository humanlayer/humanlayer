import { DiffCommentAnchorSchema } from '@humanlayer/db/zodschemas/diff-comment-anchor'
import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'

export const GetDiffCommentsInputSchema = z.object({
	taskId: z.uuid(),
	includeResolved: z.boolean().optional().default(false),
})

export const DaemonDiffCommentSchema = z.object({
	id: z.uuid(),
	truncatedId: z.string().length(12),
	createdByUserId: z.string(),
	createdByAgent: z.boolean(),
	contentText: z.string(),
	isDeleted: z.boolean(),
})

export const DaemonDiffCommentThreadSchema = z.object({
	root: DaemonDiffCommentSchema,
	replies: z.array(DaemonDiffCommentSchema),
	anchor: DiffCommentAnchorSchema,
	isResolved: z.boolean(),
})

export const GetDiffCommentsOutputSchema = z.object({
	comments: z.array(DaemonDiffCommentThreadSchema),
})

export const getDiffCommentsContract = contractBuilder
	.input(GetDiffCommentsInputSchema)
	.output(GetDiffCommentsOutputSchema)
