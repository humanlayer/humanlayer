import { toast } from 'sonner'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { NOTIFICATION_WINDOW_MS } from '@/lib/notifications/notification-row'

export const NOTIFICATION_ARRIVAL_TOAST_ID = 'notification-arrival'

interface NotificationInboxState {
	/** Row key → when it was opened or dismissed. A row returns only when it has a newer event. */
	seen: Record<string, number>
	/** Row key → when it was last opened. The latest-notification shortcut skips rows opened since their newest event. */
	opened: Record<string, number>
	open: boolean

	markSeen: (key: string, now: number) => void
	markOpened: (key: string, now: number) => void
	setOpen: (open: boolean) => void
}

function dropOutsideWindow(seen: Record<string, number>, now: number): Record<string, number> {
	return Object.fromEntries(Object.entries(seen).filter(([, at]) => now - at < NOTIFICATION_WINDOW_MS))
}

export const useNotificationInboxStore = create<NotificationInboxState>()(
	persist(
		(set) => ({
			seen: {},
			opened: {},
			open: false,

			markSeen: (key, now) => set((state) => ({ seen: { ...dropOutsideWindow(state.seen, now), [key]: now } })),
			markOpened: (key, now) =>
				set((state) => ({ opened: { ...dropOutsideWindow(state.opened, now), [key]: now } })),
			setOpen: (open) => {
				if (open) toast.dismiss(NOTIFICATION_ARRIVAL_TOAST_ID)
				set({ open })
			},
		}),
		{
			name: 'humanlayer-notification-inbox',
			partialize: (state) => ({ seen: state.seen }),
		},
	),
)
