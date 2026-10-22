import { useHotkeys } from '@humanlayer/react-hotkeys-hook'

import type { TableSession } from '@/components/session-table/types'

export interface UseSessionTableHotkeysOptions {
	sessions: TableSession[]
	focusedSessionId: string | null
	editingSessionId: string | null
	scope: string
	enabled?: boolean

	// Navigation
	onFocusNext: () => void
	onFocusPrevious: () => void

	// Actions
	onActivateSession: (session: TableSession) => void
	onStartEdit: (session: TableSession) => void
	onArchiveOrDiscard: (session: TableSession) => void
	onBypassPermissions: (sessionId: string) => void
}

export function useSessionTableHotkeys({
	sessions,
	focusedSessionId,
	editingSessionId,
	scope,
	enabled = true,
	onFocusNext,
	onFocusPrevious,
	onActivateSession,
	onStartEdit,
	onArchiveOrDiscard,
	onBypassPermissions,
}: UseSessionTableHotkeysOptions) {
	const focusedSession = sessions.find((s) => s.id === focusedSessionId) ?? null
	const isEditing = editingSessionId !== null
	const hasFocus = focusedSessionId !== null

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

	// enter - Activate focused session
	useHotkeys(
		'enter',
		() => {
			if (focusedSession) {
				onActivateSession(focusedSession)
			}
		},
		{
			scopes: [scope],
			enabled: enabled && !isEditing && hasFocus,
		},
		[focusedSession, onActivateSession, isEditing],
	)

	// shift+r - Start editing focused session title
	useHotkeys(
		'shift+r',
		() => {
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
		[focusedSession, onStartEdit, isEditing],
	)

	// e - Archive/discard focused session
	useHotkeys(
		'e',
		() => {
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
		[focusedSession, onArchiveOrDiscard, isEditing],
	)

	// g>e - Archive bottom session (go to end, archive)
	useHotkeys(
		'g>e',
		() => {
			const lastSession = sessions[sessions.length - 1]
			if (lastSession) {
				onArchiveOrDiscard(lastSession)
			}
		},
		{
			scopes: [scope],
			enabled: enabled && !isEditing,
			preventDefault: true,
		},
		[sessions, onArchiveOrDiscard, isEditing],
	)

	// alt+y / option+y - Bypass permissions
	useHotkeys(
		'alt+y, option+y',
		() => {
			if (focusedSessionId) {
				onBypassPermissions(focusedSessionId)
			}
		},
		{
			scopes: [scope],
			enabled: enabled && !isEditing && hasFocus,
			preventDefault: true,
		},
		[focusedSessionId, onBypassPermissions, isEditing],
	)

	return {
		focusedSession,
		isEditing,
	}
}
