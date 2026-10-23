import { FolderArchive } from 'lucide-react'

import { useCommandPaletteAction } from '@/hooks/useCommandPaletteAction'
import { useKeybindingDisplays } from '@/hooks/useKeybindingDisplays'

/**
 * Registers the task-detail "Archive Task" command palette action.
 *
 * Mirrors the provider-level registration in `useTaskTerminal` (which registers
 * the "Toggle Terminal" action). Gated on `canEditTask` so the action only
 * appears when the user can archive, and reuses the existing archive handler
 * (`useTaskArchive.handleArchiveTask`, which archives + navigates to `/sessions`).
 */
export function useTaskArchiveAction({
	canEditTask,
	onArchiveTask,
}: {
	canEditTask: boolean
	onArchiveTask: () => void
}): void {
	const keybindingDisplays = useKeybindingDisplays()
	useCommandPaletteAction({
		id: 'archive-task',
		label: 'Archive Task',
		icon: FolderArchive,
		shortcut: keybindingDisplays.archive,
		enabled: canEditTask,
		onSelect: onArchiveTask,
	})
}
