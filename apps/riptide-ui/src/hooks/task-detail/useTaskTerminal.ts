import { useHotkeys } from '@humanlayer/react-hotkeys-hook'
import { useLocalStorage } from '@uidotdev/usehooks'
import { FolderOpen, Terminal } from 'lucide-react'
import { useCallback } from 'react'
import { toast } from 'sonner'

import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import type { TaskDetailTask } from '@/hooks/task-detail/useTaskDetailData'
import { useCommandPaletteAction } from '@/hooks/useCommandPaletteAction'
import { hotkeysCatalog } from '@/hotkeysCatalog'
import { openWorkingDirectoryInEditor } from '@/lib/file-opener'
import { isDesktop } from '@/lib/utils'

/**
 * Terminal panel state for the task detail page: per-task open/closed
 * persistence, the toggle handler (with its missing-working-directory guard),
 * the Cmd+J hotkey + command palette action, and the Cmd+Shift+O
 * open-working-directory-in-editor hotkey.
 */
export function useTaskTerminal({
	taskId,
	task,
	canEditTask,
	isTaskOwner,
	hasUserSettings,
	resolvedWorkingDirectory,
}: {
	taskId: string
	task: TaskDetailTask | undefined
	canEditTask: boolean
	isTaskOwner: boolean
	hasUserSettings: boolean
	resolvedWorkingDirectory: string | null
}) {
	// Terminal state — persisted per task so it survives navigation between task and session views
	const [isTerminalOpen, setIsTerminalOpen] = useLocalStorage<boolean>(`terminal-open-task-${taskId}`, false)

	const handleToggleTerminal = useCallback(() => {
		if (!resolvedWorkingDirectory) {
			if (!isTaskOwner && !hasUserSettings) {
				toast.error('You need to create a session first to set a working directory')
			}
			return
		}
		setIsTerminalOpen((prev) => !prev)
	}, [resolvedWorkingDirectory, isTaskOwner, hasUserSettings, setIsTerminalOpen])

	// Cmd+J - Toggle terminal panel (desktop apps only, with edit permission)
	useHotkeys(
		'mod+j',
		() => {
			if (!isDesktop() || !canEditTask) return
			handleToggleTerminal()
		},
		{
			scopes: [HOTKEY_SCOPES.TASK_DETAIL, HOTKEY_SCOPES.ARTIFACT_PANEL],
			enabled: !!task && canEditTask,
			preventDefault: true,
			enableOnFormTags: true,
			enableOnContentEditable: true,
		},
		[task, canEditTask, handleToggleTerminal],
	)

	useCommandPaletteAction({
		id: 'toggle-terminal',
		label: 'Toggle Terminal',
		icon: Terminal,
		shortcut: hotkeysCatalog.desktopApp.shortcuts.toggleTerminal.display,
		enabled: isDesktop() && canEditTask,
		onSelect: useCallback(() => {
			if (!resolvedWorkingDirectory) {
				toast.warning('Set a working directory first')
				return
			}
			setIsTerminalOpen((prev) => !prev)
		}, [resolvedWorkingDirectory, setIsTerminalOpen]),
	})

	// Cmd+Shift+O - Open working directory in editor
	useHotkeys(
		'mod+shift+o',
		() => {
			if (!isDesktop() || !resolvedWorkingDirectory) return
			openWorkingDirectoryInEditor(resolvedWorkingDirectory)
		},
		{
			scopes: [HOTKEY_SCOPES.TASK_DETAIL, HOTKEY_SCOPES.ARTIFACT_PANEL],
			enabled: isDesktop() && !!resolvedWorkingDirectory,
			preventDefault: true,
			enableOnFormTags: true,
			enableOnContentEditable: true,
		},
		[resolvedWorkingDirectory],
	)

	useCommandPaletteAction({
		id: 'open-working-directory-in-editor',
		label: 'Open Working Directory in Editor',
		icon: FolderOpen,
		shortcut: hotkeysCatalog.desktopApp.shortcuts.openEditor.display,
		enabled: isDesktop() && Boolean(resolvedWorkingDirectory),
		onSelect: useCallback(() => {
			if (resolvedWorkingDirectory) openWorkingDirectoryInEditor(resolvedWorkingDirectory)
		}, [resolvedWorkingDirectory]),
	})

	return {
		isTerminalOpen,
		setIsTerminalOpen,
		handleToggleTerminal,
	}
}
