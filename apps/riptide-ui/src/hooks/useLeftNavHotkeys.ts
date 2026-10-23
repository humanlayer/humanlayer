import { useCallback } from 'react'

import { focusMainAndReleaseSpatialDomFocus } from '@/components/keyboard-focus-transfer'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { useAppHotkeys } from '@/hooks/hotkeys/useAppHotkeys'
import { useArchiveHotkey } from '@/hooks/hotkeys/useArchiveHotkey'

interface UseLeftNavHotkeysOptions {
	enabled?: boolean
	onFocusNext: () => void
	onFocusPrev: () => void
	onSelect: () => void
	onJumpFirst: () => void
	onJumpLast: () => void
	onExpand: () => void
	onCollapse: () => void
	onArchive: () => void
}

const LEFT_NAV_HOST_SCOPES = [
	HOTKEY_SCOPES.ROOT,
	HOTKEY_SCOPES.SESSIONS_LIST,
	HOTKEY_SCOPES.SESSION_DETAIL,
	HOTKEY_SCOPES.TASK_DETAIL,
	HOTKEY_SCOPES.DRAFT_LAUNCHER,
	HOTKEY_SCOPES.ARTIFACT_PANEL,
	HOTKEY_SCOPES.ARTIFACT_FULLSCREEN,
	HOTKEY_SCOPES.ARTIFACT_V2_PANEL_REVIEW,
	HOTKEY_SCOPES.ARTIFACT_V2_FULLSCREEN_REVIEW,
]

export function useLeftNavHotkeys({
	enabled = true,
	onFocusNext,
	onFocusPrev,
	onSelect,
	onJumpFirst,
	onJumpLast,
	onExpand,
	onCollapse,
	onArchive,
}: UseLeftNavHotkeysOptions): void {
	const handleEscape = useCallback(() => {
		focusMainAndReleaseSpatialDomFocus()
	}, [])

	useAppHotkeys(
		'escape',
		handleEscape,
		{
			scopes: LEFT_NAV_HOST_SCOPES,
			area: 'LEFT_NAV',
			enabled,
		},
		[handleEscape],
	)

	useAppHotkeys(
		'j, ArrowDown',
		onFocusNext,
		{
			scopes: LEFT_NAV_HOST_SCOPES,
			area: 'LEFT_NAV',
			enabled,
		},
		[onFocusNext],
	)

	useAppHotkeys(
		'k, ArrowUp',
		onFocusPrev,
		{
			scopes: LEFT_NAV_HOST_SCOPES,
			area: 'LEFT_NAV',
			enabled,
		},
		[onFocusPrev],
	)

	useAppHotkeys(
		'enter',
		onSelect,
		{
			scopes: LEFT_NAV_HOST_SCOPES,
			area: 'LEFT_NAV',
			enabled,
		},
		[onSelect],
	)

	useAppHotkeys(
		'g>g',
		onJumpFirst,
		{
			scopes: LEFT_NAV_HOST_SCOPES,
			area: 'LEFT_NAV',
			enabled,
			preventDefault: true,
		},
		[onJumpFirst],
	)

	useAppHotkeys(
		'shift+g',
		onJumpLast,
		{
			scopes: LEFT_NAV_HOST_SCOPES,
			area: 'LEFT_NAV',
			enabled,
			preventDefault: true,
		},
		[onJumpLast],
	)

	useAppHotkeys(
		'l',
		onExpand,
		{
			scopes: LEFT_NAV_HOST_SCOPES,
			area: 'LEFT_NAV',
			enabled,
		},
		[onExpand],
	)

	useAppHotkeys(
		'h',
		onCollapse,
		{
			scopes: LEFT_NAV_HOST_SCOPES,
			area: 'LEFT_NAV',
			enabled,
		},
		[onCollapse],
	)

	useArchiveHotkey(
		onArchive,
		{
			scopes: LEFT_NAV_HOST_SCOPES,
			area: 'LEFT_NAV',
			enabled,
		},
		[onArchive],
	)
}
