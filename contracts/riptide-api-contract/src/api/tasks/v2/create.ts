import { TASK_WORKFLOW_TYPES } from '@humanlayer/schemas/effect/taskconfiguration'
import { TaskIntentSchema } from '@humanlayer/schemas/task-intent'
import { WorkspaceRepositoriesSchema } from '@humanlayer/schemas/zod/project-workspace'
import { StatusCodes } from 'http-status-codes'
import z from 'zod/v4'

import { contractBuilder } from '../../../contract-builder'
import { isSafeTaskWorkspacePathSegment } from '../../../lib/task-workspace-path'
import { TicketProviderSchema } from '../../../lib/ticket-provider'
import { CodingAgentSchema, PermissionsModeSchema } from '../../sessions/launch'
import { CreatedWithExperimentFlagsSchema } from '../experiment-flags'
import { LaunchTaskDraftAttachmentInputSchema } from '../launch-draft'

export const CreateTaskV2FirstSessionInputSchema = z.object({
	id: z.uuidv7().optional(),
	eventId: z.uuidv7().optional(),
	title: z.string().nullable().default(null),
	text: z.string().min(1),
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
 * Project-backed task creation. The workspace, task, first session, and
 * per-repository setup rows commit in one transaction. Task metadata mirrors
 * the legacy `tasks.launchDraft` fields so V2 tasks keep workflow, ticket,
 * and attachment parity; the working directory is derived server-side from
 * remembered user-host repository locations rather than supplied by the caller.
 */
export const CreateTaskV2InputSchema = z
	.object({
		taskId: z.uuidv7(),
		workspaceId: z.uuidv7(),
		sessionId: z.uuidv7().optional(),
		eventId: z.uuidv7().optional(),
		projectId: z.uuidv7(),
		name: z.string().min(1),
		slug: z
			.string()
			.trim()
			.min(1)
			.max(100)
			.refine(isSafeTaskWorkspacePathSegment, { message: 'Slug must be safe as one path segment' }),
		repositories: WorkspaceRepositoriesSchema,
		defaultRepositoryIdentity: z.string().min(1).optional(),
		taskContent: z.string().default(''),
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
		autoAdvanceQuestionsToResearch: z.boolean().default(false),
		autoAdvanceResearchToDesign: z.boolean().default(false),
		autoAdvancePlanToWorktree: z.boolean().default(false),
		autoAdvanceWorktreeToImplementation: z.boolean().default(false),
		autoAdvanceImplementationToPr: z.boolean().default(false),
		createdWithExperimentFlags: CreatedWithExperimentFlagsSchema.optional(),
		attachments: z.array(LaunchTaskDraftAttachmentInputSchema).max(50).default([]),
		firstSession: CreateTaskV2FirstSessionInputSchema,
	})
	.refine(
		(input) => {
			if (!input.defaultRepositoryIdentity) return true
			return input.repositories.some(
				(repository) => repository.repositoryIdentity === input.defaultRepositoryIdentity,
			)
		},
		{
			path: ['defaultRepositoryIdentity'],
			message: 'defaultRepositoryIdentity must match one of the repositories',
		},
	)
	.superRefine((input, context) => {
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

export type CreateTaskV2Input = z.infer<typeof CreateTaskV2InputSchema>

export const CreateTaskV2OutputSchema = z.discriminatedUnion('result', [
	z.object({
		result: z.literal('created'),
		transactionId: z.string(),
		taskId: z.uuidv7(),
		workspaceId: z.uuidv7(),
		sessionId: z.uuidv7(),
	}),
	z.object({
		result: z.literal('already-exists'),
		transactionId: z.string(),
		taskId: z.uuidv7(),
		workspaceId: z.uuidv7(),
		sessionId: z.uuidv7(),
	}),
])

export const createTaskV2Contract = contractBuilder
	.input(CreateTaskV2InputSchema)
	.output(CreateTaskV2OutputSchema)
	.errors({
		PROJECT_NOT_FOUND: {
			status: StatusCodes.NOT_FOUND,
			data: z.object({ projectId: z.string() }),
		},
		UNSUPPORTED_RECIPE: {
			status: StatusCodes.BAD_REQUEST,
			data: z.object({ message: z.string() }),
		},
		LOCATION_MISSING: {
			status: StatusCodes.BAD_REQUEST,
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
