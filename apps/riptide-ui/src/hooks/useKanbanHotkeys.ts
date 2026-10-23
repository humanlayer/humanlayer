import type { KanbanColumns } from '@humanlayer/ui/components/kanban'
import { useNavigate } from '@tanstack/react-router'

import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { useAppHotkeys } from '@/hooks/hotkeys/useAppHotkeys'
import { useArchiveHotkey } from '@/hooks/hotkeys/useArchiveHotkey'
import { useCommandPaletteStore } from '@/hooks/stores/commandPaletteStore'
import { useKanbanFocusStore } from '@/hooks/stores/kanbanFocusStore'
import { hotkeysCatalog } from '@/hotkeysCatalog'
import { copyTaskDeepLink } from '@/utils/sharing-links'

export interface UseKanbanHotkeysOptions {
	/**
	 * Archive the focused task. Ownership-agnostic: WiredBoardTasksView supplies a resolver
	 * that routes to owner-archive vs admin force-archive based on the focused card,
	 * keeping this hook unaware of ownership. Bound to `e`.
	 */
	onArchiveTask?: (taskId: string) => void
	/** Admin force-rename the focused task (board-level shared dialog). Bound to `⇧R`. */
	onRenameTask?: (taskId: string) => void
	enabled?: boolean
}

/**
 * Keyboard navigation for the Kanban board.
 *
 * Mounted by the (live-only) Kanban tab, so it is active exactly while the board
 * is on screen. Movement keys delegate to `kanbanFocusStore`, which derives the
 * next focused card from the current `columns` array.
 *
 * - `j` / ArrowDown, `k` / ArrowUp  : move within a column (clamped)
 * - `h` / ArrowLeft, `l` / ArrowRight: move across non-empty columns (row preserved)
 * - `Enter`                          : open the focused task
 * - `Esc`                            : clear focus
 * - `e`                              : archive the focused task (when permitted)
 */
const KANBAN_SCOPES = [HOTKEY_SCOPES.SESSIONS_LIST]

export function useKanbanHotkeys(columns: KanbanColumns, options: UseKanbanHotkeysOptions = {}) {
	const { onArchiveTask, onRenameTask, enabled = true } = options
	const navigate = useNavigate()
	const isCommandPaletteOpen = useCommandPaletteStore((s) => s.isOpen)

	const isEnabled = enabled && !isCommandPaletteOpen

	useAppHotkeys(
		'j, down',
		() => useKanbanFocusStore.getState().focusDown(columns),
		{ scopes: KANBAN_SCOPES, area: 'MAIN', enabled: isEnabled, preventDefault: true, enableOnFormTags: false },
		[columns, isEnabled],
	)

	useAppHotkeys(
		'k, up',
		() => useKanbanFocusStore.getState().focusUp(columns),
		{ scopes: KANBAN_SCOPES, area: 'MAIN', enabled: isEnabled, preventDefault: true, enableOnFormTags: false },
		[columns, isEnabled],
	)

	useAppHotkeys(
		'h, left',
		() => useKanbanFocusStore.getState().focusLeft(columns),
		{ scopes: KANBAN_SCOPES, area: 'MAIN', enabled: isEnabled, preventDefault: true, enableOnFormTags: false },
		[columns, isEnabled],
	)

	useAppHotkeys(
		'l, right',
		() => useKanbanFocusStore.getState().focusRight(columns),
		{ scopes: KANBAN_SCOPES, area: 'MAIN', enabled: isEnabled, preventDefault: true, enableOnFormTags: false },
		[columns, isEnabled],
	)

	useAppHotkeys(
		'enter',
		() => {
			const taskId = useKanbanFocusStore.getState().focusedTaskId
			if (!taskId) return
			// Drafts open the new-task form; launched tasks open their detail page.
			const focusedCard = columns.flatMap((column) => column.cards).find((card) => card.id === taskId)
			if (focusedCard?.isDraft) {
				navigate({ to: '/tasks/new', search: { draftId: taskId } })
			} else {
				navigate({ to: '/tasks/$taskId', params: { taskId } })
			}
		},
		{ scopes: KANBAN_SCOPES, area: 'MAIN', enabled: isEnabled, preventDefault: true, enableOnFormTags: false },
		[navigate, isEnabled, columns],
	)

	useAppHotkeys(
		'escape',
		() => useKanbanFocusStore.getState().clearFocus(),
		{ scopes: KANBAN_SCOPES, area: 'MAIN', enabled: isEnabled },
		[isEnabled],
	)

	// Archive focused task (settings-selected binding)
	useArchiveHotkey(
		() => {
			const taskId = useKanbanFocusStore.getState().focusedTaskId
			if (taskId) onArchiveTask?.(taskId)
		},
		{
			scopes: KANBAN_SCOPES,
			area: 'MAIN',
			enabled: isEnabled && onArchiveTask !== undefined,
			preventDefault: true,
			enableOnFormTags: false,
		},
		[onArchiveTask, isEnabled],
	)

	useAppHotkeys(
		'shift+r',
		() => {
			const taskId = useKanbanFocusStore.getState().focusedTaskId
			if (taskId) onRenameTask?.(taskId)
		},
		{
			scopes: KANBAN_SCOPES,
			area: 'MAIN',
			enabled: isEnabled && onRenameTask !== undefined,
			preventDefault: true,
			enableOnFormTags: false,
		},
		[onRenameTask, isEnabled],
	)

	useAppHotkeys(
		hotkeysCatalog.global.shortcuts.copyPrimaryUrl.reactHotkeys,
		(e) => {
			e.preventDefault()
			const taskId = useKanbanFocusStore.getState().focusedTaskId
			const card = columns.flatMap((column) => column.cards).find((candidate) => candidate.id === taskId)
			if (taskId && !card?.isDraft) void copyTaskDeepLink(taskId)
		},
		{ scopes: KANBAN_SCOPES, area: 'MAIN', enabled: isEnabled, preventDefault: true, enableOnFormTags: false },
		[columns, isEnabled],
	)
}
