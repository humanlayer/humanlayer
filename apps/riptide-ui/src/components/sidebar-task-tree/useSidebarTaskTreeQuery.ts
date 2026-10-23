import { RPI_LABELS, type SessionLabel } from '@humanlayer/ui/components/session-label-badge'
import type { SessionStatus, SidebarSession, SidebarTask } from '@humanlayer/ui/components/sidebar/types'
import { and, eq, not, useLiveQuery } from '@tanstack/react-db'
import { useAuth } from '@workos-inc/authkit-react'
import { formatDistanceToNowStrict } from 'date-fns'
import { useMemo } from 'react'

import { useSync } from '@/components/providers/SyncProvider'
import { useUnreadStore } from '@/hooks/stores/unreadStore'
import { useStandaloneSessions } from '@/hooks/useStandaloneSessions'
import { type TaskWithActivity, useTasksByRecency } from '@/hooks/useTasksByRecency'
import { aggregateTaskStatus } from '@/lib/taskStatus'

export type SidebarTaskRow = {
	taskId: string
	taskName: string | null
	taskCreatedAt: bigint | null
	taskUpdatedAt: bigint | null
	ownerUserId: string | null
	sessionCount: number
	latestSessionActivity: bigint | null
}

export type SidebarSessionRow = {
	sessionId: string
	taskId: string | null
	ownerUserId: string | null
	hostId: string | null
	sessionName: string | null
	sessionTitle: string | null
	sessionStatus: string | null
	sessionCreatedAt: bigint | null
	sessionLastActivityAt: bigint | null
	messageCount: number | null
	labels: unknown
}

const _EMPTY_TASK_ROWS: SidebarTaskRow[] = []
const EMPTY_SESSION_ROWS: SidebarSessionRow[] = []

export type SidebarTaskTreeQueryResult = {
	tasks: SidebarTask[]
	standaloneSessions: SidebarSession[]
	isReady: boolean
	isLoading: boolean
	taskCount: number
	sessionCount: number
}

export function useSidebarTaskTreeQuery(): SidebarTaskTreeQueryResult {
	const { sessionsCollection } = useSync()
	const { user } = useAuth()
	const { tasks: tasksByRecency, isReady: tasksReady } = useTasksByRecency({
		includeSessionsCreatedBy: user?.id,
		limit: 20,
	})
	const unreadSessionIds = useUnreadStore((s) => s.unreadSessionIds)

	const visibleTaskRows = useMemo(() => tasksByRecency.map(toSidebarTaskRow), [tasksByRecency])

	const sessionsQuery = useLiveQuery(
		(q) => {
			if (!user?.id) return undefined

			return q
				.from({ sessions: sessionsCollection })
				.where(({ sessions }) => and(eq(sessions.archived, false), not(eq(sessions.status, 'draft'))))
				.select(({ sessions }) => ({
					sessionId: sessions.id,
					taskId: sessions.task_id,
					ownerUserId: sessions.resource_owner_user_id,
					hostId: sessions.host_id,
					sessionName: sessions.title,
					sessionTitle: sessions.summary,
					sessionStatus: sessions.status,
					sessionCreatedAt: sessions.created_at,
					sessionLastActivityAt: sessions.last_activity_at,
					messageCount: sessions.num_events,
					labels: sessions.labels,
				}))
				.orderBy(({ sessions }) => sessions.last_activity_at, 'desc')
		},
		[sessionsCollection, user?.id],
	)

	const sessionRows = useMemo(
		() => ((sessionsQuery.data ?? EMPTY_SESSION_ROWS) as SidebarSessionRow[]).filter(isActiveSidebarSessionRow),
		[sessionsQuery.data],
	)
	const tasks = useMemo(
		() => buildSidebarTasks(visibleTaskRows, sessionRows, unreadSessionIds),
		[visibleTaskRows, sessionRows, unreadSessionIds],
	)
	const visibleTaskIds = useMemo(() => new Set(visibleTaskRows.map((task) => task.taskId)), [visibleTaskRows])
	const sessionCount = useMemo(
		() => sessionRows.reduce((total, row) => total + (row.taskId && visibleTaskIds.has(row.taskId) ? 1 : 0), 0),
		[sessionRows, visibleTaskIds],
	)
	const hasVisibleTasks = visibleTaskRows.length > 0
	const sessionsReady = !hasVisibleTasks || sessionsQuery.isReady

	const { sessions: standaloneSessions, isReady: standaloneReady } = useStandaloneSessions({
		userId: user?.id,
		limit: 5,
	})

	return {
		tasks,
		standaloneSessions,
		isReady: tasksReady && sessionsReady && standaloneReady,
		isLoading: !tasksReady || (hasVisibleTasks && sessionsQuery.isLoading),
		taskCount: visibleTaskRows.length,
		sessionCount,
	}
}

function isActiveSidebarSessionRow(row: SidebarSessionRow): boolean {
	return row.sessionStatus !== 'draft'
}

function toSidebarTaskRow(task: TaskWithActivity): SidebarTaskRow {
	return {
		taskId: task.id,
		taskName: task.name,
		taskCreatedAt: task.created_at,
		taskUpdatedAt: task.updated_at,
		ownerUserId: task.resource_owner_user_id,
		sessionCount: task.sessionCount,
		latestSessionActivity: task.latestSessionActivity,
	}
}

export function buildSidebarTasks(
	taskRows: SidebarTaskRow[],
	sessionRows: SidebarSessionRow[],
	unreadSessionIds: Set<string>,
	sessionLimit = 5,
): SidebarTask[] {
	const rowsByTaskId = new Map<string, SidebarSessionRow[]>()

	for (const row of sessionRows) {
		if (!row.taskId || !isActiveSidebarSessionRow(row)) continue
		const rows = rowsByTaskId.get(row.taskId)
		if (rows) rows.push(row)
		else rowsByTaskId.set(row.taskId, [row])
	}

	return taskRows.map((row) => {
		const taskSessionRows = rowsByTaskId.get(row.taskId) ?? EMPTY_SESSION_ROWS
		const latestSessionActivity = getLatestSessionActivity(taskSessionRows) ?? row.latestSessionActivity
		const sessions: SidebarSession[] = taskSessionRows.slice(0, sessionLimit).map((session) => ({
			id: session.sessionId,
			name: session.sessionName || session.sessionTitle || 'Untitled session',
			ownerUserId: session.ownerUserId,
			hostId: session.hostId,
			status: toSidebarSessionStatus(session.sessionStatus),
			createdAt: formatRelativeDate(session.sessionLastActivityAt ?? session.sessionCreatedAt),
			messageCount: session.messageCount ?? undefined,
			isUnread: unreadSessionIds.has(session.sessionId),
		}))

		return {
			id: row.taskId,
			name: row.taskName || 'Untitled task',
			ownerUserId: row.ownerUserId,
			status: getSidebarTaskStatus(taskSessionRows),
			groupStatus: getSidebarTaskStatus(taskSessionRows),
			label: getMostProgressedLabel(taskSessionRows),
			sessions,
			sessionCount: row.sessionCount,
			createdAt: formatRelativeDate(latestSessionActivity ?? row.taskUpdatedAt ?? row.taskCreatedAt),
			isUnread: sessions.some((s) => s.isUnread),
		}
	})
}

function getLatestSessionActivity(sessionRows: SidebarSessionRow[]): bigint | null {
	let latest: bigint | null = null

	for (const session of sessionRows) {
		const activity = session.sessionLastActivityAt ?? session.sessionCreatedAt
		if (activity != null && (latest == null || activity > latest)) latest = activity
	}

	return latest
}

function getSidebarTaskStatus(sessionRows: SidebarSessionRow[]): SidebarTask['status'] | undefined {
	return aggregateTaskStatus(
		sessionRows.map((session) => ({
			status: session.sessionStatus,
			lastActivityAt: session.sessionLastActivityAt,
		})),
	)
}

function getMostProgressedLabel(sessionRows: SidebarSessionRow[]): SessionLabel | undefined {
	let mostProgressed: SessionLabel | undefined
	let highestIndex = -1

	for (const session of sessionRows) {
		const labels = Array.isArray(session.labels) ? (session.labels as SessionLabel[]) : []

		for (const label of labels) {
			const index = RPI_LABELS.findIndex((candidate) => candidate.name === label.name)
			if (index > highestIndex) {
				highestIndex = index
				mostProgressed = label
			}
		}
	}

	return mostProgressed
}

function toSidebarSessionStatus(status: string | null): SessionStatus | undefined {
	switch (status) {
		case 'ready_for_launch':
		case 'launching':
		case 'running':
		case 'failed':
		case 'lost':
		case 'needs_approval':
		case 'waiting_for_usage_limit':
		case 'interrupt_requested':
		case 'resuming':
			return status
		case 'ready_for_input':
		case 'interrupted':
			return 'idle'
		default:
			return undefined
	}
}

function formatRelativeDate(value: bigint | null | undefined): string | undefined {
	if (!value) return undefined
	const timestamp = Number(value)
	if (!Number.isFinite(timestamp)) return undefined

	const diffMs = Date.now() - timestamp
	const diffMinutes = Math.max(0, Math.floor(diffMs / 60000))
	if (diffMinutes < 1) return 'now'
	if (diffMinutes < 60) return `${diffMinutes}m`

	const diffHours = Math.floor(diffMinutes / 60)
	if (diffHours < 24) return `${diffHours}h`

	const diffDays = Math.floor(diffHours / 24)
	if (diffDays < 7) return `${diffDays}d`

	return formatDistanceToNowStrict(timestamp, { unit: 'day' }).replace(/ days?$/, 'd')
}
