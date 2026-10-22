import { NotificationEmptyState, NotificationPanel } from '@humanlayer/ui/components/notifications/NotificationPanel'
import { NotificationRow } from '@humanlayer/ui/components/notifications/NotificationRow'
import { useState } from 'react'

import { notificationRowView } from '@/components/notifications/notification-row-view'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { type AppHotkeysOptions, useAppHotkeys } from '@/hooks/hotkeys/useAppHotkeys'
import { useNotificationInboxStore } from '@/hooks/stores/notificationInboxStore'
import { useOpenNotification } from '@/hooks/useOpenNotification'
import { useOrgMembers } from '@/hooks/useOrgMembers'
import { hotkeysCatalog } from '@/hotkeysCatalog'
import type { NotificationRow as Row } from '@/lib/notifications/notification-row'

// Rows are role="option", which react-hotkeys-hook ignores unless it is listed as a form tag.
const LIST_HOTKEY_OPTIONS: AppHotkeysOptions = {
	scopes: [HOTKEY_SCOPES.NOTIFICATION_BELL],
	enableOnFormTags: ['option'],
	preventDefault: true,
}

export function WiredNotificationList({ rows }: { rows: Row[] }) {
	const [focusedKey, setFocusedKey] = useState<string | null>(null)
	const openNotification = useOpenNotification()
	const { membersMap } = useOrgMembers()
	const focusedIndex = Math.max(
		0,
		rows.findIndex((row) => row.key === focusedKey),
	)
	const focusedRow = rows[focusedIndex]

	const moveFocus = (offset: number) => {
		const next = rows[Math.min(rows.length - 1, Math.max(0, focusedIndex + offset))]
		if (!next) return
		setFocusedKey(next.key)
		document.getElementById(rowElementId(next))?.scrollIntoView({ block: 'nearest' })
	}
	useAppHotkeys(hotkeysCatalog.global.shortcuts.moveDown.reactHotkeys, () => moveFocus(1), LIST_HOTKEY_OPTIONS)
	useAppHotkeys(hotkeysCatalog.global.shortcuts.moveUp.reactHotkeys, () => moveFocus(-1), LIST_HOTKEY_OPTIONS)
	useAppHotkeys(
		hotkeysCatalog.global.shortcuts.openFocused.reactHotkeys,
		() => focusedRow && openNotification(focusedRow),
		LIST_HOTKEY_OPTIONS,
	)
	useAppHotkeys(
		hotkeysCatalog.notifications.shortcuts.dismiss.reactHotkeys,
		() => {
			if (!focusedRow?.dismissible) return
			const nextFocus = rows[focusedIndex + 1] ?? rows[focusedIndex - 1]
			setFocusedKey(nextFocus?.key ?? null)
			useNotificationInboxStore.getState().markSeen(focusedRow.key, Date.now())
		},
		LIST_HOTKEY_OPTIONS,
	)

	return (
		<NotificationPanel count={rows.length} activeRowId={focusedRow ? rowElementId(focusedRow) : undefined}>
			{rows.length === 0 ? <NotificationEmptyState /> : null}
			{rows.map((row) => (
				<NotificationRow
					key={row.key}
					id={rowElementId(row)}
					{...notificationRowView(row, membersMap)}
					focused={row === focusedRow}
					onSelect={() => openNotification(row)}
					onHover={() => setFocusedKey(row.key)}
				/>
			))}
		</NotificationPanel>
	)
}

function rowElementId(row: Row): string {
	return `notification-${row.key}`
}
