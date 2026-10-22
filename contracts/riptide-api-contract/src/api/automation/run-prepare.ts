import { StatusCodes } from 'http-status-codes'
import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'
import { CodingAgentSchema, PermissionsModeSchema } from '../sessions/launch'
import { TaskWorkspaceAndWorkflowConfigurationSchema } from '../tasks/create'

const AutomationTargetSessionSchema = z.object({
	hostId: z.uuid(),
	sessionName: z.string().trim().min(1),
	prompt: z.string().min(1),
	workingDirectory: z.string().trim().min(1),
	codingAgent: CodingAgentSchema.default('codelayer'),
	provider: z.string().default('anthropic'),
	model: z.string().default('opus'),
	effort: z.string().nullish(),
	fastMode: z.boolean().nullish(),
	permissionsMode: PermissionsModeSchema.default('bypass'),
})

const AutomationTaskSelectorSchema = z.discriminatedUnion('taskMode', [
	z.object({
		taskMode: z.literal('ensure'),
		slug: z.string().trim().min(1),
		task: TaskWorkspaceAndWorkflowConfigurationSchema,
	}),
	z.object({
		taskMode: z.literal('use'),
		taskIdOrSlug: z.string().trim().min(1),
	}),
])

export const AutomationRunPrepareInputSchema = AutomationTaskSelectorSchema.and(AutomationTargetSessionSchema)

export const AutomationRunPrepareOutputSchema = z.object({
	taskId: z.uuid(),
	userId: z.string(),
	hostId: z.uuid(),
	sessionId: z.uuid(),
})

export const automationRunPrepareContract = contractBuilder
	.input(AutomationRunPrepareInputSchema)
	.output(AutomationRunPrepareOutputSchema)
	.errors({
		AUTOMATION_PREPARATION_BUSY: {
			status: StatusCodes.SERVICE_UNAVAILABLE,
			data: z.object({ retryAfterSeconds: z.literal(1) }),
		},
	})
