import { taskSelectSchema } from '@humanlayer/db/tables/tasks'
import { TASK_WORKFLOW_TYPES, WORKTREE_TIMINGS } from '@humanlayer/schemas/effect/taskconfiguration'
import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'
import { TicketProviderSchema } from '../../lib/ticket-provider'

export const SaveTaskDraftInputSchema = z
	.object({
		id: z.uuidv7().describe('Stable client-generated draft identity'),
		name: z.string().min(1),
		slug: z.string().nullable(),
		defaultWorkingDirectory: z.string().nullable(),
		ticketId: z.string().nullable(),
		ticketDescription: z.string().nullable(),
		ticketProvider: TicketProviderSchema.nullable(),
		githubConnectionId: z.uuid().nullable(),
		ticketRepositoryId: z.string().regex(/^\d+$/).nullable(),
		ticketRepositoryFullName: z.string().min(1).nullable(),
		workflowType: z.enum(TASK_WORKFLOW_TYPES),
		worktreeTiming: z.enum(WORKTREE_TIMINGS),
		autoAdvanceQuestionsToResearch: z.boolean(),
		autoAdvanceResearchToDesign: z.boolean(),
		autoAdvancePlanToWorktree: z.boolean(),
		autoAdvanceWorktreeToImplementation: z.boolean(),
		autoAdvanceImplementationToPr: z.boolean(),
	})
	.superRefine((input, context) => {
		const hasConnectionId = input.githubConnectionId !== null
		const hasRepositoryId = input.ticketRepositoryId !== null
		const hasRepositoryFullName = input.ticketRepositoryFullName !== null
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

export const SaveTaskDraftOutputSchema = z.discriminatedUnion('result', [
	z.object({
		result: z.literal('saved'),
		transactionId: z.string(),
		task: taskSelectSchema,
	}),
	z.object({ result: z.literal('draft-id-unavailable') }),
])

export const saveTaskDraftContract = contractBuilder.input(SaveTaskDraftInputSchema).output(SaveTaskDraftOutputSchema)
