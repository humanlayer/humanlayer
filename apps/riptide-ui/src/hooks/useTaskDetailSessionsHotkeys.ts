import type { TableSession } from '@/components/session-table/types'
import { useAppHotkeys } from '@/hooks/hotkeys/useAppHotkeys'
import { useArchiveHotkey } from '@/hooks/hotkeys/useArchiveHotkey'
import { useFocusStore } from '@/hooks/stores/focusStore'

import type { HotkeyScope } from './hotkeys/scopes'

export interface UseTaskDetailSessionsHotkeysOptions {
	sessions: TableSession[]
	scopes: HotkeyScope[]
	enabled?: boolean

	// Navigation callbacks
	onFocusNext: () => void
	onFocusPrevious: () => void
	onFocusFirst: () => void
	onFocusLast: () => void

	// Action callbacks
	onActivateSession: (session: TableSession) => void
	onActivateDraft: (session: TableSession) => void
	onArchive: (session: TableSession) => void
}

export function useTaskDetailSessionsHotkeys({
	sessions,
	scopes,
	enabled = true,
	onFocusNext,
	onFocusPrevious,
	onFocusFirst,
	onFocusLast,
	onActivateSession,
	onActivateDraft,
	onArchive,
}: UseTaskDetailSessionsHotkeysOptions) {
	const hasFocus = useFocusStore((state) => state.focusedSessionId !== null)
	const getFocusedSession = () => {
		const focusedSessionId = useFocusStore.getState().focusedSessionId
		return sessions.find((session) => session.id === focusedSessionId) ?? null
	}

	// j / ArrowDown - Navigate down (focus first if unfocused)
	useAppHotkeys(
		'j, ArrowDown',
		() => onFocusNext(),
		{
			scopes,
			area: 'MAIN',
			enabled,
			enableOnFormTags: false,
		},
		[onFocusNext],
	)

	// k / ArrowUp - Navigate up (focus last if unfocused)
	useAppHotkeys(
		'k, ArrowUp',
		() => onFocusPrevious(),
		{
			scopes,
			area: 'MAIN',
			enabled,
			enableOnFormTags: false,
		},
		[onFocusPrevious],
	)

	// g>g - Jump to top of list (vim-style)
	useAppHotkeys(
		'g>g',
		() => onFocusFirst(),
		{
			scopes,
			area: 'MAIN',
			enabled,
			enableOnFormTags: false,
			preventDefault: true,
		},
		[onFocusFirst],
	)

	// shift+g - Jump to bottom of list (vim-style)
	useAppHotkeys(
		'shift+g',
		() => onFocusLast(),
		{
			scopes,
			area: 'MAIN',
			enabled,
			enableOnFormTags: false,
			preventDefault: true,
		},
		[onFocusLast],
	)

	// enter - Activate focused session (or draft if applicable)
	useAppHotkeys(
		'enter',
		() => {
			const focusedSession = getFocusedSession()
			if (focusedSession) {
				if (focusedSession.status === 'draft') {
					onActivateDraft(focusedSession)
				} else {
					onActivateSession(focusedSession)
				}
			}
		},
		{
			scopes,
			area: 'MAIN',
			enabled: enabled && hasFocus,
		},
		[sessions, onActivateSession, onActivateDraft],
	)

	// Archive/unarchive focused session (settings-selected binding)
	useArchiveHotkey(
		() => {
			const focusedSession = getFocusedSession()
			if (focusedSession) {
				onArchive(focusedSession)
			}
		},
		{
			scopes,
			area: 'MAIN',
			enabled: enabled && hasFocus,
			enableOnFormTags: false,
			preventDefault: true,
		},
		[sessions, onArchive],
	)
}
