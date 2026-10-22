import { useHotkeys } from '@humanlayer/react-hotkeys-hook'

import type { TableSession } from '@/components/session-table/types'
import { useArchiveHotkey } from '@/hooks/hotkeys/useArchiveHotkey'
import { useFocusStore } from '@/hooks/stores/focusStore'
import { hotkeysCatalog } from '@/hotkeysCatalog'
import { copySessionDeepLink } from '@/utils/sharing-links'

import type { HotkeyScope } from './hotkeys/scopes'

export interface UseSessionTableHotkeysOptions {
	sessions: TableSession[]
	editingSessionId: string | null
	scope: HotkeyScope
	enabled?: boolean

	// Navigation
	onFocusNext: () => void
	onFocusPrevious: () => void
	onFocusFirst: () => void
	onFocusLast: () => void

	// Actions
	onActivateSession: (session: TableSession) => void
	onActivateDraft?: (session: TableSession) => void
	onStartEdit: (session: TableSession) => void
	onArchiveOrDiscard: (session: TableSession) => void
	onBypassPermissions: (sessionId: string) => void
	onAutoAcceptEdits?: (sessionId: string) => void
}

export function useSessionTableHotkeys({
	sessions,
	editingSessionId,
	scope,
	enabled = true,
	onFocusNext,
	onFocusPrevious,
	onFocusFirst,
	onFocusLast,
	onActivateSession,
	onActivateDraft,
	onStartEdit,
	onArchiveOrDiscard,
	onBypassPermissions,
	onAutoAcceptEdits,
}: UseSessionTableHotkeysOptions) {
	const isEditing = editingSessionId !== null
	const hasFocus = useFocusStore((state) => state.focusedSessionId !== null)
	const hasCopyableSessions = sessions.some((session) => session.status !== 'draft')
	const getFocusedSession = () => {
		const focusedSessionId = useFocusStore.getState().focusedSessionId
		return sessions.find((session) => session.id === focusedSessionId) ?? null
	}

	// j / ArrowDown - Navigate down
	useHotkeys(
		'j, ArrowDown',
		() => onFocusNext(),
		{
			scopes: [scope],
			enabled: enabled && !isEditing,
		},
		[onFocusNext, isEditing],
	)

	// k / ArrowUp - Navigate up
	useHotkeys(
		'k, ArrowUp',
		() => onFocusPrevious(),
		{
			scopes: [scope],
			enabled: enabled && !isEditing,
		},
		[onFocusPrevious, isEditing],
	)

	// g>g - Jump to top of list (vim-style)
	useHotkeys(
		'g>g',
		() => onFocusFirst(),
		{
			scopes: [scope],
			enabled: enabled && !isEditing,
			enableOnFormTags: false,
			preventDefault: true,
		},
		[onFocusFirst, isEditing],
	)

	// shift+g - Jump to bottom of list (vim-style)
	useHotkeys(
		'shift+g',
		() => onFocusLast(),
		{
			scopes: [scope],
			enabled: enabled && !isEditing,
			enableOnFormTags: false,
			preventDefault: true,
		},
		[onFocusLast, isEditing],
	)

	// enter - Activate focused session (or draft if applicable)
	useHotkeys(
		'enter',
		() => {
			const focusedSession = getFocusedSession()
			if (focusedSession) {
				// Check if this is a draft and we have a draft handler
				if (focusedSession.status === 'draft' && onActivateDraft) {
					onActivateDraft(focusedSession)
				} else {
					onActivateSession(focusedSession)
				}
			}
		},
		{
			scopes: [scope],
			enabled: enabled && !isEditing && hasFocus,
		},
		[sessions, onActivateSession, onActivateDraft, isEditing],
	)

	// shift+r - Start editing focused session title
	useHotkeys(
		'shift+r',
		() => {
			const focusedSession = getFocusedSession()
			if (focusedSession) {
				onStartEdit(focusedSession)
			}
		},
		{
			scopes: [scope],
			enabled: enabled && !isEditing && hasFocus,
			preventDefault: true,
			enableOnFormTags: false,
		},
		[sessions, onStartEdit, isEditing],
	)

	// Archive/discard focused session (settings-selected binding)
	useArchiveHotkey(
		() => {
			const focusedSession = getFocusedSession()
			if (focusedSession) {
				onArchiveOrDiscard(focusedSession)
			}
		},
		{
			scopes: [scope],
			enabled: enabled && !isEditing && hasFocus,
			preventDefault: true,
			enableOnFormTags: false,
		},
		[sessions, onArchiveOrDiscard, isEditing],
	)

	// alt+y / option+y - Bypass permissions
	useHotkeys(
		'alt+y, option+y',
		() => {
			const focusedSession = getFocusedSession()
			if (focusedSession) {
				onBypassPermissions(focusedSession.id)
			}
		},
		{
			scopes: [scope],
			enabled: enabled && !isEditing && hasFocus,
			preventDefault: true,
		},
		[sessions, onBypassPermissions, isEditing],
	)

	// alt+a / option+a - Auto-accept edits
	useHotkeys(
		'alt+a, option+a',
		() => {
			const focusedSession = getFocusedSession()
			if (focusedSession) {
				onAutoAcceptEdits?.(focusedSession.id)
			}
		},
		{
			scopes: [scope],
			enabled: enabled && !isEditing && hasFocus,
			preventDefault: true,
		},
		[sessions, onAutoAcceptEdits, isEditing],
	)

	useHotkeys(
		hotkeysCatalog.global.shortcuts.copyPrimaryUrl.reactHotkeys,
		(e) => {
			e.preventDefault()
			const focusedSession = getFocusedSession()
			if (focusedSession && focusedSession.status !== 'draft') void copySessionDeepLink(focusedSession.id)
		},
		{
			scopes: [scope],
			enabled: enabled && !isEditing && hasFocus && hasCopyableSessions,
			preventDefault: true,
			enableOnFormTags: false,
		},
		[sessions, isEditing, enabled, hasCopyableSessions],
	)
}
