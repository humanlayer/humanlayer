import { taskSelectSchema } from '@humanlayer/db/tables/tasks'
import { TASK_WORKFLOW_TYPES, WORKTREE_TIMINGS } from '@humanlayer/schemas/effect/taskconfiguration'
import { WorkspaceSetupStateSchema, WorkspaceSpecSchema, WorkspaceStateSchema } from '@humanlayer/schemas/zod/workspace'
import { StatusCodes } from 'http-status-codes'
import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'
import { safeSubpathSchema } from '../../lib/filename-validation'
import { TicketProviderSchema } from '../../lib/ticket-provider'
import { CodingAgentSchema, PermissionsModeSchema } from '../sessions/launch'
import { CreatedWithExperimentFlagsSchema } from './experiment-flags'

export const CREATE_TASK_MAX_ATTACHMENTS = 50
export const CREATE_TASK_MAX_ATTACHMENT_SIZE_BYTES = 50 * 1024 * 1024

export const CreateTaskAttachmentInputSchema = z.object({
	fileName: safeSubpathSchema.describe('Task-relative path for the uploaded attachment'),
	contentType: z.string().trim().min(1).max(255).describe('MIME type of the uploaded attachment'),
	fileSizeBytes: z.number().int().min(0).max(CREATE_TASK_MAX_ATTACHMENT_SIZE_BYTES),
	contentHash: z
		.string()
		.regex(/^[0-9a-f]{64}$/)
		.describe('Lowercase SHA-256 digest of the attachment bytes'),
})

export const CreateTaskFirstSessionInputSchema = z.object({
	id: z.uuidv7().optional().describe('Optional session identity for legacy clients'),
	eventId: z.uuidv7().optional().describe('Optional first event identity for legacy clients'),
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
})

const TaskWorkspaceAndWorkflowConfigurationShape = {
	name: z.string().min(1).describe('The name/title of the task'),
	defaultWorkingDirectory: z.string().optional().describe('Default working directory for sessions in this task'),
	workspaceState: WorkspaceStateSchema.optional().describe(
		'Point-in-time workspace snapshot for worktree:now tasks (repos, descriptions, refs, branches, primary)',
	),
	workspaceSpec: WorkspaceSpecSchema.optional().describe('Portable desired workspace setup for any host'),
	workspaceSetupState: WorkspaceSetupStateSchema.optional().describe(
		'Finished setup ledger supplied only when the client already materialized the workspace',
	),
	localWorkspaceBaseDirectory: z
		.string()
		.optional()
		.describe(
			"Expanded absolute workspace root on the creator's machine, recorded in their task_user_settings row",
		),
	hostId: z.string().optional().describe("Host ID of the creator's machine where the workspace was materialized"),
	setupStatus: z.enum(['pending', 'in_progress', 'completed', 'failed']).optional().describe('Initial setup status'),
	workflowType: z.enum(TASK_WORKFLOW_TYPES).optional().describe('Workflow type selected for this task'),
	worktreeTiming: z.enum(WORKTREE_TIMINGS).optional().describe('Worktree timing selected for this task'),
	autoAdvanceQuestionsToResearch: z
		.boolean()
		.optional()
		.describe('Auto-advance from research-questions to research on session completion'),
	autoAdvanceResearchToDesign: z
		.boolean()
		.optional()
		.describe('Auto-advance from research to design-discussion on session completion'),
	autoAdvancePlanToWorktree: z
		.boolean()
		.optional()
		.describe('Auto-advance from plan to worktree setup on session completion'),
	autoAdvanceWorktreeToImplementation: z
		.boolean()
		.optional()
		.describe('Auto-advance from worktree setup to implementation on session completion'),
	autoAdvanceImplementationToPr: z
		.boolean()
		.optional()
		.describe('Auto-advance from implementation to PR description on session completion'),
} as const

function validateWorkspaceAndWorktreeTiming(
	input: { workspaceSpec?: unknown; worktreeTiming?: 'now' | 'later' | 'never' },
	context: z.core.$RefinementCtx,
) {
	if (input.workspaceSpec && input.worktreeTiming !== undefined && input.worktreeTiming !== 'now') {
		context.addIssue({
			code: 'custom',
			path: ['worktreeTiming'],
			message: 'Worktree timing must be now when a workspace spec is provided',
		})
	}
}

export const TaskWorkspaceAndWorkflowConfigurationSchema = z
	.object(TaskWorkspaceAndWorkflowConfigurationShape)
	.superRefine(validateWorkspaceAndWorktreeTiming)
export type TaskWorkspaceAndWorkflowConfiguration = z.infer<typeof TaskWorkspaceAndWorkflowConfigurationSchema>

export const CreateTaskInputSchema = z
	.object({
		id: z
			.uuidv7()
			.optional()
			.describe("Stable client-generated task identity; may identify the caller's existing draft for promotion"),
		...TaskWorkspaceAndWorkflowConfigurationShape,
		slug: z.string().optional().describe('URL-friendly slug for the task'),
		ticketContent: z
			.string()
			.optional()
			.describe('Inline ticket.md content for V2 clients; ignored when a ticket provider import is requested'),
		taskContent: z
			.string()
			.optional()
			.describe(
				'V3 composer prompt written to task.md. Combined with a provider-named ticket artifact reference when a ticket is attached',
			),
		ticketArtifactName: z
			.enum(['ticket.md', 'task.md'])
			.default('ticket.md')
			.describe('Canonical task input artifact name; omitted clients retain ticket.md'),
		firstSession: CreateTaskFirstSessionInputSchema.optional().describe(
			'Optional first session created atomically with the task',
		),
		ticketId: z.string().optional().describe('Provider ticket ID or issue input for import mode'),
		ticketUrl: z.string().optional().describe('Canonical provider ticket URL for import mode'),
		ticketDescription: z.string().optional().describe('Manual task description'),
		ticketProvider: TicketProviderSchema.optional().describe('Ticket provider for this task'),
		githubConnectionId: z.uuid().optional().describe('GitHub connection selected for this task import'),
		ticketRepositoryId: z.string().regex(/^\d+$/).optional().describe('Stable GitHub repository ID'),
		ticketRepositoryFullName: z.string().min(1).optional().describe('GitHub owner/repository display snapshot'),
		createdWithExperimentFlags: CreatedWithExperimentFlagsSchema.optional().describe(
			'Experiment assignment and task composer used when this task was created',
		),
		attachments: z
			.array(CreateTaskAttachmentInputSchema)
			.max(CREATE_TASK_MAX_ATTACHMENTS)
			.optional()
			.describe('Files uploaded directly to server-derived future-task S3 paths'),
	})
	.superRefine((input, context) => {
		validateWorkspaceAndWorktreeTiming(input, context)

		if (input.ticketProvider && !input.ticketId?.trim()) {
			context.addIssue({
				code: 'custom',
				path: ['ticketId'],
				message: `${input.ticketProvider} ticket ID is required`,
			})
		}

		const hasGitHubRepositoryIdentity =
			input.githubConnectionId !== undefined ||
			input.ticketRepositoryId !== undefined ||
			input.ticketRepositoryFullName !== undefined
		if (input.ticketProvider !== 'github') {
			if (hasGitHubRepositoryIdentity) {
				context.addIssue({
					code: 'custom',
					path: ['ticketProvider'],
					message: 'GitHub repository identity requires ticketProvider github',
				})
			}
			return
		}

		if (!input.githubConnectionId) {
			context.addIssue({
				code: 'custom',
				path: ['githubConnectionId'],
				message: 'GitHub connection is required',
			})
		}
		if (!input.ticketRepositoryId) {
			context.addIssue({
				code: 'custom',
				path: ['ticketRepositoryId'],
				message: 'GitHub repository is required',
			})
		}
	})

export const CreateTaskOutputSchema = z.discriminatedUnion('result', [
	z.object({
		result: z.literal('created'),
		transactionId: z.string(),
		task: taskSelectSchema,
		firstSessionId: z.uuid().nullable(),
	}),
	z.object({
		result: z.literal('already-exists'),
		transactionId: z.string(),
		task: taskSelectSchema,
		firstSessionId: z.uuid().nullable(),
	}),
])

export const TaskSlugConflictDataSchema = z.object({ slug: z.string(), message: z.string() })

export const createTaskContract = contractBuilder
	.input(CreateTaskInputSchema)
	.output(CreateTaskOutputSchema)
	.errors({
		TASK_IDENTITY_CONFLICT: {
			status: StatusCodes.CONFLICT,
			data: z.object({ taskId: z.uuidv7() }),
		},
		TASK_SLUG_CONFLICT: {
			status: StatusCodes.CONFLICT,
			data: TaskSlugConflictDataSchema,
		},
	})
