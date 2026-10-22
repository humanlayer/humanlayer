import type { CreatedWithExperimentFlags } from '@humanlayer/riptide-api-contract/api/tasks/experiment-flags'
import { CreatedWithExperimentFlagsSchema } from '@humanlayer/riptide-api-contract/api/tasks/experiment-flags'
import { safeSubpathSchema } from '@humanlayer/riptide-api-contract/lib/filename-validation'
import { LaunchableCodingAgentZodSchema } from '@humanlayer/schemas/coding-agent'
import {
	RESOLVED_TASK_WORKFLOW_TYPES,
	WORKTREE_TIMINGS,
	type ResolvedTaskWorkflowType,
	type TaskAutoAdvanceFlags,
} from '@humanlayer/schemas/effect/taskconfiguration'
import type { WorkspaceSpec } from '@humanlayer/schemas/effect/workspace'
import { SelectableModelProviderZodSchema } from '@humanlayer/schemas/model-provider'
import type { WorkspaceRepositories } from '@humanlayer/schemas/zod/project-workspace'
import { PERMISSION_MODES } from '@humanlayer/ui/constants/permission-modes'
import type { Content, JSONContent } from '@tiptap/core'
import * as z from 'zod'

import { describeHostLaunchBlocker, type HostLaunchTarget } from '@/lib/host-state'
import { truncateTaskSlug } from '@/lib/task-slug'
import { getTextFromContent } from '@/utils/tiptap-content'

import { DEFAULT_RESOLVED_TASK_WORKFLOW, projectTaskAutoAdvanceFlags } from './launcher-v3-workflow'
import type { LauncherV3WorkspaceLaunchTarget } from './launcher-v3-workspace'

const agentSchema = LaunchableCodingAgentZodSchema
const providerSchema = SelectableModelProviderZodSchema
const permissionModeSchema = z.enum(PERMISSION_MODES)
const effortSchema = z.string().min(1)

const jsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
	z.union([
		z.string(),
		z.number(),
		z.boolean(),
		z.null(),
		z.array(jsonValueSchema),
		z.record(z.string(), jsonValueSchema),
	]),
)

const tiptapMarkSchema = z.object({
	type: z.string().min(1),
	attrs: z.record(z.string(), jsonValueSchema).optional(),
})

const tiptapNodeSchema: z.ZodType<JSONContent> = z.lazy(() =>
	z
		.object({
			type: z.string().min(1).optional(),
			attrs: z.record(z.string(), jsonValueSchema).optional(),
			marks: z.array(tiptapMarkSchema).optional(),
			text: z.string().optional(),
			content: z.array(tiptapNodeSchema).optional(),
		})
		.refine((node) => node.type !== undefined || node.text !== undefined, 'TipTap nodes need a type or text'),
)

const promptSchema: z.ZodType<Content> = z.union([z.string(), tiptapNodeSchema, z.array(tiptapNodeSchema)])

const githubRepositorySchema = z.object({
	connectionId: z.string().min(1),
	repositoryId: z.string().min(1),
	fullName: z.string().regex(/^[^/\s]+\/[^/\s]+$/),
	accountLogin: z.string().min(1),
	private: z.boolean(),
	archived: z.boolean(),
})

export const LAUNCHER_V3_TICKET_PROVIDERS = ['linear', 'jira', 'github'] as const

/** One resolved, attachable ticket. `name`/`slug` carry the lookup-derived identity. */
export const launcherV3TicketSchema = z
	.object({
		provider: z.enum(LAUNCHER_V3_TICKET_PROVIDERS),
		ticketId: z.string().min(1),
		name: z.string().default(''),
		slug: z.string().default(''),
		url: z.string().nullable().default(null),
		githubRepository: githubRepositorySchema.nullable().default(null),
	})
	.refine(
		(ticket) => ticket.provider !== 'github' || ticket.githubRepository !== null,
		'GitHub tickets need their repository identity',
	)

export type LauncherV3TicketAttachment = z.infer<typeof launcherV3TicketSchema>
export type LauncherV3TicketProvider = LauncherV3TicketAttachment['provider']
export type LauncherV3GitHubRepository = NonNullable<LauncherV3TicketAttachment['githubRepository']>

/** Stable, finalized file-attachment reference stored in React Hook Form. */
export const launcherV3FormAttachmentSchema = z.object({
	fileName: safeSubpathSchema,
	contentType: z.string().min(1),
	fileSizeBytes: z.number().int().min(0),
	contentHash: z.string().regex(/^[0-9a-f]{64}$/),
})

export type LauncherV3FormAttachment = z.infer<typeof launcherV3FormAttachmentSchema>

export const launcherV3FormSchema = z.object({
	prompt: promptSchema.nullable().default(null),
	ticket: launcherV3TicketSchema.nullable().default(null),
	title: z.string().default(''),
	slug: z.string().default(''),
	hostId: z.string().nullable().default(null),
	directory: z.string().default(''),
	/** A V2 project selected in place of a bare working directory. */
	projectId: z.string().nullable().default(null),
	projectDefaultRepositoryIdentity: z.string().nullable().default(null),
	permissionsMode: permissionModeSchema.default('auto'),
	agent: agentSchema.default('claude'),
	provider: providerSchema.default('anthropic'),
	model: z.string().min(1).default('opus'),
	effort: effortSchema.nullable().default(null),
	fastMode: z.boolean().default(false),
	workflowType: z.enum(RESOLVED_TASK_WORKFLOW_TYPES).default(DEFAULT_RESOLVED_TASK_WORKFLOW.workflowType),
	autoAdvance: z.boolean().default(DEFAULT_RESOLVED_TASK_WORKFLOW.autoAdvance),
	workflowPresentation: z.enum(['named', 'task-size']).default('named'),
	graphRevealed: z.boolean().default(false),
	worktreeTiming: z.enum(WORKTREE_TIMINGS).default('later'),
	workspaceSnapshotDirectory: z.string().nullable().default(null),
	excludedRepositoryLocalPaths: z.array(z.string()).default([]),
	defaultLaunchRepositoryLocalPath: z.string().nullable().default(null),
	attachments: z.array(launcherV3FormAttachmentSchema).default([]),
	createdWithExperimentFlags: CreatedWithExperimentFlagsSchema.nullable().default(null),
})

export type LauncherV3FormValues = z.infer<typeof launcherV3FormSchema>

export const LAUNCHER_V3_DRAFT_VERSION = 1 as const

export const launcherV3DraftValuesSchema = launcherV3FormSchema.omit({
	createdWithExperimentFlags: true,
})

export type LauncherV3DraftValues = z.infer<typeof launcherV3DraftValuesSchema>

export interface PersistedLauncherV3Draft {
	version: typeof LAUNCHER_V3_DRAFT_VERSION
	durable: {
		name: string
		slug?: string
		defaultWorkingDirectory?: string
		ticketDescription?: string
		ticketProvider?: LauncherV3TicketProvider
		ticketId?: string
		githubConnectionId?: string
		ticketRepositoryId?: string
		ticketRepositoryFullName?: string
		workflowType: ResolvedTaskWorkflowType
		worktreeTiming: LauncherV3FormValues['worktreeTiming']
		autoAdvanceQuestionsToResearch: boolean
		autoAdvanceResearchToDesign: boolean
		autoAdvancePlanToWorktree: boolean
		autoAdvanceWorktreeToImplementation: boolean
		autoAdvanceImplementationToPr: boolean
	}
	local: LauncherV3DraftValues
}

export function createLauncherV3DefaultValues(values: Partial<LauncherV3FormValues> = {}): LauncherV3FormValues {
	return launcherV3FormSchema.parse(values)
}

function nonBlank(value: string): boolean {
	return value.trim().length > 0
}

function dedupeAttachments(attachments: LauncherV3FormAttachment[]): LauncherV3FormAttachment[] {
	const seen = new Set<string>()
	return attachments.flatMap((attachment) => {
		if (seen.has(attachment.fileName)) return []
		seen.add(attachment.fileName)
		return [{ ...attachment }]
	})
}

export function toLauncherV3DraftValues(values: LauncherV3FormValues): LauncherV3DraftValues {
	return launcherV3DraftValuesSchema.parse(values)
}

/** Split the reduced PR 2 form into task-row fields and versioned browser extras. */
export function toPersistedLauncherV3Draft(values: LauncherV3FormValues): PersistedLauncherV3Draft {
	const promptText = getTextFromContent(values.prompt).trim()
	const github = values.ticket?.githubRepository ?? null
	const autoAdvanceFlags = projectTaskAutoAdvanceFlags(
		{ workflowType: values.workflowType, autoAdvance: values.autoAdvance },
		values.worktreeTiming,
	)
	const durable: PersistedLauncherV3Draft['durable'] = {
		name: values.title.trim(),
		workflowType: values.workflowType,
		worktreeTiming: values.worktreeTiming,
		autoAdvanceQuestionsToResearch: autoAdvanceFlags.autoAdvanceQuestionsToResearch,
		autoAdvanceResearchToDesign: autoAdvanceFlags.autoAdvanceResearchToDesign,
		autoAdvancePlanToWorktree: autoAdvanceFlags.autoAdvancePlanToWorktree,
		autoAdvanceWorktreeToImplementation: autoAdvanceFlags.autoAdvanceWorktreeToImplementation,
		autoAdvanceImplementationToPr: autoAdvanceFlags.autoAdvanceImplementationToPr,
	}
	if (nonBlank(values.slug)) durable.slug = values.slug.trim()
	if (nonBlank(values.directory) && !values.projectId) {
		durable.defaultWorkingDirectory = values.directory.trim()
	}
	if (promptText) durable.ticketDescription = promptText
	if (values.ticket) {
		durable.ticketProvider = values.ticket.provider
		durable.ticketId = values.ticket.ticketId.trim()
	}
	if (github) {
		durable.githubConnectionId = github.connectionId
		durable.ticketRepositoryId = github.repositoryId
		durable.ticketRepositoryFullName = github.fullName
	}

	return {
		version: LAUNCHER_V3_DRAFT_VERSION,
		durable,
		local: { ...toLauncherV3DraftValues(values), attachments: dedupeAttachments(values.attachments) },
	}
}

/** User work worth recovering or saving as a server draft. */
export function launcherV3DraftIsMeaningful(values: LauncherV3FormValues): boolean {
	return (
		nonBlank(values.title) ||
		nonBlank(getTextFromContent(values.prompt)) ||
		values.ticket !== null ||
		values.attachments.length > 0
	)
}

function touchedProjection(values: LauncherV3FormValues): LauncherV3DraftValues & { promptText: string } {
	return {
		...toLauncherV3DraftValues(values),
		prompt: null,
		promptText: getTextFromContent(values.prompt).trim(),
	}
}

/** Derived change state. Returning to the baseline returns to untouched. */
export function isLauncherV3Touched(values: LauncherV3FormValues, baseline: LauncherV3FormValues): boolean {
	return JSON.stringify(touchedProjection(values)) !== JSON.stringify(touchedProjection(baseline))
}

export type LauncherV3LaunchBlocker =
	| { code: 'no-host'; label: string }
	| { code: 'host-unavailable'; label: string }
	| { code: 'no-directory'; label: string }
	| { code: 'no-prompt'; label: string }
	| { code: 'no-title'; label: string }
	| { code: 'no-slug'; label: string }
	| { code: 'no-model'; label: string }

export type LauncherV3LaunchReadiness =
	| { canLaunch: true; blockedReason: null }
	| { canLaunch: false; blockedReason: LauncherV3LaunchBlocker }

function getHostLaunchBlocker(
	hostId: string | null | undefined,
	host: HostLaunchTarget | null,
): LauncherV3LaunchBlocker | null {
	if (!nonBlank(hostId ?? '')) return { code: 'no-host', label: 'Connect a host to launch' }
	const hostBlocker = host ? describeHostLaunchBlocker(host) : null
	return hostBlocker ? { code: 'host-unavailable', label: hostBlocker } : null
}

function getFormLaunchBlocker(values: LauncherV3FormValues): LauncherV3LaunchBlocker | null {
	if (!values.projectId && !nonBlank(values.directory)) {
		return { code: 'no-directory', label: 'Choose a project or working directory' }
	}
	if (!nonBlank(getTextFromContent(values.prompt)) && values.ticket === null) {
		return { code: 'no-prompt', label: 'Describe the task or attach a ticket' }
	}
	if (!nonBlank(values.title)) return { code: 'no-title', label: 'Waiting for a task title' }
	if (!nonBlank(values.slug)) return { code: 'no-slug', label: 'Waiting for a task slug' }
	if (!nonBlank(values.model)) return { code: 'no-model', label: 'Select a model' }
	return null
}

export function getLaunchReadiness(
	values: LauncherV3FormValues,
	host: HostLaunchTarget | null = null,
): LauncherV3LaunchReadiness {
	const blockedReason = getHostLaunchBlocker(values.hostId, host) ?? getFormLaunchBlocker(values)
	return blockedReason ? { canLaunch: false, blockedReason } : { canLaunch: true, blockedReason: null }
}

export function refreshHostLaunchBlocker(
	shownBlocker: LauncherV3LaunchBlocker | null,
	hostId: string | null | undefined,
	host: HostLaunchTarget | null,
): LauncherV3LaunchBlocker | null {
	if (shownBlocker?.code !== 'no-host' && shownBlocker?.code !== 'host-unavailable') return shownBlocker
	return getHostLaunchBlocker(hostId, host)
}

/** Resolved V2 project recipe committed with the launch command. */
export interface LauncherV3ProjectLaunch {
	projectId: string
	repositories: WorkspaceRepositories
	defaultRepositoryIdentity: string
}

export type LauncherV3LaunchTarget =
	| LauncherV3WorkspaceLaunchTarget
	| { kind: 'project'; project: LauncherV3ProjectLaunch }

export interface LauncherV3Command {
	promptText: string
	ticket: LauncherV3TicketAttachment | null
	title: string
	slug: string
	hostId: string
	directory: string
	workflowType: ResolvedTaskWorkflowType
	autoAdvance: boolean
	worktreeTiming: 'now' | 'later' | 'never'
	autoAdvanceFlags: TaskAutoAdvanceFlags
	/** A small task: it starts on implementation and asks to describe the PR when done. */
	directImplementation?: boolean
	workspaceSpec?: WorkspaceSpec
	defaultWorkingDirectory?: string
	project?: LauncherV3ProjectLaunch
	permissionsMode: LauncherV3FormValues['permissionsMode']
	agent: LauncherV3FormValues['agent']
	provider: LauncherV3FormValues['provider']
	model: string
	effort?: NonNullable<LauncherV3FormValues['effort']>
	fastMode: boolean
	attachments: LauncherV3FormAttachment[]
	createdWithExperimentFlags?: CreatedWithExperimentFlags
}

export function toLaunchCommand(values: LauncherV3FormValues, target?: LauncherV3LaunchTarget): LauncherV3Command {
	const effort = values.effort ?? undefined
	const attachments = dedupeAttachments(values.attachments)
	// Project workspaces materialize before launch on the chosen daemon, including
	// browser forms whose directory-backed default timing is "later".
	const effectiveWorktreeTiming =
		target?.kind === 'project' ? 'now' : target?.kind === 'in-place' ? 'never' : values.worktreeTiming
	const command: LauncherV3Command = {
		promptText: getTextFromContent(values.prompt).trim(),
		ticket: values.ticket
			? {
					...values.ticket,
					ticketId: values.ticket.ticketId.trim(),
					name: values.ticket.name.trim(),
					slug: values.ticket.slug.trim(),
				}
			: null,
		title: values.title.trim(),
		slug: truncateTaskSlug(values.slug.trim()),
		hostId: values.hostId?.trim() ?? '',
		directory: values.directory.trim(),
		workflowType: values.workflowType,
		autoAdvance: values.autoAdvance,
		worktreeTiming: effectiveWorktreeTiming,
		autoAdvanceFlags: projectTaskAutoAdvanceFlags(
			{ workflowType: values.workflowType, autoAdvance: values.autoAdvance },
			effectiveWorktreeTiming,
		),
		directImplementation: values.workflowPresentation === 'task-size' && values.workflowType === 'freeform',
		permissionsMode: values.permissionsMode,
		agent: values.agent,
		provider: values.provider,
		model: values.model.trim(),
		fastMode: values.fastMode,
		attachments,
	}
	if (target?.kind === 'project') {
		command.project = target.project
	} else if (target?.kind === 'workspace') {
		command.workspaceSpec = target.workspaceSpec
		command.defaultWorkingDirectory = target.defaultWorkingDirectory
	} else if (target?.kind === 'in-place') {
		command.defaultWorkingDirectory = target.defaultWorkingDirectory
	}
	if (effort) command.effort = effort
	if (values.createdWithExperimentFlags) {
		command.createdWithExperimentFlags = values.createdWithExperimentFlags
	}

	return command
}
