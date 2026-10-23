import { TaskViewControls } from '@humanlayer/ui/components/task-view-controls'
import type { UserOption } from '@humanlayer/ui/components/user-multi-select'
import { getInitials } from '@humanlayer/ui/lib/comment-utils'
import { eq, useLiveQuery } from '@tanstack/react-db'
import { useNavigate } from '@tanstack/react-router'
import { useAuth } from '@workos-inc/authkit-react'
import { useCallback, useMemo, useState } from 'react'

import { PermissionsDialog } from '@/components/PermissionsDialog'
import { useSync } from '@/components/providers/SyncProvider'
import { type TableTask, TaskTable } from '@/components/task-table/TaskTable'
import { useUnreadTaskIds } from '@/hooks/live-queries/useUnreadTaskIds'
import { useFocusStore } from '@/hooks/stores/focusStore'
import { useTaskDiffReviewMarksStore } from '@/hooks/stores/taskDiffReviewMarksStore'
import { useTaskViewPreferencesStore } from '@/hooks/stores/taskViewPreferencesStore'
import { useTerminalStore } from '@/hooks/stores/terminalStore'
import { useOrgMembers } from '@/hooks/useOrgMembers'
import { useTaskActions } from '@/hooks/useTaskActions'
import { useTasksByRecency } from '@/hooks/useTasksByRecency'
import { useTaskTableHotkeys } from '@/hooks/useTaskTableHotkeys'
import { cleanupPtyForSession } from '@/integrations/desktop/pty'
import { groupTasksByWorkflow } from '@/lib/tasks/groupTasksByWorkflow'
import type { TaskScope } from '@/lib/tasks/taskScope'
import { showUndoToast } from '@/utils/undoToast'

/**
 * The List layout of the Tasks tab: the same scoped task set the Board shows,
 * rendered as one recency-sorted table. Owns its data, focus, hotkeys,
 * archive-with-undo (cascading to the task's sessions), and the permissions
 * dialog. Archive and share are offered only for rows the user owns.
 */
export function WiredListTasksView() {
	const navigate = useNavigate()
	const { user } = useAuth()
	const { sessionsCollection, tasksCollection, taskOrganizationAclsCollection } = useSync()
	const taskActions = useTaskActions()
	const focusedTaskId = useFocusStore((s) => s.focusedTaskId)

	const setLayout = useTaskViewPreferencesStore((s) => s.setLayout)
	const mode = useTaskViewPreferencesStore((s) => s.mode)
	const selectedUserIds = useTaskViewPreferencesStore((s) => s.selectedUserIds)
	const setMode = useTaskViewPreferencesStore((s) => s.setMode)
	const setSelectedUserIds = useTaskViewPreferencesStore((s) => s.setSelectedUserIds)
	const grouped = useTaskViewPreferencesStore((s) => s.grouped)
	const setGrouped = useTaskViewPreferencesStore((s) => s.setGrouped)
	const scope = useMemo<TaskScope>(
		() => ({ mode, selectedUserIds, currentUserId: user?.id ?? null }),
		[mode, selectedUserIds, user?.id],
	)

	const { tasks } = useTasksByRecency({ scope })
	const { membersMap: orgMembers } = useOrgMembers()
	const unreadTaskIds = useUnreadTaskIds()

	// Org ACLs mark which tasks are shared with the org
	const { data: taskAclData } = useLiveQuery(
		(q) => q.from({ acls: taskOrganizationAclsCollection }),
		[taskOrganizationAclsCollection],
	)
	const taskSharingState = useMemo(() => {
		const map = new Map<string, boolean>()
		for (const acl of taskAclData ?? []) {
			map.set(acl.task_id, true)
		}
		return map
	}, [taskAclData])

	// All visible sessions, used to apply the task archive cascade optimistically.
	// This matches Board: the API cascades every linked session regardless of
	// session owner, so local state should do the same before sync catches up.
	const { data: sessions } = useLiveQuery((q) => q.from({ sessions: sessionsCollection }), [sessionsCollection])

	// Owner choices for the Everything picker. Deliberately independent of the
	// active scope so the dropdown stays stable while owners are selected.
	const { data: ownerRows } = useLiveQuery(
		(q) =>
			q
				.from({ tasks: tasksCollection })
				.where(({ tasks }) => eq(tasks.archived, false))
				.select(({ tasks }) => ({ resource_owner_user_id: tasks.resource_owner_user_id })),
		[tasksCollection],
	)

	// Permissions dialog state
	const [permissionsDialogOpen, setPermissionsDialogOpen] = useState(false)
	const [permissionsTaskId, setPermissionsTaskId] = useState<string | null>(null)

	const tableTasks = useMemo<TableTask[]>(() => {
		return tasks.map((t) => ({
			...t,
			lastActivityAt: t.latestSessionActivity ? new Date(Number(t.latestSessionActivity)).toISOString() : '',
			created_at: Number(t.created_at),
			isSharedWithOrg: taskSharingState.get(t.id) ?? false,
			isOwner: user?.id ? t.resource_owner_user_id === user.id : false,
			isUnread: unreadTaskIds.has(t.id),
		}))
	}, [tasks, taskSharingState, user?.id, unreadTaskIds])

	const handleActivateTask = useCallback(
		(task: TableTask) => {
			if (task.is_draft) {
				navigate({ to: '/tasks/new', search: { draftId: task.id } })
				return
			}
			navigate({ to: '/tasks/$taskId', params: { taskId: task.id } })
		},
		[navigate],
	)

	const handleFocusTask = useCallback((task: TableTask) => {
		if (useFocusStore.getState().focusSource !== 'mouse') return
		useFocusStore.getState().setFocusedTaskId(task.id, 'mouse')
	}, [])
	const handleCreateSession = useCallback(
		(task: TableTask) => navigate({ to: '/sessions/draft', search: { taskId: task.id } }),
		[navigate],
	)

	// Archive/unarchive task with undo toast, cascading to the task's sessions.
	// Only the owner may archive — the table hides the action for other rows.
	const handleArchiveTask = useCallback(
		(task: TableTask) => {
			if (task.isOwner === false) return

			const isArchived = task.archived ?? false
			const newArchivedState = !isArchived

			const sessionIds = (sessions ?? [])
				.filter((s) => s.task_id === task.id && s.archived === isArchived)
				.map((s) => s.id)
			const sessionCount = sessionIds.length

			taskActions.archiveTask({
				taskId: task.id,
				archived: newArchivedState,
				cascadeToSessions: true,
				sessionIds,
			})

			if (newArchivedState) {
				// Clear terminal state for task and all cascaded sessions
				useTerminalStore.getState().clearTerminalState(`task-${task.id}`)
				useTaskDiffReviewMarksStore.getState().clearTask(task.id)
				cleanupPtyForSession(`task-${task.id}`)
				for (const sid of sessionIds) {
					cleanupPtyForSession(sid)
					useTerminalStore.getState().clearTerminalState(sid)
				}
			}

			const sessionSuffix = sessionCount > 0 ? ` + ${sessionCount} session${sessionCount !== 1 ? 's' : ''}` : ''

			showUndoToast({
				type: newArchivedState ? 'archive_task' : 'unarchive_task',
				entityId: task.id,
				title: newArchivedState ? 'Task Archived' : 'Task Un-archived',
				description: `${task.name}${sessionSuffix}`,
				onUndo: () => {
					taskActions.archiveTask({
						taskId: task.id,
						archived: !newArchivedState,
						cascadeToSessions: true,
						sessionIds,
					})
				},
			})

			// Move focus to next task
			const currentFocusedTaskId = useFocusStore.getState().focusedTaskId
			if (currentFocusedTaskId === task.id) {
				const currentIndex = tableTasks.findIndex((t) => t.id === task.id)
				const nextTask = tableTasks[currentIndex + 1] || tableTasks[currentIndex - 1]
				useFocusStore.getState().setFocusedTaskId(nextTask?.id ?? null, 'keyboard')
			}
		},
		[taskActions, sessions, tableTasks],
	)

	const handleManagePermissions = useCallback((task: TableTask) => {
		setPermissionsTaskId(task.id)
		setPermissionsDialogOpen(true)
	}, [])

	const groups = useMemo(() => (grouped ? groupTasksByWorkflow(tasks) : undefined), [grouped, tasks])

	// j/k, gg and G walk the rows in the order they are rendered, so grouping
	// reorders navigation without the hotkeys needing to know about groups.
	const navigableTasks = useMemo(() => {
		if (!groups) return tableTasks
		const byId = new Map(tableTasks.map((task) => [task.id, task]))
		return groups.flatMap((group) => group.taskIds.flatMap((id) => byId.get(id) ?? []))
	}, [groups, tableTasks])

	useTaskTableHotkeys({ tasks: navigableTasks, onActivate: handleActivateTask, onArchive: handleArchiveTask })

	const userOptions = useMemo<UserOption[]>(() => {
		const ownerIds = new Set<string>()
		for (const task of ownerRows ?? []) {
			if (task.resource_owner_user_id) ownerIds.add(task.resource_owner_user_id)
		}

		const options: UserOption[] = []
		for (const member of orgMembers.values()) {
			const displayName = [member.firstName, member.lastName].filter(Boolean).join(' ') || member.email
			options.push({
				id: member.id,
				name: displayName,
				avatarUrl: member.profilePictureUrl,
				initials: getInitials(displayName),
			})
		}

		return options
			.filter((option) => ownerIds.has(option.id) || scope.selectedUserIds.includes(option.id))
			.sort((a, b) => a.name.localeCompare(b.name))
	}, [ownerRows, orgMembers, scope.selectedUserIds])

	const selectedIds = useMemo(() => new Set(scope.selectedUserIds), [scope.selectedUserIds])

	return (
		<div className="flex h-full min-h-0 flex-col">
			<TaskViewControls
				layout="list"
				mode={scope.mode}
				selectedIds={selectedIds}
				users={userOptions}
				taskCount={tableTasks.length}
				grouped={grouped}
				onLayoutChange={setLayout}
				onModeChange={(next) => {
					setMode(next)
					setSelectedUserIds([])
				}}
				onSelectionChange={(next) => setSelectedUserIds(Array.from(next))}
				onGroupedChange={setGrouped}
			/>

			<TaskTable
				className="min-h-0 flex-1"
				tasks={tableTasks}
				groups={groups}
				focus={{ mode: 'controlled', focusedTaskId }}
				onRowClick={handleActivateTask}
				onRowMouseEnter={handleFocusTask}
				onArchiveTask={handleArchiveTask}
				onCreateSession={handleCreateSession}
				onManagePermissions={handleManagePermissions}
				orgMembers={orgMembers}
			/>

			{permissionsTaskId && (
				<PermissionsDialog
					taskId={permissionsTaskId}
					isOpen={permissionsDialogOpen}
					onOpenChange={setPermissionsDialogOpen}
				/>
			)}
		</div>
	)
}
