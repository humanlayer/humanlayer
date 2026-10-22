import type { RiptideApiInputs, RiptideApiOutputs } from '@humanlayer/riptide-api-contract/contract-router'

import { getFirstSessionParams, withDescribePrNextStep } from '@/lib/auto-advance'

import type { LauncherV3Command, LauncherV3TicketAttachment } from './launcher-v3-form'

type LaunchTaskDraftInput = RiptideApiInputs['tasks']['launchDraft']
type LaunchTaskDraftResult = Omit<RiptideApiOutputs['tasks']['launchDraft'], 'task'> & {
	task: Omit<RiptideApiOutputs['tasks']['launchDraft']['task'], 'created_at' | 'updated_at'> & {
		created_at: string
		updated_at: string
	}
}
type CreateTaskV2Input = RiptideApiInputs['tasks']['v2']['create']
type CreateTaskV2Result = RiptideApiOutputs['tasks']['v2']['create']

export type LauncherV3Operation =
	| { phase: 'building-request' }
	| { phase: 'creating-task'; taskId: string }
	| { phase: 'confirming-sync'; taskId: string; sessionId: string; transactionId: string }
	| { phase: 'complete'; taskId: string; sessionId: string; transactionId?: string }

export interface LauncherV3LaunchDependencies {
	tasks: {
		/** Legacy directory-backed launch: `tasks.launchDraft`. */
		launchDraft(input: LaunchTaskDraftInput): Promise<LaunchTaskDraftResult>
		/** Project-backed launch: `tasks.v2.create`. */
		createV2(input: CreateTaskV2Input): Promise<CreateTaskV2Result>
		waitForTask(id: string, transactionId: string): Promise<void>
		waitForSession(id: string, transactionId: string): Promise<void>
	}
	operations: {
		report(operation: LauncherV3Operation): void
	}
}

export interface LauncherV3LaunchRequest {
	command: LauncherV3Command
	ids: {
		taskId: string
		firstSessionId: string
		firstEventId: string
	}
}

export type LauncherV3NavigationTarget = {
	to: '/tasks/$taskId'
	params: { taskId: string }
	search?: { focus: 'workspace' }
	replace: true
}

export interface LauncherV3LaunchResult {
	taskId: string
	sessionId: string
	transactionId?: string
	task?: LaunchTaskDraftResult['task']
	firstSession?: LaunchTaskDraftInput['firstSession']
	navigation: LauncherV3NavigationTarget
}

export function createLauncherV3LaunchResult({
	taskId,
	sessionId,
	transactionId,
	task,
	firstSession,
	focusWorkspace = false,
}: {
	taskId: string
	sessionId: string
	transactionId: string
	task?: LaunchTaskDraftResult['task']
	firstSession?: LaunchTaskDraftInput['firstSession']
	focusWorkspace?: boolean
}): LauncherV3LaunchResult {
	const navigation: LauncherV3NavigationTarget = {
		to: '/tasks/$taskId',
		params: { taskId },
		replace: true,
	}
	if (focusWorkspace) navigation.search = { focus: 'workspace' }
	return {
		taskId,
		sessionId,
		transactionId,
		task,
		firstSession,
		navigation,
	}
}

function report(dependencies: LauncherV3LaunchDependencies, operation: LauncherV3Operation): void {
	try {
		dependencies.operations.report(operation)
	} catch {
		// Progress reporting must not affect task creation or sync confirmation.
	}
}

/**
 * Mirror of the server's provider-derived ticket artifact name so the first
 * session prompt can reference the imported ticket file before it exists.
 */
export function ticketArtifactFileName(ticket: LauncherV3TicketAttachment): string {
	const stem =
		ticket.provider === 'github' && ticket.githubRepository
			? `${ticket.githubRepository.fullName}-${ticket.ticketId}`
			: ticket.ticketId
	return `${stem.replaceAll(/[^A-Za-z0-9._-]+/g, '-')}.md`
}

/** Prompt text and first-session parameters shared by both launch paths. */
function buildFirstSessionContent(command: LauncherV3Command) {
	const ticket = command.ticket
	const ticketReference = ticket ? `See @.humanlayer/tasks/${command.slug}/${ticketArtifactFileName(ticket)}` : null
	const fileReferences = command.attachments.map(({ fileName }) => `@.humanlayer/tasks/${command.slug}/${fileName}`)
	const prompt = command.directImplementation ? withDescribePrNextStep(command.promptText) : command.promptText
	const promptWithFileRefs = [prompt, ...fileReferences].filter(Boolean).join('\n\n')
	const promptWithFileAndTicketRefs = [promptWithFileRefs, ticketReference].filter(Boolean).join('\n\n')
	const workflowSession =
		command.workflowType === 'freeform'
			? null
			: getFirstSessionParams({
					slug: command.slug,
					name: command.title,
					autoAdvanceQuestionsToResearch: command.autoAdvanceFlags.autoAdvanceQuestionsToResearch,
					workflow: command.workflowType === 'oneshot' ? 'oneshot' : 'rpi',
				})
	return {
		taskContent: promptWithFileRefs,
		title: workflowSession?.title ?? command.title,
		text: workflowSession?.prompt ?? promptWithFileAndTicketRefs,
		permissionsMode: workflowSession?.permissionsMode ?? command.permissionsMode,
		intent: command.directImplementation ? ('implementation' as const) : undefined,
	}
}

function applyTicketFields(
	command: LauncherV3Command,
	input: Pick<
		LaunchTaskDraftInput,
		| 'ticketDescription'
		| 'ticketProvider'
		| 'ticketId'
		| 'ticketUrl'
		| 'githubConnectionId'
		| 'ticketRepositoryId'
		| 'ticketRepositoryFullName'
	>,
): void {
	if (command.promptText) input.ticketDescription = command.promptText
	const ticket = command.ticket
	if (!ticket) return
	input.ticketProvider = ticket.provider
	input.ticketId = ticket.ticketId
	if (ticket.url) input.ticketUrl = ticket.url
	if (ticket.githubRepository) {
		input.githubConnectionId = ticket.githubRepository.connectionId
		input.ticketRepositoryId = ticket.githubRepository.repositoryId
		input.ticketRepositoryFullName = ticket.githubRepository.fullName
	}
}

export function buildLaunchTaskDraftInput({
	command,
	ids,
}: {
	command: LauncherV3Command
	ids: LauncherV3LaunchRequest['ids']
}): LaunchTaskDraftInput {
	const content = buildFirstSessionContent(command)
	const input: LaunchTaskDraftInput = {
		draftId: ids.taskId,
		name: command.title,
		slug: command.slug,
		defaultWorkingDirectory: command.defaultWorkingDirectory ?? command.directory,
		taskContent: content.taskContent,
		firstSession: {
			id: ids.firstSessionId,
			eventId: ids.firstEventId,
			title: content.title,
			text: content.text,
			workingDirectory: command.defaultWorkingDirectory ?? command.directory,
			hostId: command.hostId,
			codingAgent: command.agent,
			provider: command.provider,
			model: command.model,
			effort: command.effort,
			fastMode: command.fastMode,
			permissionsMode: content.permissionsMode,
			intent: content.intent,
		},
		workflowType: command.workflowType,
		worktreeTiming: command.worktreeTiming,
		autoAdvanceQuestionsToResearch: command.autoAdvanceFlags.autoAdvanceQuestionsToResearch,
		autoAdvanceResearchToDesign: command.autoAdvanceFlags.autoAdvanceResearchToDesign,
		autoAdvancePlanToWorktree: command.autoAdvanceFlags.autoAdvancePlanToWorktree,
		autoAdvanceWorktreeToImplementation: command.autoAdvanceFlags.autoAdvanceWorktreeToImplementation,
		autoAdvanceImplementationToPr: command.autoAdvanceFlags.autoAdvanceImplementationToPr,
	}
	applyTicketFields(command, input)
	if (command.worktreeTiming === 'now' && command.workspaceSpec) {
		input.workspaceSpec = command.workspaceSpec
	}
	if (command.attachments.length > 0) input.attachments = command.attachments
	if (command.createdWithExperimentFlags) {
		input.createdWithExperimentFlags = command.createdWithExperimentFlags
	}

	return input
}

/**
 * Project-backed request. The workspace shares the task's stable identity so
 * retries replay one graph without a second persisted ID.
 */
export function buildCreateTaskV2Input({
	command,
	ids,
}: {
	command: LauncherV3Command & { project: NonNullable<LauncherV3Command['project']> }
	ids: LauncherV3LaunchRequest['ids']
}): CreateTaskV2Input {
	const content = buildFirstSessionContent(command)
	const input: CreateTaskV2Input = {
		taskId: ids.taskId,
		workspaceId: ids.taskId,
		sessionId: ids.firstSessionId,
		eventId: ids.firstEventId,
		projectId: command.project.projectId,
		name: command.title,
		slug: command.slug,
		repositories: command.project.repositories,
		defaultRepositoryIdentity: command.project.defaultRepositoryIdentity,
		taskContent: content.taskContent,
		firstSession: {
			id: ids.firstSessionId,
			eventId: ids.firstEventId,
			title: content.title,
			text: content.text,
			hostId: command.hostId,
			codingAgent: command.agent,
			provider: command.provider,
			model: command.model,
			effort: command.effort,
			fastMode: command.fastMode,
			permissionsMode: content.permissionsMode,
			intent: content.intent,
		},
		workflowType: command.workflowType,
		autoAdvanceQuestionsToResearch: command.autoAdvanceFlags.autoAdvanceQuestionsToResearch,
		autoAdvanceResearchToDesign: command.autoAdvanceFlags.autoAdvanceResearchToDesign,
		autoAdvancePlanToWorktree: command.autoAdvanceFlags.autoAdvancePlanToWorktree,
		autoAdvanceWorktreeToImplementation: command.autoAdvanceFlags.autoAdvanceWorktreeToImplementation,
		autoAdvanceImplementationToPr: command.autoAdvanceFlags.autoAdvanceImplementationToPr,
		attachments: command.attachments,
	}
	applyTicketFields(command, input)
	if (command.createdWithExperimentFlags) {
		input.createdWithExperimentFlags = command.createdWithExperimentFlags
	}
	return input
}

export async function launchTask(
	{ command, ids }: LauncherV3LaunchRequest,
	dependencies: LauncherV3LaunchDependencies,
): Promise<LauncherV3LaunchResult> {
	report(dependencies, { phase: 'building-request' })

	if (command.project) {
		const input = buildCreateTaskV2Input({ command: { ...command, project: command.project }, ids })
		report(dependencies, { phase: 'creating-task', taskId: ids.taskId })
		const created = await dependencies.tasks.createV2(input)
		report(dependencies, {
			phase: 'confirming-sync',
			taskId: created.taskId,
			sessionId: created.sessionId,
			transactionId: created.transactionId,
		})
		return createLauncherV3LaunchResult({
			taskId: created.taskId,
			sessionId: created.sessionId,
			transactionId: created.transactionId,
			focusWorkspace: true,
		})
	}

	const input = buildLaunchTaskDraftInput({ command, ids })
	report(dependencies, { phase: 'creating-task', taskId: ids.taskId })
	const launched = await dependencies.tasks.launchDraft(input)
	report(dependencies, {
		phase: 'confirming-sync',
		taskId: launched.taskId,
		sessionId: launched.firstSessionId,
		transactionId: launched.transactionId,
	})
	return createLauncherV3LaunchResult({
		taskId: launched.taskId,
		sessionId: launched.firstSessionId,
		transactionId: launched.transactionId,
		task: launched.task,
		firstSession: input.firstSession,
		focusWorkspace: command.workspaceSpec !== undefined,
	})
}
