import { sessionSelectSchema } from '@humanlayer/db/tables/sessions'
import { SessionStatusSchema } from '@humanlayer/schemas/zod/session/session-status'
import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'
import { CodingAgentSchema, PermissionsModeSchema } from './launch'

export const CreateSessionInputSchema = z.object({
	id: z.uuidv7().optional().describe('Client-generated session ID for optimistic inserts'),
	taskId: z.uuidv7().nullable().optional().describe('The task to associate with this session'),
	title: z.string().nullable().default(null).describe('The title of the session'),
	prompt: z.string().describe('The session prompt/contents'),
	workingDirectory: z.string().describe('The directory for the session'),
	hostId: z.string().nullable().default(null).describe('The host_id of the online host (optional for drafts)'),
	codingAgent: CodingAgentSchema.describe('The coding agent backend'),
	provider: z.string().default('anthropic').describe('The model provider'),
	model: z.string().default('opus').describe('The model to use'),
	permissionsMode: PermissionsModeSchema.describe('The permissions mode'),
	status: SessionStatusSchema.extract(['draft', 'ready_for_launch'])
		.default('draft')
		.describe('The initial status of the session'),
	updateTaskDefaultWorkingDirectory: z
		.boolean()
		.optional()
		.describe(
			"For non-owner launches: when true, overwrite the user's existing task_user_settings.working_directory with this session's workingDirectory. When false (default), preserve the prior per-user override; new rows are still seeded with this session's workingDirectory.",
		),
})

export const CreateSessionOutputSchema = z.object({
	transactionId: z.string(),
	session: sessionSelectSchema,
})

export const createSessionContract = contractBuilder.input(CreateSessionInputSchema).output(CreateSessionOutputSchema)
