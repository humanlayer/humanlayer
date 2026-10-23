import { KeyboardShortcut } from '@humanlayer/ui/components/keyboard-shortcut'
import { NotificationBellButton } from '@humanlayer/ui/components/notifications/NotificationBellButton'
import { Popover, PopoverContent, PopoverTrigger } from '@humanlayer/ui/components/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@humanlayer/ui/components/tooltip'

import { useHorizontalTabChromeState } from '@/components/horizontal-tabs/HorizontalTabChrome'
import { HotkeyScopeBoundary } from '@/components/HotkeyScopeBoundary'
import { NotificationArrivalAnnouncer, useLatestArrival } from '@/components/notifications/NotificationArrivals'
import { WiredNotificationList } from '@/components/notifications/WiredNotificationList'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { useAppHotkeys } from '@/hooks/hotkeys/useAppHotkeys'
import { useHotkeyHelpStore } from '@/hooks/stores/hotkeyHelpStore'
import { useNotificationInboxStore } from '@/hooks/stores/notificationInboxStore'
import { useNotificationRows } from '@/hooks/useNotificationRows'
import { useOpenNotification } from '@/hooks/useOpenNotification'
import { formatShortcut, hotkeysCatalog } from '@/hotkeysCatalog'
import { nextJumpRow } from '@/lib/notifications/next-jump-row'
import type { NotificationRow } from '@/lib/notifications/notification-row'

export function WiredNotificationBell({
	placement,
	className,
}: {
	placement: 'tab-strip' | 'page'
	className?: string
}) {
	const { isStripVisible } = useHorizontalTabChromeState()
	if (placement === 'page' && isStripVisible) return null
	return <MountedNotificationBell className={className} />
}

function MountedNotificationBell({ className }: { className?: string }) {
	const { rows, synced } = useNotificationRows()
	const open = useNotificationInboxStore((state) => state.open)
	const arrival = useLatestArrival(rows, synced)
	useJumpToLatestHotkey(rows)

	return (
		<Popover open={open} onOpenChange={(next) => useNotificationInboxStore.getState().setOpen(next)}>
			<Tooltip>
				<TooltipTrigger asChild>
					<PopoverTrigger asChild>
						<NotificationBellButton
							count={rows.length}
							ringCount={arrival?.id ?? 0}
							className={className}
						/>
					</PopoverTrigger>
				</TooltipTrigger>
				<TooltipContent side="bottom">
					<p className="flex items-center gap-1">
						Notifications · open latest{' '}
						<KeyboardShortcut size="xs">
							{formatShortcut(hotkeysCatalog.global.shortcuts.latestNotification.display)}
						</KeyboardShortcut>
					</p>
				</TooltipContent>
			</Tooltip>
			<PopoverContent
				align="end"
				className="w-[30rem] rounded-none border-0 bg-muted p-0 shadow-xl"
				onCloseAutoFocus={(event) => event.preventDefault()}
			>
				<HotkeyScopeBoundary
					scope={HOTKEY_SCOPES.NOTIFICATION_BELL}
					rootScopeDisabled
					componentName="NotificationBell"
				>
					<WiredNotificationList rows={rows} />
				</HotkeyScopeBoundary>
			</PopoverContent>
			{arrival ? <NotificationArrivalAnnouncer arrival={arrival} /> : null}
		</Popover>
	)
}

function useJumpToLatestHotkey(rows: NotificationRow[]) {
	const openNotification = useOpenNotification()
	const isHotkeyHelpOpen = useHotkeyHelpStore((state) => state.isOpen)
	useAppHotkeys(
		hotkeysCatalog.global.shortcuts.latestNotification.reactHotkeys,
		() => {
			const store = useNotificationInboxStore.getState()
			const row = nextJumpRow(rows, store.opened)
			if (row) openNotification(row)
			else store.setOpen(true)
		},
		{
			enabled: !isHotkeyHelpOpen,
			enableOnFormTags: true,
			enableOnContentEditable: true,
			preventDefault: true,
			eventListenerOptions: { capture: true },
		},
	)
}
