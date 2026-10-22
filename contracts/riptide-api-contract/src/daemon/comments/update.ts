import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'

export const UpdateCommentInputSchema = z.object({
	taskId: z.uuid(),
	artifactFilename: z.string(),
	truncatedCommentIds: z.array(z.string().min(8).max(12)).min(1).describe('Truncated comment IDs to update'),
	resolved: z.boolean().optional().describe('Set resolved state'),
	deleted: z.boolean().optional().describe('Set deleted state'),
})

export const UpdateCommentOutputSchema = z.object({
	success: z.boolean(),
	updated: z.array(
		z.object({
			truncatedId: z.string(),
			commentId: z.uuid(),
		}),
	),
	failed: z.array(
		z.object({
			truncatedId: z.string(),
			reason: z.enum(['not_found', 'ambiguous']),
		}),
	),
	transactionId: z.string().describe('Postgres transaction ID for sync verification'),
})

export const UpdateArtifactNotFoundDataSchema = z.object({
	validArtifacts: z.array(z.string()),
})

export const updateCommentContract = contractBuilder.input(UpdateCommentInputSchema).output(UpdateCommentOutputSchema)
