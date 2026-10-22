import type { OnlineHost } from '@humanlayer/db/tables/online-hosts'
import type { Session } from '@humanlayer/db/tables/sessions'
import type { Task } from '@humanlayer/db/tables/tasks'
import type { CodingAgent } from '@humanlayer/schemas/coding-agent'
import type { SlashCommand as SharedSlashCommand } from '@humanlayer/ui/components/rich-text-editor'
import { and, eq, useLiveQuery } from '@tanstack/react-db'
import { useQueries, useQuery } from '@tanstack/react-query'
import { useLocation, useParams, useSearch } from '@tanstack/react-router'
import { useMemo } from 'react'

import { LAUNCHER_FALLBACK_SLASH_COMMANDS } from '@/components/launcher-v3/prompt/launcher-slash-commands'
import { useSync } from '@/components/providers/SyncProvider'
import { RESPONSE_SLASH_COMMANDS } from '@/constants/response-slash-commands'
import { isTaskDiffEligible } from '@/hooks/diffs/useTaskDiffFiles'
import { useAgentSlashCommands } from '@/hooks/live-queries/use-agent-slash-commands'
import { useRecentDirectories as useSharedRecentDirectories } from '@/hooks/live-queries/useRecentDirectories'
import { type TaskArtifact, useTaskArtifacts as useSharedTaskArtifacts } from '@/hooks/live-queries/useTaskArtifacts'
import { useBrowserAuth as useAuth } from '@/hooks/use-browser-auth'
import { useLocalHostId } from '@/hooks/use-colocated'
import { matchesTaskScope, type TaskScope } from '@/lib/tasks/taskScope'
import { basename, toMs } from '@/minimalist/lib/format'
import { type Attention, rollupAttention } from '@/minimalist/lib/status'
import { useFailedSetups } from '@/minimalist/lib/workspace-setup'
import { useRiptideApi } from '@/orpc/client'
import { projectsV2ListQuery } from '@/queries/projects-v2'

/** What starts a daemon in the foreground on a host; the offline and no-hosts states offer it. */
export const DAEMON_START_COMMAND = 'npx @humanlayer/cli daemon launch'

export type TaskRow = {
	task: Task
	sessions: Session[]
	latest: Session | null
	attention: Attention
	lastActivity: number
	/** The project or repository it sits under in the sidebar. */
	projectName: string
}

export type ProjectGroup = {
	key: string
	name: string
	projectId: string | null
	tasks: TaskRow[]
	workspaceReadFailed?: boolean
	/** A directory group, or a project you own. The sidebar hides other projects while they hold none of your tasks. */
	mine: boolean
	/** What a hover shows: a directory group's path, or a project's description and repositories. */
	detail?: string
}

/** Mine is what the standard sidebar shows: tasks you own or started a session in. */
export type TaskTreeScope = 'mine' | 'everyone'

function sessionActivity(session: Session): number {
	return Math.max(toMs(session.last_activity_at), toMs(session.updated_at), toMs(session.created_at))
}

/**
 * Workspace membership is authoritative for project tasks; directory tasks group by their repository.
 * Mine keeps tasks you own or started a session in, as the standard sidebar does.
 */
export function useTaskTree(archived = false, scope: TaskTreeScope = 'mine') {
	const { tasksCollection: tasks, sessionsCollection: sessions } = useSync()
	const { user } = useAuth()
	const projects = useProjects()
	// Drafts wait in the standard launcher, as they do in its sidebar; archived ones still list.
	const tasksQuery = useLiveQuery(
		(q) =>
			q
				.from({ tasks })
				.where(({ tasks }) =>
					archived ? eq(tasks.archived, true) : and(eq(tasks.archived, false), eq(tasks.is_draft, false)),
				),
		[tasks, archived],
	)
	const sessionsQuery = useLiveQuery((q) => q.from({ sessions }), [sessions])
	const { queryClient: api } = useRiptideApi()
	const archivedProjects = useQuery({
		...api.projects.v2.list.queryOptions({ input: { archived: true } }),
		queryKey: ['projects', 'v2', 'archived'],
	})
	const workspaceTasks = (tasksQuery.data ?? []).filter((task) => task.workspace_id)
	const workspaceQueries = useQueries({
		queries: workspaceTasks.map((task) =>
			api.projectWorkspaces.getStatus.queryOptions({ input: { taskId: task.id } }),
		),
	})
	const projectByTask = new Map(
		workspaceTasks.map((task, index) => [task.id, workspaceQueries[index]?.data?.workspace.projectId]),
	)
	const failedWorkspaceTasks = new Set(
		workspaceTasks.filter((_, index) => workspaceQueries[index]?.isError).map((task) => task.id),
	)
	// A project task waiting on its workspace may be waiting on a setup that failed.
	const settingUp = [
		...new Set(
			(sessionsQuery.data ?? []).flatMap((session) =>
				session.status === 'waiting_for_workspace' && session.task_id && !session.archived
					? [session.task_id]
					: [],
			),
		),
	]
	const setupFailed = useFailedSetups(settingUp)

	const byTask = new Map<string, Session[]>()
	const standalone: Session[] = []
	for (const session of sessionsQuery.data ?? []) {
		if (!session.task_id) {
			if (
				session.status !== 'draft' &&
				session.archived === archived &&
				(scope === 'everyone' || session.resource_owner_user_id === user?.id)
			)
				standalone.push(session)
			continue
		}
		const list = byTask.get(session.task_id) ?? []
		list.push(session)
		byTask.set(session.task_id, list)
	}
	const allProjects = (projects.data ?? []).concat(archivedProjects.data?.projects ?? [])
	const projectNames = new Map(allProjects.map((project) => [project.id, project.name]))
	const projectDetails = new Map(allProjects.map((project) => [project.id, projectDetail(project)]))
	const ownProjects = new Set(
		allProjects.filter((project) => project.resourceOwnerUserId === user?.id).map((project) => project.id),
	)
	const treeScope: TaskScope = {
		mode: scope === 'mine' ? 'mine' : 'everything',
		selectedUserIds: [],
		currentUserId: user?.id ?? null,
	}
	const groups = new Map<string, ProjectGroup>()
	for (const task of tasksQuery.data ?? []) {
		const history = byTask.get(task.id) ?? []
		if (
			!matchesTaskScope(
				task,
				history.map((session) => session.created_by),
				treeScope,
			)
		)
			continue
		const taskSessions = (byTask.get(task.id) ?? [])
			.filter((session) => archived || !session.archived)
			.sort((a, b) => sessionActivity(b) - sessionActivity(a))
		const latest = taskSessions[0] ?? null
		const projectId = task.workspace_id ? (projectByTask.get(task.id) ?? null) : task.project_id
		// A directory task in worktrees belongs with the directory it was started from.
		const directory =
			task.workspace_spec?.directory || task.default_working_directory || latest?.working_directory || ''
		const key =
			projectId ??
			(task.workspace_id ? `workspace:${task.workspace_id}` : directory ? `dir:${repoName(directory)}` : 'other')
		let name = directory ? repoName(directory) : 'Other tasks'
		if (projectId) name = projectNames.get(projectId) ?? 'Project'
		else if (task.workspace_id)
			name = failedWorkspaceTasks.has(task.id) ? 'Could not load project' : 'Loading project…'
		const row: TaskRow = {
			task,
			sessions: taskSessions,
			latest,
			attention: setupAttention(
				rollupAttention(taskSessions.map((session) => session.status)),
				setupFailed.has(task.id),
			),
			lastActivity: Math.max(toMs(task.updated_at), latest ? sessionActivity(latest) : 0),
			projectName: name,
		}
		const group = groups.get(key) ?? {
			key,
			name,
			projectId,
			tasks: [],
			workspaceReadFailed: !projectId && failedWorkspaceTasks.has(task.id),
			mine: !projectId || ownProjects.has(projectId),
			detail: projectId ? projectDetails.get(projectId) : directory || undefined,
		}
		group.tasks.push(row)
		groups.set(key, group)
	}
	for (const project of archived ? [] : (projects.data ?? [])) {
		if (!groups.has(project.id))
			groups.set(project.id, {
				key: project.id,
				name: project.name,
				projectId: project.id,
				tasks: [],
				mine: ownProjects.has(project.id),
				detail: projectDetail(project),
			})
	}
	// Projects keep their place by name, so starting work doesn't move them; tasks inside go newest first.
	const sortedGroups = [...groups.values()]
		.map((group) => ({ ...group, tasks: group.tasks.sort((a, b) => b.lastActivity - a.lastActivity) }))
		.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
	return {
		groups: sortedGroups,
		/** Every task, newest first: what ⌥⌘1–6, the palette and new tasks mean by recent. */
		recent: sortedGroups.flatMap((group) => group.tasks).sort((a, b) => b.lastActivity - a.lastActivity),
		standalone: standalone.sort((a, b) => sessionActivity(b) - sessionActivity(a)),
		// Groups come from projects too, so an empty tree means nothing until they load.
		isReady: tasksQuery.isReady && sessionsQuery.isReady && !projects.isPending,
	}
}

/** A project's description and repositories, one per line, for its sidebar row's hover. */
function projectDetail(project: {
	name: string
	description: string | null
	repositories: ReadonlyArray<{ repositoryIdentity: string }>
}): string {
	return [
		project.name,
		project.description,
		...project.repositories.map((repository) => repository.repositoryIdentity),
	]
		.filter(Boolean)
		.join('\n')
}

/** A task whose workspace setup failed isn't running: it waits on a retry. */
function setupAttention(attention: Attention, setupFailed: boolean): Attention {
	return setupFailed && attention === 'running' ? 'failed' : attention
}

/**
 * The repository a directory belongs to. Worktrees live under
 * ~/.humanlayer/workspaces/<task>/<repo>, so the repo is the last segment there.
 */
export function repoName(directory: string): string {
	if (!directory) return 'Other'
	const match = directory.match(/\.humanlayer\/workspaces\/[^/]+\/([^/]+)/)
	return match?.[1] ?? basename(directory)
}

/** The branch the task works on: its primary repo's, else its first repo's. Null outside a workspace. */
export function taskBranch(task: Pick<Task, 'workspace_state'> | null): string | null {
	const repos = task?.workspace_state?.repos ?? []
	return (repos.find((repo) => repo.primary) ?? repos[0])?.branch ?? null
}

/**
 * Whether the task has a diff to review and a branch to ship: a project worktree or git sources.
 * A task in a plain directory has neither, so Review, PR, commit and open PR have nothing to act on.
 */
export function canReview(task: Pick<Task, 'workspace_id' | 'workspace_state'>): boolean {
	return isTaskDiffEligible(task.workspace_id ?? null, task.workspace_state ?? null)
}

export function useProjects() {
	const { queryClient: api } = useRiptideApi()
	return useQuery({
		...projectsV2ListQuery(api),
		select: (result) => result.projects,
	})
}

export function useTask(taskId: string | null | undefined) {
	const { tasksCollection: tasks, sessionsCollection: sessions } = useSync()
	const taskQuery = useLiveQuery(
		(q) => (taskId ? q.from({ tasks }).where(({ tasks }) => eq(tasks.id, taskId)) : undefined),
		[tasks, taskId],
	)
	const sessionsQuery = useLiveQuery(
		(q) => (taskId ? q.from({ sessions }).where(({ sessions }) => eq(sessions.task_id, taskId)) : undefined),
		[sessions, taskId],
	)
	const ordered = useMemo(
		() =>
			Array.from(sessionsQuery.data ?? []).sort(
				(a, b) => toMs(a.created_at) - toMs(b.created_at) || a.id.localeCompare(b.id),
			),
		[sessionsQuery.data],
	)
	return { task: taskQuery.data?.[0] ?? null, sessions: ordered, isReady: taskQuery.isReady && sessionsQuery.isReady }
}

export function useSession(sessionId: string | null): Session | null {
	const { sessionsCollection: sessions } = useSync()
	const { data } = useLiveQuery(
		(q) => (sessionId ? q.from({ sessions }).where(({ sessions }) => eq(sessions.id, sessionId)) : undefined),
		[sessions, sessionId],
	)
	return data?.[0] ?? null
}

/** The task on screen: the one in the address, or the one the open session belongs to. */
export function useOpenTaskId(): string | undefined {
	const params = useParams({ strict: false }) as { taskId?: string; sessionId?: string }
	const session = useSession(params.taskId ? null : (params.sessionId ?? null))
	const search = useSearch({ strict: false }) as { task?: string }
	const pathname = useLocation({ select: (location) => location.pathname })
	return params.taskId ?? session?.task_id ?? (pathname === '/' ? search.task : undefined)
}

export function useSessionThread(sessionId: string) {
	const {
		sessionsCollection: sessions,
		eventsCollection: events,
		approvalsCollection: approvals,
		queuedMessagesCollection: queuedMessages,
	} = useSync()
	const sessionQuery = useLiveQuery(
		(q) => q.from({ sessions }).where(({ sessions }) => eq(sessions.id, sessionId)),
		[sessions, sessionId],
	)
	const eventsQuery = useLiveQuery(
		(q) => q.from({ events }).where(({ events }) => eq(events.session_id, sessionId)),
		[events, sessionId],
	)
	const approvalsQuery = useLiveQuery(
		(q) =>
			q
				.from({ approvals })
				.where(({ approvals }) => and(eq(approvals.session_id, sessionId), eq(approvals.status, 'pending'))),
		[approvals, sessionId],
	)
	const queuedQuery = useLiveQuery(
		(q) =>
			q
				.from({ queuedMessages })
				.where(({ queuedMessages }) =>
					and(eq(queuedMessages.session_id, sessionId), eq(queuedMessages.status, 'pending')),
				),
		[queuedMessages, sessionId],
	)
	return {
		session: sessionQuery.data?.[0] ?? null,
		events: eventsQuery.data ?? [],
		pendingApprovals: Array.from(approvalsQuery.data ?? []).sort((a, b) => toMs(a.created_at) - toMs(b.created_at)),
		queued: Array.from(queuedQuery.data ?? []).sort((a, b) => toMs(a.created_at) - toMs(b.created_at)),
		isReady: sessionQuery.isReady && eventsQuery.isReady,
	}
}

/** A synced host row; the sync schema makes the JSON columns optional. */
export type HostRow = Omit<OnlineHost, 'supported_models' | 'coding_agent_usage_limits'> & {
	supported_models?: OnlineHost['supported_models'] | undefined
	coding_agent_usage_limits?: OnlineHost['coding_agent_usage_limits'] | undefined
}

export type HostView = {
	host: HostRow
	name: string
	online: boolean
	stale: boolean
	lastSeen: number
	/** The daemon on the computer running this app. */
	local: boolean
}

const STALE_AFTER_MS = 30_000

/**
 * Online hosts first, then offline ones. In each, this computer's host leads, so the launcher's
 * default (the first online host) is local when it can be. Then online hosts go by name and offline
 * ones by when they were last seen. Online hosts must not sort by `lastSeen`: every heartbeat moves it.
 */
export function compareHosts(
	a: Pick<HostView, 'name' | 'online' | 'lastSeen' | 'local'> & { host: { host_id: string } },
	b: Pick<HostView, 'name' | 'online' | 'lastSeen' | 'local'> & { host: { host_id: string } },
): number {
	if (a.online !== b.online) return Number(b.online) - Number(a.online)
	if (a.local !== b.local) return Number(b.local) - Number(a.local)
	if (a.online) return a.name.localeCompare(b.name) || a.host.host_id.localeCompare(b.host.host_id)
	return b.lastSeen - a.lastSeen
}

/**
 * The signed-in user's hosts, online first. Other members' hosts are never offered.
 * Until `isReady`, an empty list means not loaded yet rather than no hosts.
 */
export function useHosts(): { hosts: HostView[]; isReady: boolean } {
	const { onlineHostsCollection: hosts } = useSync()
	const { user } = useAuth()
	const localHostId = useLocalHostId()
	const query = useLiveQuery((q) => q.from({ hosts }), [hosts])
	const list = useMemo(() => {
		const now = Date.now()
		return (query.data ?? [])
			.filter((host) => host.user_id === user?.id)
			.map((host) => {
				const lastSeen = toMs(host.last_seen)
				const stale = now - lastSeen > STALE_AFTER_MS
				return {
					host,
					name: host.host_name || host.host_id.slice(0, 8),
					online: host.status === 'online' && !stale,
					stale,
					lastSeen,
					local: host.host_id === localHostId,
				}
			})
			.sort(compareHosts)
	}, [query.data, user?.id, localHostId])
	return { hosts: list, isReady: query.isReady }
}

/** A readable daemon registration by host id and session creator. Launch lists stay own-only. */
export function useHost(
	hostId: string | null | undefined,
	daemonUserId: string | null | undefined,
): { host: HostView | null; isReady: boolean } {
	const { onlineHostsCollection: hosts } = useSync()
	const localHostId = useLocalHostId()
	const query = useLiveQuery(
		(q) =>
			hostId && daemonUserId
				? q
						.from({ hosts })
						.where(({ hosts }) => and(eq(hosts.host_id, hostId), eq(hosts.user_id, daemonUserId)))
				: undefined,
		[hosts, hostId, daemonUserId],
	)
	const host = query.data?.[0]
	if (!host) return { host: null, isReady: query.isReady }
	const lastSeen = toMs(host.last_seen)
	const stale = Date.now() - lastSeen > STALE_AFTER_MS
	return {
		host: {
			host,
			name: host.host_name || host.host_id.slice(0, 8),
			online: host.status === 'online' && !stale,
			stale,
			lastSeen,
			local: host.host_id === localHostId,
		},
		isReady: query.isReady,
	}
}

/** Directories this user has run sessions in, most recent first; the directory picker offers these. */
export function useRecentDirectories(hostId: string | null): string[] {
	const { user } = useAuth()
	const { tasksCollection } = useSync()
	const recent = useSharedRecentDirectories(hostId ?? undefined, user?.id)
	const { data: tasks } = useLiveQuery(
		(q) =>
			q.from({ tasks: tasksCollection }).select(({ tasks }) => ({
				default_working_directory: tasks.default_working_directory,
				workspace_spec: tasks.workspace_spec,
			})),
		[tasksCollection],
	)
	return useMemo(() => recentSourceDirectories(recent, tasks ?? []), [recent, tasks])
}

/**
 * Recent directories as you picked them: a directory task in worktrees counts as the directory
 * it was started from, and other worktree paths are left out. Exported for tests.
 */
export function recentSourceDirectories(
	recent: readonly string[],
	tasks: readonly Pick<Task, 'default_working_directory' | 'workspace_spec'>[],
): string[] {
	const sources = new Map<string, string>()
	for (const task of tasks)
		if (task.workspace_spec && task.default_working_directory)
			sources.set(task.default_working_directory, task.workspace_spec.directory)
	const directories = recent
		.map((dir) => sources.get(dir) ?? dir)
		.filter((dir) => !dir.includes('/.humanlayer/workspaces/'))
	return [...new Set(directories)]
}

/** The task's artifacts (research, plans, PRDs), newest first. Content loads separately. */
export function useTaskArtifacts(taskId: string | null) {
	return useSharedTaskArtifacts(taskId ?? undefined)
}

export type SlashCommand = SharedSlashCommand & { kind: 'command' | 'skill' }

const bundledCommandsByName = new Map(RESPONSE_SLASH_COMMANDS.map((command) => [command.name.toLowerCase(), command]))

/**
 * Bundled skills plus commands discovered for the selected agent, exact directory and host.
 * A new task/session has no conversation to compact; an existing session uses the response list.
 */
export function useSlashCommands({
	hostId,
	workspacePath,
	agent,
	continuingSession = false,
}: {
	hostId: string | null
	workspacePath: string | null
	agent: CodingAgent | null
	continuingSession?: boolean
}): SlashCommand[] {
	const commands = useAgentSlashCommands({
		hostId,
		workspacePath,
		agent,
		fallbackCommands: continuingSession ? RESPONSE_SLASH_COMMANDS : LAUNCHER_FALLBACK_SLASH_COMMANDS,
		omitStartOfMessageOnly: !continuingSession,
	})
	return commands.map((command) => ({
		...command,
		// Discovery reports names without alias metadata. Keep the bundled alias's canonical target.
		insertText: command.insertText ?? bundledCommandsByName.get(command.name.toLowerCase())?.insertText,
		kind: /^\/(rpi|hl):/i.test(command.name) ? 'skill' : 'command',
	}))
}

export type RecentArtifact = TaskArtifact & { task_id: string }

/** Every task artifact you can see, newest first, for the palette and the Artifacts page. */
export function useRecentArtifacts(): { artifacts: RecentArtifact[]; isReady: boolean } {
	const { artifactsMetadataCollection } = useSync()
	const { data, isReady } = useLiveQuery(
		(q) =>
			q
				.from({ artifact: artifactsMetadataCollection })
				.where(({ artifact }) => eq(artifact.is_deleted, false))
				.select(({ artifact }) => ({
					id: artifact.id,
					file_name: artifact.file_name,
					task_id: artifact.task_id,
					task_slug: artifact.task_slug,
					last_updated_at: artifact.last_updated_at,
					resource_owner_user_id: artifact.resource_owner_user_id,
					share_key: artifact.share_key,
					share_enabled: artifact.share_enabled,
				}))
				.orderBy(({ artifact }) => artifact.last_updated_at, 'desc')
				.limit(300),
		[artifactsMetadataCollection],
	)
	const artifacts = (data ?? []).flatMap((row) => (row.task_id ? [{ ...row, task_id: row.task_id }] : []))
	return { artifacts, isReady }
}
