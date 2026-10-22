import type { RiptideApiOutputs } from '@humanlayer/riptide-api-contract/contract-router'
import type { SidebarItem, SidebarTask } from '@humanlayer/ui/components/sidebar/types'

import {
	buildSidebarTasks,
	type SidebarSessionRow,
	type SidebarTaskRow,
} from '@/components/sidebar-task-tree/useSidebarTaskTreeQuery'
import type { ProjectSidebarOrder } from '@/hooks/stores/projectSidebarStore'
import { matchesTaskScope } from '@/lib/tasks/taskScope'

export type SidebarProject = RiptideApiOutputs['projects']['v2']['list']['projects'][number]
export type WorkspaceStatus = RiptideApiOutputs['projectWorkspaces']['getStatus']
export type ProjectSidebarTask = SidebarTask & {
	allSessionIds: string[]
	unresolvedProject: boolean
	historySessions?: SidebarTask['sessions']
}
export interface ProjectSidebarGroup {
	id: string
	name: string
	project?: SidebarProject
	tasks: ProjectSidebarTask[]
}
export interface ProjectTaskInput extends SidebarTaskRow {
	workspaceId: string | null
	allSessionIds?: string[]
}
export type WorkspaceRead = { state: 'pending' | 'error' | 'missing' } | { state: 'ready'; data: WorkspaceStatus }

const activeStatuses = new Set([
	'running',
	'waiting_for_usage_limit',
	'interrupt_requested',
	'needs_approval',
	'failed',
	'lost',
	'ready_for_launch',
	'launching',
	'resuming',
])

interface TaskRecord {
	id: string
	name: string
	archived: boolean
	is_draft: boolean
	resource_owner_user_id: string | null
	workspace_id: string | null
	created_at: bigint | null
	updated_at: bigint | null
}
interface SessionHistory {
	id: string
	task_id: string | null
	created_by: string | null
	last_activity_at: bigint | null
}

/** Fixed legacy Mine. History deliberately includes archived sessions and drafts; the board's scope is never read. */
export function selectProjectSidebarTasks(
	tasks: readonly TaskRecord[],
	history: readonly SessionHistory[],
	userId: string,
): ProjectTaskInput[] {
	const historyByTask = new Map<string, SessionHistory[]>()
	for (const session of history) {
		if (!session.task_id) continue
		const bucket = historyByTask.get(session.task_id) ?? []
		bucket.push(session)
		historyByTask.set(session.task_id, bucket)
	}
	const rows: ProjectTaskInput[] = []
	for (const task of tasks) {
		if (task.archived || task.is_draft) continue
		const sessions = historyByTask.get(task.id) ?? []
		if (
			!matchesTaskScope(
				task,
				sessions.map((session) => session.created_by),
				{ mode: 'mine', selectedUserIds: [], currentUserId: userId },
			)
		)
			continue
		let latestSessionActivity: bigint | null = null
		for (const session of sessions)
			if (
				session.last_activity_at !== null &&
				(latestSessionActivity === null || session.last_activity_at > latestSessionActivity)
			)
				latestSessionActivity = session.last_activity_at
		rows.push({
			taskId: task.id,
			taskName: task.name,
			taskCreatedAt: task.created_at,
			taskUpdatedAt: task.updated_at,
			workspaceId: task.workspace_id,
			ownerUserId: task.resource_owner_user_id,
			sessionCount: sessions.length,
			latestSessionActivity,
			allSessionIds: sessions.map((session) => session.id),
		})
	}
	return rows.sort(
		(a, b) =>
			Number(b.latestSessionActivity ?? b.taskUpdatedAt ?? b.taskCreatedAt ?? 0) -
				Number(a.latestSessionActivity ?? a.taskUpdatedAt ?? a.taskCreatedAt ?? 0) ||
			Number(b.taskCreatedAt ?? 0) - Number(a.taskCreatedAt ?? 0) ||
			a.taskId.localeCompare(b.taskId),
	)
}

export function isEligibleSession(session: SidebarSessionRow, unread: Set<string>, settingUp: boolean): boolean {
	return (
		session.sessionStatus !== 'draft' &&
		(unread.has(session.sessionId) || activeStatuses.has(session.sessionStatus ?? '') || settingUp)
	)
}

export function orderItems<T extends { id: string }>(items: readonly T[], saved: readonly string[] = []): T[] {
	const ranks = new Map(saved.map((id, index) => [id, index]))
	return [...items].sort((a, b) => (ranks.get(a.id) ?? -1) - (ranks.get(b.id) ?? -1))
}

export function deriveProjectSidebar({
	tasks,
	sessions,
	projects,
	workspaces,
	unread,
	order,
	legacySetup = new Set<string>(),
	projectsState = 'ready',
}: {
	tasks: ProjectTaskInput[]
	sessions: SidebarSessionRow[]
	projects: SidebarProject[]
	workspaces: Map<string, WorkspaceRead>
	unread: Set<string>
	order: ProjectSidebarOrder
	legacySetup?: Set<string>
	projectsState?: 'pending' | 'error' | 'ready'
}) {
	const projectById = new Map(projects.map((project) => [project.id, project]))
	const groups = new Map<string, ProjectSidebarGroup>()
	const sortedSessions = [...sessions].sort(
		(a, b) =>
			Number(b.sessionLastActivityAt ?? b.sessionCreatedAt ?? 0) -
				Number(a.sessionLastActivityAt ?? a.sessionCreatedAt ?? 0) || a.sessionId.localeCompare(b.sessionId),
	)
	const allTasks = buildSidebarTasks(tasks, sortedSessions, unread)
	const sessionsByTask = new Map<string, SidebarSessionRow[]>()
	for (const session of sortedSessions) {
		if (!session.taskId || session.sessionStatus === 'draft') continue
		const bucket = sessionsByTask.get(session.taskId) ?? []
		bucket.push(session)
		sessionsByTask.set(session.taskId, bucket)
	}
	let pendingRelations = false
	let failedRelations = false
	for (const [index, input] of tasks.entries()) {
		const workspace = workspaces.get(input.taskId)
		const projectId = workspace?.state === 'ready' ? workspace.data.workspace.projectId : undefined
		const project = projectId ? projectById.get(projectId) : undefined
		const pending = Boolean(
			input.workspaceId &&
			(!workspace || workspace.state === 'pending' || (!project && projectsState === 'pending')),
		)
		const failed = Boolean(
			input.workspaceId && (workspace?.state === 'error' || (!project && projectsState === 'error')),
		)
		if (pending) pendingRelations = true
		if (failed) failedRelations = true
		// An unresolved relation remains visible, but pending/error is explicitly reported, never called directory-backed.
		const unresolvedProject = Boolean(input.workspaceId && !project)
		const unresolvedRead = pending || failed
		const groupId = project?.id ?? (unresolvedRead ? (projectId ?? `workspace:${input.workspaceId}`) : 'other')
		const taskSessions = sessionsByTask.get(input.taskId) ?? []
		const settingUp = (session: SidebarSessionRow) => {
			if (!input.workspaceId) return legacySetup.has(`${input.taskId}:${session.hostId}`)
			return (
				workspace?.state === 'ready' &&
				workspace.data.materializations.some(
					(m) =>
						m.hostId === session.hostId &&
						m.userId === session.ownerUserId &&
						m.repositories.some((r) => r.status.status !== 'done' && !r.status.error),
				)
			)
		}
		const eligible = taskSessions
			.filter((session) => isEligibleSession(session, unread, settingUp(session)))
			.slice(0, 5)
		const displayRows = eligible.map((session) =>
			settingUp(session) && !activeStatuses.has(session.sessionStatus ?? '')
				? { ...session, sessionStatus: 'launching' }
				: session,
		)
		const base = allTasks[index]
		if (!base) throw new Error('Sidebar task projection must preserve every input task')
		const hasSetup = taskSessions.some(settingUp)
		const task: ProjectSidebarTask = {
			...base,
			status: base.status ?? (hasSetup ? 'pending' : undefined),
			groupStatus: base.groupStatus ?? (hasSetup ? 'pending' : undefined),
			isUnread: taskSessions.some((session) => unread.has(session.sessionId)),
			sessions: buildSidebarTasks([input], displayRows, unread)[0]?.sessions ?? [],
			historySessions: buildSidebarTasks([input], taskSessions, unread, Infinity)[0]?.sessions ?? [],
			allSessionIds: input.allSessionIds ?? taskSessions.map((session) => session.sessionId),
			unresolvedProject,
		}
		const group = groups.get(groupId) ?? {
			id: groupId,
			name:
				project?.name ??
				(unresolvedRead ? (failed ? 'Project unavailable' : 'Loading project…') : 'Other tasks'),
			project,
			tasks: [],
		}
		group.tasks.push(task)
		groups.set(groupId, group)
	}
	for (const group of groups.values()) group.tasks = orderItems(group.tasks, order.tasks[group.id])
	const populated = orderItems(
		[...groups.values()]
			.filter((group) => group.id !== 'other')
			.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
		order.projects,
	)
	const other = groups.get('other')
	return {
		groups: other ? [...populated, other] : populated,
		emptyProjects: projects
			.filter((project) => !project.archived && !groups.has(project.id))
			.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
		pendingRelations,
		failedRelations,
	}
}

/** Only active populated project headings count; disclosure state and Other do not. */
export function layoutProjectSidebar(
	groups: ProjectSidebarGroup[],
	emptyProjects: SidebarProject[],
	projects: SidebarProject[],
	order: ProjectSidebarOrder,
) {
	const separateEmpty =
		projects.filter((project) => !project.archived).length > 5 &&
		groups.filter((group) => group.project && !group.project.archived && group.tasks.length > 0).length > 5
	if (separateEmpty) return { groups, emptyProjects }
	const main = orderItems(
		[
			...groups.filter((group) => group.id !== 'other'),
			...emptyProjects.map((project) => ({ id: project.id, name: project.name, project, tasks: [] })),
		].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
		order.projects,
	)
	return { groups: [...main, ...groups.filter((group) => group.id === 'other')], emptyProjects: [] }
}

export function projectSidebarNavigation(
	tasks: SidebarTask[],
	expanded: readonly string[],
	standaloneIds: string[],
): SidebarItem[] {
	const items: SidebarItem[] = []
	const expandedIds = new Set(expanded)
	for (const task of tasks) {
		items.push({ type: 'task', id: task.id })
		if (expandedIds.has(task.id)) {
			for (const session of task.sessions) items.push({ type: 'session', id: session.id, taskId: task.id })
		}
	}
	for (const id of standaloneIds) items.push({ type: 'standalone-session', id })
	return items
}

export function visibleSidebarFocus(current: SidebarItem | null, items: SidebarItem[]): SidebarItem | null {
	if (!current) return null
	const exact = items.find((item) => item.id === current.id && item.type === current.type)
	if (exact) return exact
	if (current.type === 'session') {
		const parent = items.find((item) => item.type === 'task' && item.id === current.taskId)
		if (parent) return parent
	}
	return items[0] ?? null
}
