import { useRef } from 'react'

import type { TaskSummaryHandle } from '@/components/TaskSummary'
import { useTaskArchive } from '@/hooks/task-detail/useTaskArchive'
import { useTaskArchiveAction } from '@/hooks/task-detail/useTaskArchiveAction'
import { useTaskCopyUrlAction } from '@/hooks/task-detail/useTaskCopyUrlAction'
import { useTaskCreateSessionAction } from '@/hooks/task-detail/useTaskCreateSessionAction'
import { useTaskDetailData } from '@/hooks/task-detail/useTaskDetailData'
import { useTaskEditActions } from '@/hooks/task-detail/useTaskEditActions'
import { useTaskSessionsTable } from '@/hooks/task-detail/useTaskSessionsTable'
import { useTaskTerminal } from '@/hooks/task-detail/useTaskTerminal'
import { useRecordNavigationVisit } from '@/hooks/useRecordNavigationVisit'

export function useTaskDetailPageState({ taskId, from }: { taskId: string; from?: 'archive-tasks' }) {
	useRecordNavigationVisit(taskId, 'task')
	const data = useTaskDetailData(taskId)
	const { task, sessions, canEditTask, resolvedWorkingDirectory } = data
	const sessionsTable = useTaskSessionsTable({ taskId, from, sessions })
	const terminal = useTaskTerminal({
		taskId,
		task,
		canEditTask,
		isTaskOwner: data.isTaskOwner,
		hasUserSettings: data.hasUserSettings,
		resolvedWorkingDirectory,
	})
	const { handleArchiveTask } = useTaskArchive({ task, sessions })

	useTaskArchiveAction({ canEditTask, onArchiveTask: handleArchiveTask })
	useTaskCopyUrlAction({ taskId })
	useTaskCreateSessionAction({
		canCreateSession: data.canCreateSession,
		onCreateSession: sessionsTable.handleCreateSession,
	})

	const taskSummaryRef = useRef<TaskSummaryHandle | null>(null)
	useTaskEditActions({ canEditTask, taskSummaryRef })

	return {
		taskId,
		task,
		data,
		sessionsTable,
		terminal,
		onArchiveTask: handleArchiveTask,
		taskSummaryRef,
	}
}

export type TaskDetailPageState = ReturnType<typeof useTaskDetailPageState>
export type LoadedTaskDetailPageState = Omit<TaskDetailPageState, 'task'> & {
	task: NonNullable<TaskDetailPageState['task']>
}
