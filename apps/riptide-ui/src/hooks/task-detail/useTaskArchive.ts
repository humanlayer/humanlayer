import { useNavigate } from '@tanstack/react-router'
import { useCallback } from 'react'

import type { TableSession } from '@/components/session-table/types'
import { useTaskDiffReviewMarksStore } from '@/hooks/stores/taskDiffReviewMarksStore'
import { useTerminalStore } from '@/hooks/stores/terminalStore'
import type { TaskDetailTask } from '@/hooks/task-detail/useTaskDetailData'
import { useTaskActions } from '@/hooks/useTaskActions'
import { cleanupPtyForSession } from '@/integrations/desktop/pty'
import { showUndoToast } from '@/utils/undoToast'

/**
 * Archive/unarchive for the task detail page: cascades to the task's
 * sessions, cleans up their terminal state, shows an undo toast, and
 * navigates back to the tasks list after archiving.
 */
export function useTaskArchive({ task, sessions }: { task: TaskDetailTask | undefined; sessions: TableSession[] }) {
	const navigate = useNavigate()
	const taskActions = useTaskActions()

	const handleArchiveTask = useCallback(() => {
		if (!task) return
		const isArchived = task.archived ?? false
		const newArchivedState = !isArchived

		const sessionIds = sessions.map((s) => s.id)
		const sessionCount = sessionIds.length

		taskActions.archiveTask({
			taskId: task.id,
			archived: newArchivedState,
			cascadeToSessions: true,
			sessionIds,
		})

		if (newArchivedState) {
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

		if (newArchivedState) {
			navigate({ to: '/sessions' })
		}
	}, [task, sessions, taskActions, navigate])

	return { handleArchiveTask }
}
