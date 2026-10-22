import { Plus } from 'lucide-react'

import { useCommandPaletteAction } from '@/hooks/useCommandPaletteAction'
import { hotkeysCatalog } from '@/hotkeysCatalog'

/**
 * Registers the task-detail "Create Session in Task" command palette action.
 *
 * Mirrors the `c` hotkey in useTaskDetailHotkeys (opens the draft launcher with
 * this task pre-filled). Labeled distinctly from the palette's static "Create
 * Session" entry, which opens a blank draft without the task.
 */
export function useTaskCreateSessionAction({
	canCreateSession,
	onCreateSession,
}: {
	canCreateSession: boolean
	onCreateSession: () => void
}): void {
	useCommandPaletteAction({
		id: 'create-session-in-task',
		label: 'Create Session in Task',
		icon: Plus,
		shortcut: hotkeysCatalog.taskDetail.shortcuts.createSession.display,
		enabled: canCreateSession,
		onSelect: onCreateSession,
	})
}
