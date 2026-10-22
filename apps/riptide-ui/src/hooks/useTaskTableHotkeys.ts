import { useHotkeys } from '@humanlayer/react-hotkeys-hook'
import { useCallback } from 'react'

import type { TableTask } from '@/components/task-table/TaskTable'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { useArchiveHotkey } from '@/hooks/hotkeys/useArchiveHotkey'
import { useFocusStore } from '@/hooks/stores/focusStore'
import { hotkeysCatalog } from '@/hotkeysCatalog'
import { copyTaskDeepLink } from '@/utils/sharing-links'

/**
 * Keyboard navigation and actions for a task table on the sessions list page:
 * j/k/gg/G focus movement (scrolling the focused row into view), Enter to
 * activate, and optionally E to archive. Focus lives in the focus store.
 */
export function useTaskTableHotkeys({
	tasks,
	onActivate,
	onArchive,
}: {
	tasks: TableTask[]
	onActivate: (task: TableTask) => void
	/** When provided, registers the E archive hotkey. */
	onArchive?: (task: TableTask) => void
}) {
	const focusedTaskId = useFocusStore((s) => s.focusedTaskId)
	const hasTasks = tasks.length > 0

	const focusTask = useCallback((taskId: string) => {
		useFocusStore.getState().setFocusedTaskId(taskId, 'keyboard')
		// Keep the focused row visible during keyboard navigation
		document.querySelector(`[data-task-id="${taskId}"]`)?.scrollIntoView({ behavior: 'instant', block: 'nearest' })
	}, [])

	useHotkeys(
		'j',
		() => {
			if (!hasTasks) return
			const focusedId = useFocusStore.getState().focusedTaskId
			const currentIndex = tasks.findIndex((t) => t.id === focusedId)
			const nextIndex = currentIndex >= tasks.length - 1 ? 0 : currentIndex + 1
			const nextTask = tasks[nextIndex]
			if (nextTask === undefined) return
			focusTask(nextTask.id)
		},
		{ scopes: [HOTKEY_SCOPES.SESSIONS_LIST], enabled: hasTasks, preventDefault: true },
		[tasks, hasTasks, focusTask],
	)

	useHotkeys(
		'k',
		() => {
			if (!hasTasks) return
			const focusedId = useFocusStore.getState().focusedTaskId
			const currentIndex = tasks.findIndex((t) => t.id === focusedId)
			const prevIndex = currentIndex <= 0 ? tasks.length - 1 : currentIndex - 1
			const prevTask = tasks[prevIndex]
			if (prevTask === undefined) return
			focusTask(prevTask.id)
		},
		{ scopes: [HOTKEY_SCOPES.SESSIONS_LIST], enabled: hasTasks, preventDefault: true },
		[tasks, hasTasks, focusTask],
	)

	// g>g - Jump to first task (vim-style)
	useHotkeys(
		'g>g',
		() => {
			if (!hasTasks) return
			const firstTask = tasks[0]
			if (firstTask === undefined) return
			focusTask(firstTask.id)
		},
		{ scopes: [HOTKEY_SCOPES.SESSIONS_LIST], enabled: hasTasks, enableOnFormTags: false, preventDefault: true },
		[tasks, hasTasks, focusTask],
	)

	// shift+g - Jump to last task (vim-style)
	useHotkeys(
		'shift+g',
		() => {
			if (!hasTasks) return
			const lastTask = tasks[tasks.length - 1]
			if (lastTask === undefined) return
			focusTask(lastTask.id)
		},
		{ scopes: [HOTKEY_SCOPES.SESSIONS_LIST], enabled: hasTasks, enableOnFormTags: false, preventDefault: true },
		[tasks, hasTasks, focusTask],
	)

	useHotkeys(
		'enter',
		() => {
			if (!focusedTaskId) return
			const task = tasks.find((t) => t.id === focusedTaskId)
			if (task) onActivate(task)
		},
		{ scopes: [HOTKEY_SCOPES.SESSIONS_LIST], enabled: focusedTaskId !== null, preventDefault: true },
		[tasks, focusedTaskId, onActivate],
	)

	// Archive/unarchive focused task (settings-selected binding)
	useArchiveHotkey(
		() => {
			if (!focusedTaskId || !onArchive) return
			const task = tasks.find((t) => t.id === focusedTaskId)
			if (task) onArchive(task)
		},
		{
			scopes: [HOTKEY_SCOPES.SESSIONS_LIST],
			enabled: !!onArchive && focusedTaskId !== null,
			preventDefault: true,
			enableOnFormTags: false,
		},
		[tasks, focusedTaskId, onArchive],
	)

	useHotkeys(
		hotkeysCatalog.global.shortcuts.copyPrimaryUrl.reactHotkeys,
		(e) => {
			e.preventDefault()
			if (!focusedTaskId) return
			const task = tasks.find((candidate) => candidate.id === focusedTaskId)
			if (task && !task.is_draft) void copyTaskDeepLink(task.id)
		},
		{
			scopes: [HOTKEY_SCOPES.SESSIONS_LIST],
			enabled: focusedTaskId !== null,
			preventDefault: true,
			enableOnFormTags: false,
		},
		[tasks, focusedTaskId],
	)
}
