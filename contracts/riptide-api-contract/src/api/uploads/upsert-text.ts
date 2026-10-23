import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'
import { safeSubpathSchema } from '../../lib/filename-validation'

// 10MB max content size for text artifacts (stored in PostgreSQL)
const MAX_TEXT_CONTENT_BYTES = 10 * 1024 * 1024

export const UpsertTextArtifactInputSchema = z.object({
	taskId: z.uuid().describe('The task to associate this artifact with'),
	fileName: safeSubpathSchema.describe('The file path/name of the artifact'),
	content: z.string().max(MAX_TEXT_CONTENT_BYTES).describe('The full text content of the artifact'),
})

export const UpsertTextArtifactOutputSchema = z.object({
	artifactId: z.uuid(),
	transactionId: z.string(),
	created: z.boolean().describe('True if new artifact was created, false if updated'),
})

export const upsertTextArtifactContract = contractBuilder
	.input(UpsertTextArtifactInputSchema)
	.output(UpsertTextArtifactOutputSchema)
