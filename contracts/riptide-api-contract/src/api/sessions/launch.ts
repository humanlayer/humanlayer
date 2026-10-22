import { permissionsModeSchema, sessionSelectSchema } from '@humanlayer/db/tables/sessions'
import { CodingAgentZodSchema } from '@humanlayer/schemas/coding-agent'
import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'

export const PermissionsModeSchema = permissionsModeSchema.default('default')

export const CodingAgentSchema = CodingAgentZodSchema.default('claude')

export const LaunchSessionInputSchema = z.object({
	id: z.uuidv7().optional().describe('Client-generated session ID for optimistic inserts (new sessions only)'),
	eventId: z.uuidv7().optional().describe('Client-generated event ID for optimistic inserts'),
	draftId: z.uuidv7().optional().describe('Optional ID of an existing draft session to launch'),
	taskId: z.uuidv7().nullable().optional().describe('The task to associate with this session'),
	text: z.string().describe('the session contents'),
	title: z.string().nullable().default(null).describe('The title of the session'),
	workingDirectory: z
		.string()
		.trim()
		.min(1, 'Working directory is required')
		.describe('The directory to launch the session in'),
	repositoryDirectory: z
		.string()
		.trim()
		.min(1, 'Repository directory is required')
		.optional()
		.describe('Existing checkout path, or common source directory for a multi-repository task'),
	hostId: z.string().describe('The host_id of the online host to launch the session on'),
	codingAgent: CodingAgentSchema.describe('The coding agent backend'),
	provider: z.string().default('anthropic').describe('The model provider'),
	model: z.string().default('opus').describe('The model to use for the session'),
	effort: z
		.string()
		.nullish()
		.describe('The reasoning effort level (e.g. low, medium, high, xhigh, max for Claude or Codex)'),
	fastMode: z.boolean().nullish().describe('Whether to enable Fast Mode (priority tier routing)'),
	permissionsMode: PermissionsModeSchema.describe('The permissions mode for the session'),
	updateTaskDefaultWorkingDirectory: z
		.boolean()
		.optional()
		.describe(
			"For non-owner launches: when true, overwrite the user's existing task_user_settings.working_directory with this session's workingDirectory. When false (default), preserve the prior per-user override; new rows are still seeded with this session's workingDirectory.",
		),
})

export const LaunchSessionOutputSchema = z.object({
	transactionId: z.string(),
	session: sessionSelectSchema,
})

export const launchSessionContract = contractBuilder.input(LaunchSessionInputSchema).output(LaunchSessionOutputSchema)
