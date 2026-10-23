import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'
import { safeSubpathSchema } from '../../lib/filename-validation'

// 10MB max content size for text artifacts (stored in PostgreSQL)
const MAX_TEXT_CONTENT_BYTES = 10 * 1024 * 1024

export const UpsertArtifactInputSchema = z.object({
	id: z
		.uuidv7()
		.optional()
		.describe(
			'Optional client-generated artifact ID (uuidv7). Server uses this if provided, otherwise generates one.',
		),
	taskId: z.uuid().describe('The task ID to associate this artifact with'),
	fileName: safeSubpathSchema.describe('The file path/name of the artifact'),
	content: z.string().max(MAX_TEXT_CONTENT_BYTES).describe('The full content of the artifact'),
	// Note: contentHash is computed server-side using ohash, not passed by client
	// NEW: for operations log
	sessionId: z.uuid().optional().describe('Session ID if called from a session context'),
	operationType: z
		.enum(['Write', 'Edit', 'MultiEdit', 'Read'])
		.optional()
		.describe('Type of operation that created/updated this artifact'),
	operationContents: z.record(z.string(), z.any()).optional().describe('Raw tool call JSON from agent SDK'),
	frontmatter: z
		.record(z.string(), z.unknown())
		.optional()
		.describe('Parsed YAML frontmatter from the artifact content'),
})

export const UpsertArtifactOutputSchema = z.object({
	artifactId: z.uuid(),
	transactionId: z.string(),
	created: z.boolean().describe('True if new artifact was created, false if updated'),
	versionNumber: z.number().int().optional().describe('Version number if a new version was created'),
	designQuestionsResolved: z
		.boolean()
		.optional()
		.describe('True if a design-discussion artifact has no open design questions'),
})

export const upsertArtifactContract = contractBuilder
	.input(UpsertArtifactInputSchema)
	.output(UpsertArtifactOutputSchema)
