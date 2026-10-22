import { TaskRow, type TaskRowProps } from '@humanlayer/ui/components/sidebar/TaskRow'
import type { SidebarTask } from '@humanlayer/ui/components/sidebar/types'
import { eq, useLiveQuery } from '@tanstack/react-db'
import { useMatch, useNavigate } from '@tanstack/react-router'
import { useAuth } from '@workos-inc/authkit-react'
import { FolderArchive } from 'lucide-react'
import { useCallback, useState } from 'react'
import { toast } from 'sonner'

import { focusMainAndReleaseSpatialDomFocus } from '@/components/keyboard-focus-transfer'
import { PermissionsDialog } from '@/components/PermissionsDialog'
import { useSync } from '@/components/providers/SyncProvider'
import { RenameTaskDialog } from '@/components/RenameTaskDialog'
import { useFocusStore } from '@/hooks/stores/focusStore'
import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { useSidebarStore } from '@/hooks/stores/sidebarStore'
import { useArchiveTaskAction } from '@/hooks/useArchiveActions'
import { useCommandPaletteAction } from '@/hooks/useCommandPaletteAction'
import { useTaskActions } from '@/hooks/useTaskActions'
import { captureException } from '@/integrations/sentry/sentry'
import { copyTaskDeepLink } from '@/utils/sharing-links'

import { projectTaskDisclosure, useProjectTaskDisclosure } from '../project-sidebar/project-task-disclosure'
import { WiredSessionRow } from './WiredSessionRow'

function TaskArchivePaletteAction({ onSelect }: { onSelect: () => void }) {
	useCommandPaletteAction({
		id: 'archive-task',
		label: 'Archive Task',
		icon: FolderArchive,
		shortcut: 'E',
		onSelect,
	})
	return null
}

export function WiredTaskRow({
	task,
	allSessionIds,
	wrapRow,
	leadingIcon,
	projectTree = false,
}: {
	task: SidebarTask & { historySessions?: SidebarTask['sessions'] }
	allSessionIds?: string[]
	projectTree?: boolean
	wrapRow?: TaskRowProps['wrapRow']
	leadingIcon?: TaskRowProps['leadingIcon']
}) {
	const navigate = useNavigate()
	const { user } = useAuth()
	const taskMatch = useMatch({ from: '/_app/tasks/$taskId', shouldThrow: false })
	const sessionMatch = useMatch({ from: '/_app/sessions/$sessionId', shouldThrow: false })
	const routeSessionId = sessionMatch?.params.sessionId
	const { sessionsCollection } = useSync()
	const { data: routeSessionRows } = useLiveQuery(
		(q) => {
			if (!routeSessionId) return undefined
			return q
				.from({ sessions: sessionsCollection })
				.where(({ sessions }) => eq(sessions.id, routeSessionId))
				.select(({ sessions }) => ({ taskId: sessions.task_id }))
		},
		[sessionsCollection, routeSessionId],
	)
	const isSelected = taskMatch?.params.taskId === task.id && !routeSessionId
	const isFocused = useFocusStore(
		(state) => state.focusedSidebarItem?.type === 'task' && state.focusedSidebarItem.id === task.id,
	)
	const isPersistedExpanded = useSidebarStore((state) => state.expandedTaskIds.includes(task.id))
	const manual = useProjectTaskDisclosure((state) => state.manual[task.id])
	const automatic = isPersistedExpanded || routeSessionRows?.[0]?.taskId === task.id
	const disclosure = projectTaskDisclosure(task, manual, automatic)
	const isExpanded = projectTree ? disclosure.open : automatic
	const visibleSessions = projectTree ? disclosure.sessions : task.sessions
	const showTaskPhaseLabels = useSettingsStore((state) => state.showTaskPhaseLabels)
	const showTaskStatusIndicator = true
	const taskActions = useTaskActions()
	const archiveTask = useArchiveTaskAction()
	const canArchive = Boolean(user?.id && task.ownerUserId === user.id)
	const [renameOpen, setRenameOpen] = useState(false)
	const [permissionsOpen, setPermissionsOpen] = useState(false)

	const handleArchive = useCallback(
		() =>
			archiveTask({
				id: task.id,
				name: task.name,
				ownerUserId: task.ownerUserId,
				sessionIds: allSessionIds ?? task.sessions.map((session) => session.id),
			}),
		[archiveTask, task, allSessionIds],
	)

	const handleSaveName = useCallback(
		(taskId: string, name: string) => {
			const transaction = taskActions.updateTaskName({ taskId, name })
			transaction.isPersisted.promise.catch((error) => {
				toast.error('Failed to update task name')
				captureException(error, { extra: { action: 'updateTaskName', taskId } })
			})
		},
		[taskActions],
	)
	const handleCreateSession = useCallback(
		() => navigate({ to: '/sessions/draft', search: { taskId: task.id } }),
		[navigate, task.id],
	)

	return (
		<>
			{isFocused && canArchive ? <TaskArchivePaletteAction onSelect={handleArchive} /> : null}
			<TaskRow
				task={projectTree ? { ...task, sessions: task.historySessions ?? task.sessions } : task}
				wrapRow={wrapRow}
				leadingIcon={leadingIcon}
				projectTree={projectTree}
				isSelected={isSelected}
				isFocused={isFocused}
				showTaskPhaseLabels={showTaskPhaseLabels}
				showTaskStatusIndicator={showTaskStatusIndicator}
				open={isExpanded}
				onOpenChange={(open) => {
					if (projectTree) {
						useProjectTaskDisclosure.getState().setOpen(task.id, open)
						return
					}
					const sidebar = useSidebarStore.getState()
					if (open) sidebar.expandTask(task.id)
					else sidebar.collapseTask(task.id)
				}}
				onSelect={() => {
					useSidebarStore.getState().expandTask(task.id)
					navigate({ to: '/tasks/$taskId', params: { taskId: task.id } })
					focusMainAndReleaseSpatialDomFocus()
				}}
				onCreateSession={handleCreateSession}
				onRename={() => setRenameOpen(true)}
				onOpenPermissions={() => setPermissionsOpen(true)}
				onCopyDeepLink={() => void copyTaskDeepLink(task.id)}
				onArchive={canArchive ? handleArchive : undefined}
			>
				{visibleSessions.map((session) => (
					<WiredSessionRow key={session.id} session={session} taskId={task.id} projectTree={projectTree} />
				))}
			</TaskRow>
			<RenameTaskDialog
				taskId={task.id}
				currentName={task.name}
				isOpen={renameOpen}
				onOpenChange={setRenameOpen}
				onSave={handleSaveName}
			/>
			<PermissionsDialog taskId={task.id} isOpen={permissionsOpen} onOpenChange={setPermissionsOpen} />
		</>
	)
}
