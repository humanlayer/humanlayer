import { taskSelectSchema } from '@humanlayer/db/tables/tasks'
import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'
import { TicketProviderSchema } from '../../lib/ticket-provider'

export const CreateTaskDraftInputSchema = z
	.object({
		id: z.uuidv7().optional().describe('Client-generated task ID for optimistic inserts'),
		name: z.string().optional().describe('The name/title of the task (optional for drafts)'),
		slug: z.string().optional().describe('URL-friendly slug for the task'),
		defaultWorkingDirectory: z.string().optional().describe('Default working directory for sessions in this task'),
		ticketId: z.string().optional().describe('Provider ticket ID for import mode'),
		ticketDescription: z.string().optional().describe('Manual task description'),
		ticketProvider: TicketProviderSchema.optional().describe('Ticket provider for this task'),
		githubConnectionId: z.uuid().nullable().optional().describe('GitHub connection selected for this draft'),
		ticketRepositoryId: z.string().regex(/^\d+$/).nullable().optional().describe('Stable GitHub repository ID'),
		ticketRepositoryFullName: z
			.string()
			.min(1)
			.nullable()
			.optional()
			.describe('GitHub owner/repository display snapshot'),
	})
	.superRefine((input, context) => {
		const hasConnectionId = input.githubConnectionId !== undefined && input.githubConnectionId !== null
		const hasRepositoryId = input.ticketRepositoryId !== undefined && input.ticketRepositoryId !== null
		const hasRepositoryFullName = input.ticketRepositoryFullName != null
		if (input.ticketProvider !== 'github' && (hasConnectionId || hasRepositoryId || hasRepositoryFullName)) {
			context.addIssue({
				code: 'custom',
				path: ['ticketProvider'],
				message: 'GitHub repository identity requires ticketProvider github',
			})
		}
		if (hasConnectionId !== hasRepositoryId) {
			context.addIssue({
				code: 'custom',
				path: [hasConnectionId ? 'ticketRepositoryId' : 'githubConnectionId'],
				message: 'GitHub connection and repository ID must be saved together',
			})
		}
		if (hasRepositoryFullName && !hasRepositoryId) {
			context.addIssue({
				code: 'custom',
				path: ['ticketRepositoryId'],
				message: 'GitHub repository display name requires canonical repository identity',
			})
		}
	})

export const CreateTaskDraftOutputSchema = z.object({
	transactionId: z.string(),
	task: taskSelectSchema,
})

export const createTaskDraftContract = contractBuilder
	.input(CreateTaskDraftInputSchema)
	.output(CreateTaskDraftOutputSchema)
