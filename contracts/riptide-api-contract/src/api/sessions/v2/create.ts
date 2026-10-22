import { StatusCodes } from 'http-status-codes'
import z from 'zod/v4'

import { contractBuilder } from '../../../contract-builder'
import { CodingAgentSchema, PermissionsModeSchema } from '../launch'

export const CreateSessionV2InputSchema = z.object({
	sessionId: z.uuidv7().optional(),
	draftId: z.uuidv7().optional().describe('Promote an existing caller-owned draft into this workspace'),
	eventId: z.uuidv7().optional(),
	taskId: z.uuidv7(),
	workspaceId: z.uuidv7(),
	title: z.string().nullable().default(null),
	text: z.string().min(1),
	hostId: z.string().min(1),
	codingAgent: CodingAgentSchema,
	provider: z.string().default('anthropic'),
	model: z.string().default('opus'),
	effort: z.string().nullish(),
	fastMode: z.boolean().nullish(),
	permissionsMode: PermissionsModeSchema,
	defaultRepositoryIdentity: z.string().min(1).optional(),
})

export type CreateSessionV2Input = z.infer<typeof CreateSessionV2InputSchema>

export const CreateSessionV2OutputSchema = z.discriminatedUnion('result', [
	z.object({
		result: z.literal('created'),
		transactionId: z.string(),
		sessionId: z.uuidv7(),
	}),
	z.object({
		result: z.literal('already-exists'),
		transactionId: z.string(),
		sessionId: z.uuidv7(),
	}),
])

export const createSessionV2Contract = contractBuilder
	.input(CreateSessionV2InputSchema)
	.output(CreateSessionV2OutputSchema)
	.errors({
		TASK_NOT_FOUND: {
			status: StatusCodes.NOT_FOUND,
			data: z.object({ taskId: z.string() }),
		},
		WORKSPACE_NOT_FOUND: {
			status: StatusCodes.NOT_FOUND,
			data: z.object({ workspaceId: z.string() }),
		},
		HOST_NOT_AUTHORIZED: {
			status: StatusCodes.FORBIDDEN,
			data: z.object({ message: z.string() }),
		},
		REPOSITORY_SOURCES_REQUIRED: {
			status: StatusCodes.CONFLICT,
			data: z.object({
				projectId: z.string(),
				workspaceId: z.string(),
				hostId: z.string(),
				missingRepositoryIdentities: z.array(z.string()),
			}),
		},
	})
