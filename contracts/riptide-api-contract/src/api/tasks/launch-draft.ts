import { taskSelectSchema } from '@humanlayer/db/tables/tasks'
import { TASK_WORKFLOW_TYPES, WORKTREE_TIMINGS } from '@humanlayer/schemas/effect/taskconfiguration'
import { TaskIntentSchema } from '@humanlayer/schemas/task-intent'
import { WorkspaceSpecSchema } from '@humanlayer/schemas/zod/workspace'
import { StatusCodes } from 'http-status-codes'
import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'
import { safeSubpathSchema } from '../../lib/filename-validation'
import { TicketProviderSchema } from '../../lib/ticket-provider'
import { CodingAgentSchema, PermissionsModeSchema } from '../sessions/launch'
import { CreatedWithExperimentFlagsSchema } from './experiment-flags'

export const LaunchTaskDraftAttachmentInputSchema = z.object({
	fileName: safeSubpathSchema,
	contentType: z.string().trim().min(1).max(255),
	fileSizeBytes: z
		.number()
		.int()
		.min(0)
		.max(50 * 1024 * 1024),
	contentHash: z.string().regex(/^[0-9a-f]{64}$/),
})

export const LaunchTaskDraftFirstSessionInputSchema = z.object({
	id: z.uuidv7().describe('Stable first-session identity generated before submit'),
	eventId: z.uuidv7().describe('Stable initial event identity generated before submit'),
	title: z.string().nullable().default(null),
	text: z.string().min(1),
	workingDirectory: z.string().min(1),
	hostId: z.string().min(1),
	codingAgent: CodingAgentSchema,
	provider: z.string().default('anthropic'),
	model: z.string().default('opus'),
	effort: z.string().nullish(),
	fastMode: z.boolean().nullish(),
	permissionsMode: PermissionsModeSchema,
	intent: TaskIntentSchema.exclude(['unknown'])
		.optional()
		.describe('What the first session does, when the launcher knows; skips the server-side guess'),
})

/**
 * V3-only task launch. `draftId` identifies both a durable task draft and a
 * local-recovery launch; it becomes the final task identity in either case.
 */
export const LaunchTaskDraftInputSchema = z
	.object({
		draftId: z.uuidv7(),
		name: z.string().min(1),
		slug: z.string().min(1),
		defaultWorkingDirectory: z.string().min(1),
		taskContent: z.string(),
		workspaceSpec: WorkspaceSpecSchema.optional(),
		ticketId: z.string().optional(),
		ticketUrl: z.string().optional(),
		ticketDescription: z.string().optional(),
		ticketProvider: TicketProviderSchema.optional(),
		githubConnectionId: z.uuid().optional(),
		ticketRepositoryId: z
			.string()
			.regex(/^[0-9]+$/)
			.optional(),
		ticketRepositoryFullName: z.string().min(1).optional(),
		workflowType: z.enum(TASK_WORKFLOW_TYPES).exclude(['rpi']).default('freeform'),
		worktreeTiming: z.enum(WORKTREE_TIMINGS),
		autoAdvanceQuestionsToResearch: z.boolean(),
		autoAdvanceResearchToDesign: z.boolean(),
		autoAdvancePlanToWorktree: z.boolean(),
		autoAdvanceWorktreeToImplementation: z.boolean(),
		autoAdvanceImplementationToPr: z.boolean(),
		createdWithExperimentFlags: CreatedWithExperimentFlagsSchema.optional(),
		attachments: z.array(LaunchTaskDraftAttachmentInputSchema).max(50).default([]),
		firstSession: LaunchTaskDraftFirstSessionInputSchema,
	})
	.superRefine((input, context) => {
		if (input.workspaceSpec && input.worktreeTiming !== 'now') {
			context.addIssue({
				code: 'custom',
				path: ['worktreeTiming'],
				message: 'Worktree timing must be now when a workspace spec is provided',
			})
		}
		if (input.ticketProvider && !input.ticketId?.trim()) {
			context.addIssue({
				code: 'custom',
				path: ['ticketId'],
				message: `${input.ticketProvider} ticket ID is required`,
			})
		}
		const hasGitHubIdentity =
			input.githubConnectionId !== undefined ||
			input.ticketRepositoryId !== undefined ||
			input.ticketRepositoryFullName !== undefined
		if (input.ticketProvider !== 'github' && hasGitHubIdentity) {
			context.addIssue({
				code: 'custom',
				path: ['ticketProvider'],
				message: 'GitHub repository identity requires ticketProvider github',
			})
		}
		if (input.ticketProvider === 'github' && (!input.githubConnectionId || !input.ticketRepositoryId)) {
			context.addIssue({
				code: 'custom',
				path: ['githubConnectionId'],
				message: 'GitHub connection and repository are required',
			})
		}
	})

export const LaunchTaskDraftOutputSchema = z.object({
	outcome: z.enum(['created', 'promoted', 'already-launched']),
	taskId: z.uuidv7(),
	firstSessionId: z.uuidv7(),
	transactionId: z.string(),
	task: taskSelectSchema,
})

export const TaskLaunchConflictDataSchema = z.object({
	draftId: z.uuidv7(),
	reason: z.enum(['task-id-in-use', 'slug-in-use']),
	message: z.string(),
})

export const launchTaskDraftContract = contractBuilder
	.input(LaunchTaskDraftInputSchema)
	.output(LaunchTaskDraftOutputSchema)
	.errors({
		TASK_LAUNCH_CONFLICT: {
			status: StatusCodes.CONFLICT,
			data: TaskLaunchConflictDataSchema,
		},
	})
