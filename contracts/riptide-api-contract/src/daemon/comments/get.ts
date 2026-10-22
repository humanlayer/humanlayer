import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'

export const GetCommentsInputSchema = z.object({
	taskId: z.uuid(),
	artifactFilename: z.string(),
	includeResolved: z.boolean().optional().default(false),
})

const CommentSchema = z.object({
	id: z.uuid(),
	truncatedId: z.string(),
	userName: z.string().describe('Display name of the comment author'),
	isResolved: z.boolean(),
	createdByAgent: z.boolean(),
	contentText: z.string(),
	/** The block of text this comment is anchored to */
	quotedText: z.string().nullable(),
	/** Block before the quoted text for context */
	previousBlockText: z.string().nullable(),
	/** Block after the quoted text for context */
	nextBlockText: z.string().nullable(),
	replyToCommentId: z.uuid().nullable(),
})

export const GetCommentsOutputSchema = z.object({
	artifactFilename: z.string(),
	comments: z.array(CommentSchema),
})

export const ArtifactNotFoundDataSchema = z.object({
	validArtifacts: z.array(z.string()),
})

export const getCommentsContract = contractBuilder.input(GetCommentsInputSchema).output(GetCommentsOutputSchema)
