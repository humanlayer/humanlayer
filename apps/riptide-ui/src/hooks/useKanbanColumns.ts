import type { KanbanColumns } from '@humanlayer/ui/components/kanban'
import type { SessionLabel } from '@humanlayer/ui/components/session-label-badge'
import type { UserOption } from '@humanlayer/ui/components/user-multi-select'
import { getInitials } from '@humanlayer/ui/lib/comment-utils'
import { and, eq, inArray, useLiveQuery } from '@tanstack/react-db'
import { useMemo } from 'react'

import { useSync } from '@/components/providers/SyncProvider'
import { useUnreadStore } from '@/hooks/stores/unreadStore'
import { useOrgMembers } from '@/hooks/useOrgMembers'
import { buildKanbanColumns, type KanbanSessionInput, type KanbanTaskInput } from '@/lib/kanban/columnEngine'
import { isTaskEligibleForBoard, matchesTaskScope, type TaskScope } from '@/lib/tasks/taskScope'

const DEFAULT_SCOPE: TaskScope = { mode: 'everything', selectedUserIds: [], currentUserId: null }

/**
 * Wired hook: gathers active tasks plus their session history and
 * delegates column placement to the pure `buildKanbanColumns` engine.
 *
 * Accepts the shared `TaskScope`. Selected owners are pushed into the task-level
 * query to shrink the candidate set; the shared eligibility and scope predicates
 * then run in the memo. The normal Board excludes drafts, which remain available
 * through Launcher V3 recent-draft restoration and dedicated draft surfaces. Archived
 * sessions count toward Mine membership, while the column engine ignores them for
 * workflow placement, status, owners, and unread state.
 * Unresolved comments are intentionally NOT joined here — each `WiredKanbanCard`
 * runs its own live query keyed by `task_id`, so comment churn re-renders only
 * that card while this board-level query stays stable.
 */
export function useKanbanColumns(scope: TaskScope = DEFAULT_SCOPE) {
	const { tasksCollection, sessionsCollection } = useSync()
	const { membersMap } = useOrgMembers()
	const unreadSessionIds = useUnreadStore((s) => s.unreadSessionIds)

	const mode = scope.mode
	const selectedUserIds = scope.selectedUserIds

	const { data: taskRows, isReady: tasksReady } = useLiveQuery(
		(q) =>
			q
				.from({ tasks: tasksCollection })
				.where(({ tasks }) => {
					const visibleTask = and(eq(tasks.archived, false), eq(tasks.is_draft, false))

					if (mode === 'mine') {
						return visibleTask
					}

					if (selectedUserIds.length > 0) {
						return and(visibleTask, inArray(tasks.resource_owner_user_id, selectedUserIds))
					}

					return visibleTask
				})
				.select(({ tasks }) => ({
					id: tasks.id,
					name: tasks.name,
					created_at: tasks.created_at,
					archived: tasks.archived,
					is_draft: tasks.is_draft,
					resource_owner_user_id: tasks.resource_owner_user_id,
				})),
		[tasksCollection, mode, selectedUserIds],
	)

	const visibleTaskIds = useMemo(() => (taskRows ?? []).map((task) => task.id), [taskRows])
	const visibleTaskIdsKey = visibleTaskIds.join('\0')
	const sessionsQuery = useLiveQuery(
		(q) => {
			if (visibleTaskIds.length === 0) return undefined

			return q
				.from({ sessions: sessionsCollection })
				.where(({ sessions }) => inArray(sessions.task_id, visibleTaskIds))
				.select(({ sessions }) => ({
					id: sessions.id,
					task_id: sessions.task_id,
					created_by: sessions.created_by,
					resource_owner_user_id: sessions.resource_owner_user_id,
					labels: sessions.labels,
					archived: sessions.archived,
					last_activity_at: sessions.last_activity_at,
					status: sessions.status,
				}))
		},
		[sessionsCollection, visibleTaskIdsKey],
	)

	const sessionsByTaskId = useMemo(() => {
		const map = new Map<string, NonNullable<typeof sessionsQuery.data>[number][]>()
		for (const session of sessionsQuery.data ?? []) {
			if (!session.task_id) continue
			const taskSessions = map.get(session.task_id) ?? []
			taskSessions.push(session)
			map.set(session.task_id, taskSessions)
		}

		for (const taskSessions of map.values()) {
			taskSessions.sort((a, b) => {
				const aActivity = a.last_activity_at ?? 0n
				const bActivity = b.last_activity_at ?? 0n
				return aActivity === bActivity ? 0 : aActivity > bActivity ? -1 : 1
			})
		}

		return map
	}, [sessionsQuery.data])

	const { data: ownerRows, isReady: ownersReady } = useLiveQuery(
		(q) =>
			q
				.from({ tasks: tasksCollection })
				.where(({ tasks }) => and(eq(tasks.archived, false), eq(tasks.is_draft, false)))
				.select(({ tasks }) => ({
					resource_owner_user_id: tasks.resource_owner_user_id,
				})),
		[tasksCollection],
	)

	const columns = useMemo<KanbanColumns>(() => {
		const visibleTaskRows = (taskRows ?? []).filter((task) => {
			if (!isTaskEligibleForBoard(task, scope)) return false
			return matchesTaskScope(
				task,
				(sessionsByTaskId.get(task.id) ?? []).map((session) => session.created_by),
				scope,
			)
		})

		const tasks: KanbanTaskInput[] = visibleTaskRows.map((task) => ({
			id: task.id,
			name: task.name,
			created_at: task.created_at,
			is_draft: task.is_draft ?? false,
			resource_owner_user_id: task.resource_owner_user_id,
			sessions: (sessionsByTaskId.get(task.id) ?? []).map(
				(s): KanbanSessionInput => ({
					id: s.id,
					archived: s.archived ?? false,
					labels: (s.labels as SessionLabel[] | null) ?? null,
					last_activity_at: s.last_activity_at,
					resource_owner_user_id: s.resource_owner_user_id,
					status: s.status,
				}),
			),
		}))

		return buildKanbanColumns({
			tasks,
			unreadSessionIds,
			resolveOwner: (ownerId) => {
				const member = ownerId ? membersMap.get(ownerId) : undefined
				const displayName = member
					? [member.firstName, member.lastName].filter(Boolean).join(' ') || member.email
					: undefined
				return {
					initials: getInitials(displayName),
					avatarUrl: member?.profilePictureUrl,
				}
			},
		})
	}, [taskRows, sessionsByTaskId, membersMap, scope, unreadSessionIds])

	const totalCards = useMemo(() => columns.reduce((sum, column) => sum + column.cards.length, 0), [columns])

	// Total non-archived, non-draft tasks regardless of the Mine/Everything filter. Used to
	// drive the board's empty state: zero here means there are genuinely no tasks
	// (first-run), as opposed to the filter merely hiding everything.
	const totalTaskCount = ownerRows?.length ?? 0

	// Candidate users for the multi-select: org members that own at least one
	// active task. Keep this independent from the filtered board query so the
	// dropdown list remains stable while users are selected.
	const userOptions = useMemo<UserOption[]>(() => {
		const ownerIds = new Set<string>()
		for (const task of ownerRows ?? []) {
			if (task.resource_owner_user_id) ownerIds.add(task.resource_owner_user_id)
		}

		const options: UserOption[] = []
		for (const member of membersMap.values()) {
			const displayName = [member.firstName, member.lastName].filter(Boolean).join(' ') || member.email
			options.push({
				id: member.id,
				name: displayName,
				avatarUrl: member.profilePictureUrl,
				initials: getInitials(displayName),
			})
		}

		// Keep already-selected users available even if they own no current task,
		// so the filter selection stays togglable.
		return options
			.filter((option) => ownerIds.has(option.id) || selectedUserIds.includes(option.id))
			.sort((a, b) => a.name.localeCompare(b.name))
	}, [ownerRows, membersMap, selectedUserIds])

	const ownerByTaskId = useMemo(() => {
		const map = new Map<string, string | null>()
		for (const task of taskRows ?? []) {
			map.set(task.id, task.resource_owner_user_id ?? null)
		}
		return map
	}, [taskRows])

	// Non-archived session ids per task, keyed by task id. Consumed by the archive
	// action so it can cascade without re-querying every session in the org.
	const sessionIdsByTaskId = useMemo(() => {
		const map = new Map<string, string[]>()
		for (const task of taskRows ?? []) {
			map.set(
				task.id,
				(sessionsByTaskId.get(task.id) ?? [])
					.filter((session) => !session.archived)
					.map((session) => session.id),
			)
		}
		return map
	}, [taskRows, sessionsByTaskId])

	const sessionsReady = visibleTaskIds.length === 0 || sessionsQuery.isReady
	const isReady = tasksReady && sessionsReady && ownersReady

	return { columns, userOptions, totalCards, totalTaskCount, isReady, ownerByTaskId, sessionIdsByTaskId }
}

export type UseKanbanColumnsResult = ReturnType<typeof useKanbanColumns>
