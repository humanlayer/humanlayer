import { permissionsModeSchema } from '@humanlayer/db/tables/sessions'
import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'
import { CodingAgentSchema } from './launch'

export const UpdateSessionApiInputSchema = z.object({
	sessionId: z.uuid(),
	// Optional fields - only provided fields will be updated
	title: z.string().optional(),
	prompt: z.string().optional().describe('The draft prompt/body text'),
	archived: z.boolean().optional(),
	permissionsMode: permissionsModeSchema.optional(),
	taskId: z.uuidv7().nullable().optional().describe('The task to associate with this session'),
	workingDirectory: z.string().optional().describe('The working directory for the session'),
	hostId: z.string().nullable().optional().describe('The host_id of the online host (optional for drafts)'),
	// Strip the `.default('claude')` baked into CodingAgentSchema so an omitted field stays
	// undefined (and is left untouched) instead of clobbering the agent back to 'claude'.
	codingAgent: CodingAgentSchema.removeDefault().optional().describe('The coding agent backend'),
	provider: z.string().optional().describe('The model provider'),
	model: z
		.string()
		.optional()
		.describe('The model to use for this session (e.g., opus, sonnet, haiku, or full model ID)'),
	effort: z.string().nullish().describe('The reasoning effort level'),
	fastMode: z.boolean().nullish().describe('Whether to enable Fast Mode'),
})

export const UpdateSessionApiOutputSchema = z.object({
	success: z.boolean(),
	transactionId: z.string(),
})

export const updateSessionApiContract = contractBuilder
	.input(UpdateSessionApiInputSchema)
	.output(UpdateSessionApiOutputSchema)
