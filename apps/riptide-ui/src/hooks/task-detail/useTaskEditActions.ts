import { Folder, Pencil } from 'lucide-react'
import { type RefObject, useCallback } from 'react'

import type { TaskSummaryHandle } from '@/components/TaskSummary'
import { useCommandPaletteAction } from '@/hooks/useCommandPaletteAction'
import { hotkeysCatalog } from '@/hotkeysCatalog'

/**
 * Registers the task-detail "Rename Task" and "Edit Working Directory" command
 * palette actions. Mirrors the ⇧R / ⇧D hotkeys in useTaskDetailHotkeys, driving
 * the same TaskSummary inline editors through the shared ref (no-ops if the
 * summary isn't mounted).
 */
export function useTaskEditActions({
	canEditTask,
	taskSummaryRef,
}: {
	canEditTask: boolean
	taskSummaryRef: RefObject<TaskSummaryHandle | null>
}): void {
	const handleRenameTask = useCallback(() => {
		taskSummaryRef.current?.startEditName()
	}, [taskSummaryRef])

	const handleEditWorkingDirectory = useCallback(() => {
		taskSummaryRef.current?.startEditDirectory()
	}, [taskSummaryRef])

	useCommandPaletteAction({
		id: 'rename-task',
		label: 'Rename Task',
		icon: Pencil,
		shortcut: hotkeysCatalog.taskDetail.shortcuts.rename.display,
		enabled: canEditTask,
		onSelect: handleRenameTask,
	})

	useCommandPaletteAction({
		id: 'edit-working-directory',
		label: 'Edit Working Directory',
		icon: Folder,
		shortcut: hotkeysCatalog.taskDetail.shortcuts.editDirectory.display,
		enabled: canEditTask,
		onSelect: handleEditWorkingDirectory,
	})
}
