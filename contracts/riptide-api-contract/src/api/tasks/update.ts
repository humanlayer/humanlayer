import { RESOLVED_TASK_WORKFLOW_TYPES } from '@humanlayer/schemas/effect/taskconfiguration'
import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'
import { TicketProviderSchema } from '../../lib/ticket-provider'

export const UpdateTaskInputSchema = z.object({
	taskId: z.uuidv7().describe('The task ID to update'),
	name: z.string().min(1).optional().describe('New name for the task'),
	slug: z.string().min(1).optional().describe('Task slug (immutable once set)'),
	defaultWorkingDirectory: z.string().optional().describe('Default working directory for new sessions'),
	// New setup fields
	setupStatus: z.enum(['pending', 'in_progress', 'completed', 'failed']).optional().describe('Setup status'),
	setupDetails: z.string().optional().describe('Setup error message or status info'),
	// Ticket fields (for draft updates)
	ticketId: z.string().nullable().optional().describe('Provider ticket ID; null clears it'),
	ticketDescription: z.string().optional().describe('Manual task description'),
	ticketProvider: TicketProviderSchema.nullable().optional().describe('Ticket provider; null clears it'),
	githubConnectionId: z.uuid().nullable().optional().describe('GitHub connection selected for this task'),
	ticketRepositoryId: z.string().regex(/^\d+$/).nullable().optional().describe('Stable GitHub repository ID'),
	ticketRepositoryFullName: z
		.string()
		.min(1)
		.nullable()
		.optional()
		.describe('GitHub owner/repository display snapshot'),
	// Workflow automation
	workflowType: z.enum(RESOLVED_TASK_WORKFLOW_TYPES).optional().describe('Workflow type for this task (owner-only)'),
	autoAdvanceQuestionsToResearch: z.boolean().optional().describe('Auto-advance from research-questions to research'),
	autoAdvanceResearchToDesign: z.boolean().optional().describe('Auto-advance from research to design-discussion'),
	autoAdvancePlanToWorktree: z.boolean().optional().describe('Auto-advance from plan to worktree setup'),
	autoAdvanceWorktreeToImplementation: z
		.boolean()
		.optional()
		.describe('Auto-advance from worktree setup to implementation'),
	autoAdvanceImplementationToPr: z
		.boolean()
		.optional()
		.describe('Auto-advance from implementation to PR description'),
	// Task-level Slack mute (owner-only). Gates owner-filtered Slack notification automations for this task.
	slackNotificationsMuted: z.boolean().optional().describe('Mute owner-filtered Slack notifications for this task'),
})

export const UpdateTaskOutputSchema = z.object({
	transactionId: z.string(),
	success: z.boolean(),
})

export const updateTaskContract = contractBuilder.input(UpdateTaskInputSchema).output(UpdateTaskOutputSchema)
