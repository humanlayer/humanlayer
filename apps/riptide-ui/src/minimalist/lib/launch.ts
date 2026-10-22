import type { Task } from '@humanlayer/db/tables/tasks'
import type { ProjectRepository } from '@humanlayer/schemas/effect/project-workspace'
import type { ResolvedTaskWorkflow, WorktreeTiming } from '@humanlayer/schemas/effect/taskconfiguration'
import { ORPCError } from '@orpc/client'

import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { getFirstSessionParams, withDescribePrNextStep } from '@/lib/auto-advance'
import { initialRepositorySourceSelections, missingRepositorySources } from '@/lib/repository-sources'
import { getTaskConflictMessage } from '@/lib/task-creation-error'
import { getTicketLookupError } from '@/lib/ticket-lookup-error'
import { type AttachmentMetadata, withAttachments } from '@/minimalist/lib/attachments'
import type { HostView } from '@/minimalist/lib/data'
import type { DirectoryWorkspace } from '@/minimalist/lib/directory-worktree'
import { basename } from '@/minimalist/lib/format'
import { branchName, readGitPrefs } from '@/minimalist/lib/git-prefs'
import { AGENT_PROVIDERS, type ComposerSettings } from '@/minimalist/lib/models'
import { type Ticket, ticketFields, withTicket } from '@/minimalist/lib/tickets'
import { projectTaskAutoAdvanceFlags } from '@/modules/launcher-v3/launcher-v3-workflow'
import { persistLauncherAgentDefaults } from '@/modules/launcher-v3/persist-agent-defaults'
import type { RiptideApiClient } from '@/orpc/client'

/**
 * Where a new task works: a project (a fresh worktree on a task branch) or a directory, which gets
 * worktrees from its workspace.json (or an implied one) when the host can set them up, and is
 * edited in place otherwise.
 */
export type Target = { kind: 'project'; projectId: string; name: string } | { kind: 'directory'; path: string }

/** The most recently active project or directory; a new task goes there unless you pick another. */
export function defaultTarget(recent: {
	latest: { task: { project_id: string | null }; projectName: string } | undefined
	directory: string | undefined
	project: { id: string; name: string } | undefined
}): Target | null {
	const latest = recent.latest
	if (latest?.task.project_id) return { kind: 'project', projectId: latest.task.project_id, name: latest.projectName }
	if (recent.directory) return { kind: 'directory', path: recent.directory }
	if (recent.project) return { kind: 'project', projectId: recent.project.id, name: recent.project.name }
	return null
}

export function targetLabel(target: Target | null): string | null {
	if (!target) return null
	return target.kind === 'project' ? target.name : basename(target.path)
}

/** Why the composer can't launch yet, as its placeholder says it; null when it can. */
export function launchBlocker(state: {
	host: HostView | null
	needsTarget: boolean
	target: Target | null
}): string | null {
	if (!state.host) return 'Start a daemon to launch sessions'
	if (!state.host.online) return `${state.host.name} is offline`
	if (state.needsTarget && !state.target) return 'Choose a project or directory'
	return null
}

/**
 * The host a launch runs on. A new task takes the one you picked, or any online
 * host. A new session in a task stays on the task's host, except that a project
 * task can move: it sets up again on another host from its pushed branch.
 */
export function launchHost<H extends { host: { host_id: string }; online: boolean }>(
	hosts: readonly H[],
	state: { picked: string | null; task: { hostId: string | null; movable: boolean } | null },
): H | null {
	const picked = hosts.find((entry) => entry.host.host_id === state.picked) ?? null
	const online = hosts.find((entry) => entry.online) ?? null
	if (!state.task) return picked ?? online
	const taskHost = hosts.find((entry) => entry.host.host_id === state.task?.hostId) ?? null
	if (!state.task.movable) return taskHost
	return picked ?? (taskHost?.online ? taskHost : (online ?? taskHost))
}

export type WorkingCopy = { label: string; title: string; branch: boolean }

/**
 * What the agent works in, for the launch strip. Projects get a branch in a new
 * worktree (or a new clone, when the host has no checkout yet); directories are
 * edited in place. A new session in a task says nothing unless it moved hosts.
 */
export function workingCopy(state: {
	inTask: boolean
	project: boolean
	clonesFirst: boolean
	hostName: string
	/** The task's own host, when this session runs somewhere else. */
	movedFrom: string | null
	/** A directory task's worktrees, when it gets them: how many, and whether workspace.json lists them. */
	directoryWorktrees?: { repositories: number; configured: boolean } | null
}): WorkingCopy | null {
	const label = state.clonesFirst ? 'New clone' : 'New worktree'
	if (state.inTask) {
		if (!state.movedFrom) return null
		return {
			label,
			title: `${state.hostName} checks out the task's branch as last pushed. Changes that were not pushed stay on ${state.movedFrom}.`,
			branch: true,
		}
	}
	if (!state.project) {
		const worktrees = state.directoryWorktrees
		if (!worktrees)
			return { label: 'In this directory', title: 'The agent edits your checkout directly', branch: false }
		return {
			label: worktrees.repositories > 1 ? `${worktrees.repositories} new worktrees` : 'New worktree',
			title: worktrees.configured
				? 'The host sets up the repositories in workspace.json, each on a branch named after the task'
				: 'The host creates a branch named after the task',
			branch: true,
		}
	}
	return {
		label,
		title: state.clonesFirst
			? `${state.hostName} clones the repository the first time, then makes a branch named after the task`
			: 'The host creates a branch named after the task',
		branch: true,
	}
}

/** First line of the prompt as a working title; the agent's title replaces it after launch. */
export function draftTitle(text: string): string {
	const line =
		text
			.trim()
			.split('\n')[0]
			?.replace(/^\/\S+\s*/, '') ?? ''
	const title = line.length > 64 ? `${line.slice(0, 63).trimEnd()}…` : line
	return title || 'Untitled task'
}

export function slugify(name: string, suffix: string): string {
	const base = name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 48)
		.replace(/-+$/, '')
	return `${base || 'task'}-${suffix}`
}

/** Saves where the host keeps each project repository, so it clones the ones it lacks on first launch. */
export async function ensureRepositorySources(api: RiptideApiClient, projectId: string, hostId: string) {
	const saved = await api.projects.v2.repositorySources.get({ projectId, hostId }, { context: { silent: true } })
	if (missingRepositorySources(saved.sources).length === 0) return
	await api.projects.v2.repositorySources.upsert(
		{ projectId, hostId, sources: initialRepositorySourceSelections(saved.sources, false) },
		{ context: { silent: true } },
	)
}

/** A `Target` with its project loaded. */
export type LoadedTarget =
	| { kind: 'project'; project: { id: string; repositories: readonly ProjectRepository[] } }
	| {
			kind: 'directory'
			path: string
			/** Plans the task's worktrees from its slug; null edits the directory in place. */
			worktree?: ((slug: string) => DirectoryWorkspace) | null
	  }

type NewTask = {
	ids: { taskId: string; sessionId: string; eventId: string }
	target: LoadedTarget
	hostId: string
	draft: string
	ticket: Ticket | null
	attachments: AttachmentMetadata[]
	settings: ComposerSettings
	/** Freeform sends the prompt as is; guided workflows start their first phase on it. */
	workflow: ResolvedTaskWorkflow
	/** A small task: labeled as implementation, and asked to offer describe-pr when it's done. */
	directImplementation?: boolean
}

/**
 * Creates a task and its first session. An issue names the task and its branch; otherwise the
 * prompt's first line does until the agent's title replaces it. A project task gets a worktree on
 * a branch from Settings → Git, and the host clones repositories it lacks; a directory task gets
 * the worktrees its workspace.json describes when it has a plan for them, and runs in place
 * otherwise. A guided workflow keeps the prompt as the task's content and starts its first phase
 * on it, as the standard launcher does. A small task starts on implementation and is asked to
 * offer the describe-pr skill as its next step, with or without auto-advance. Throws if the server refuses; title generation failing
 * keeps the working title.
 */
export async function startTask(api: RiptideApiClient, input: NewTask): Promise<void> {
	const { ids, target, ticket, attachments } = input
	const name = ticket?.name ?? draftTitle(input.draft)
	const slug = ticket?.slug ?? slugify(name, ids.taskId.slice(-4))
	const prompt = withTicket(withAttachments(input.draft, slug, attachments), slug, ticket)
	const text = input.directImplementation ? withDescribePrNextStep(prompt) : prompt
	const directoryWorkspace = target.kind === 'directory' ? (target.worktree?.(slug) ?? null) : null
	const worktreeTiming: WorktreeTiming = target.kind === 'project' || directoryWorkspace ? 'now' : 'never'
	const flags = projectTaskAutoAdvanceFlags(input.workflow, worktreeTiming)
	const phase =
		input.workflow.workflowType === 'freeform'
			? null
			: getFirstSessionParams({
					slug,
					name,
					autoAdvanceQuestionsToResearch: flags.autoAdvanceQuestionsToResearch,
					workflow: input.workflow.workflowType === 'oneshot' ? 'oneshot' : 'rpi',
				})
	const firstSession = {
		id: ids.sessionId,
		eventId: ids.eventId,
		title: phase?.title ?? null,
		text: phase?.prompt ?? text,
		hostId: input.hostId,
		...launchFields(input.settings),
		permissionsMode: phase?.permissionsMode ?? input.settings.permissionsMode,
		intent: input.directImplementation ? ('implementation' as const) : undefined,
	}
	const shared = {
		name,
		slug,
		taskContent: text,
		workflowType: input.workflow.workflowType,
		attachments,
		autoAdvanceQuestionsToResearch: flags.autoAdvanceQuestionsToResearch,
		autoAdvanceResearchToDesign: flags.autoAdvanceResearchToDesign,
		autoAdvancePlanToWorktree: flags.autoAdvancePlanToWorktree,
		autoAdvanceWorktreeToImplementation: flags.autoAdvanceWorktreeToImplementation,
		autoAdvanceImplementationToPr: flags.autoAdvanceImplementationToPr,
		...ticketFields(ticket),
	}
	if (target.kind === 'project') {
		const branch = branchName(readGitPrefs().branchPrefix, slug)
		const repositories = target.project.repositories.map((repository) => ({ ...repository, branch }))
		await ensureRepositorySources(api, target.project.id, input.hostId)
		await api.tasks.v2.create(
			{
				...shared,
				taskId: ids.taskId,
				workspaceId: ids.taskId,
				sessionId: ids.sessionId,
				eventId: ids.eventId,
				projectId: target.project.id,
				repositories,
				defaultRepositoryIdentity: repositories.find((repository) => repository.default)?.repositoryIdentity,
				firstSession,
			},
			{ context: { silent: true } },
		)
	} else {
		const workingDirectory = directoryWorkspace?.defaultWorkingDirectory ?? target.path
		await api.tasks.launchDraft(
			{
				...shared,
				draftId: ids.taskId,
				defaultWorkingDirectory: workingDirectory,
				worktreeTiming,
				workspaceSpec: directoryWorkspace?.workspaceSpec,
				firstSession: { ...firstSession, workingDirectory },
			},
			{ context: { silent: true } },
		)
	}
	if (ticket) return
	void api.ai
		.generateTitle({ text })
		.then(({ title }) => (title.trim() ? api.tasks.update({ taskId: ids.taskId, name: title.trim() }) : null))
		.catch(() => null)
}

/**
 * What a failed launch tells you: the reason when the server gives one you can act on, and
 * that the prompt is kept. The launch calls are silent, so this is the only message.
 */
export function launchError(error: unknown): string {
	return ['Could not start the task.', launchFailure(error), 'Your prompt is still in the composer.']
		.filter(Boolean)
		.join(' ')
}

function launchFailure(error: unknown): string | null {
	const known = getTaskConflictMessage(error) ?? getTicketLookupError(error)?.message
	if (known) return known
	const code = error instanceof ORPCError ? error.code : null
	if (code === 'BILLING_REQUIRED')
		return 'The organization needs a billing plan. An admin can add one in Settings → Billing.'
	if (code === 'FORBIDDEN') return "Your account can't start tasks here."
	return null
}

/** The launch fields for an agent, model, effort, fast mode and permissions. */
function launchFields(settings: ComposerSettings) {
	return {
		codingAgent: settings.agent,
		provider: AGENT_PROVIDERS[settings.agent],
		model: settings.model,
		effort: settings.effort,
		fastMode: settings.fastMode,
		permissionsMode: settings.permissionsMode,
	}
}

/** The settings a new task starts with: the last ones launched, in either UI. */
export function savedSettings(): ComposerSettings {
	const saved = useSettingsStore.getState()
	if (saved.defaultAgent === 'codelayer' && saved.defaultCodelayerProvider === 'codex')
		return {
			agent: 'codelayer',
			model: saved.defaultCodelayerCodexModel,
			effort: saved.defaultCodelayerCodexEffort,
			fastMode: saved.defaultCodelayerCodexFastMode,
			permissionsMode: 'bypass',
		}
	return {
		agent: 'claude',
		model: saved.defaultClaudeCodeModel,
		effort: saved.defaultClaudeCodeEffort,
		fastMode: false,
		permissionsMode: saved.launcherV3PermissionsMode,
	}
}

/** Saves a launch's settings as the next task's, the same way the standard launcher does. */
export function rememberSettings(settings: ComposerSettings) {
	// Codex always runs without asking; that says nothing about how Claude Code should.
	if (settings.agent === 'claude') useSettingsStore.getState().setLauncherV3PermissionsMode(settings.permissionsMode)
	persistLauncherAgentDefaults({
		agent: settings.agent,
		provider: AGENT_PROVIDERS[settings.agent],
		model: settings.model,
		effort: settings.effort,
		fastMode: settings.fastMode,
	})
}

type SessionInTask = {
	sessionId: string
	eventId: string
	text: string
	hostId: string
	/** Used by directory tasks; project tasks get their workspace from the server. */
	workingDirectory: string
	settings: ComposerSettings
}

/**
 * Starts another session in an existing task. Project tasks go through
 * `sessions.v2.create` so the server places the workspace; directory tasks use
 * the older launch with the directory the task already runs in.
 */
export async function launchInTask(
	api: RiptideApiClient,
	task: Pick<Task, 'id' | 'workspace_id'>,
	input: SessionInTask,
) {
	const shared = {
		eventId: input.eventId,
		taskId: task.id,
		text: input.text,
		hostId: input.hostId,
		...launchFields(input.settings),
	}
	if (task.workspace_id) {
		await api.sessions.v2.create(
			{ ...shared, sessionId: input.sessionId, workspaceId: task.workspace_id, title: null },
			{ context: { silent: true } },
		)
		return
	}
	await api.sessions.launch(
		{ ...shared, id: input.sessionId, title: '', workingDirectory: input.workingDirectory },
		{ context: { silent: true } },
	)
}
