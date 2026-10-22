import { NotificationToast } from '@humanlayer/ui/components/notifications/NotificationToast'
import { type ParsedLocation, useRouterState } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { toast } from 'sonner'

import { notificationRowView } from '@/components/notifications/notification-row-view'
import { NOTIFICATION_ARRIVAL_TOAST_ID, useNotificationInboxStore } from '@/hooks/stores/notificationInboxStore'
import { useMountEffect } from '@/hooks/useMountEffect'
import { useOpenNotification } from '@/hooks/useOpenNotification'
import { useOrgMembers } from '@/hooks/useOrgMembers'
import { formatShortcut, hotkeysCatalog } from '@/hotkeysCatalog'
import { createCommentNotificationSoundPlayer } from '@/lib/comment-notification-sound'
import type {
	NotificationDestination,
	NotificationKind,
	NotificationRow as Row,
} from '@/lib/notifications/notification-row'

const ARRIVAL_TOAST_DURATION_MS = 6_000
const SOUNDED_KINDS = new Set<NotificationKind>([
	'approval',
	'prompt_invite',
	'artifact_comment',
	'thread_reply',
	'diff_comment',
])

const playArrivalSound = createCommentNotificationSoundPlayer()

export interface NotificationArrival {
	id: number
	rows: Row[]
}

export function useLatestArrival(rows: Row[], synced: boolean): NotificationArrival | null {
	const newestAt = rows.reduce((newest, row) => Math.max(newest, row.at), Number.NEGATIVE_INFINITY)
	const [announcedUpTo, setAnnouncedUpTo] = useState(newestAt)
	const [arrival, setArrival] = useState<NotificationArrival | null>(null)

	if (newestAt > announcedUpTo) {
		setAnnouncedUpTo(newestAt)
		if (synced) setArrival({ id: (arrival?.id ?? 0) + 1, rows: rows.filter((row) => row.at > announcedUpTo) })
	}

	return arrival
}

export function NotificationArrivalAnnouncer({ arrival }: { arrival: NotificationArrival }) {
	const showArrivalToast = useArrivalToast()
	return <ArrivalAnnouncement key={arrival.id} arrivals={arrival.rows} onArrival={showArrivalToast} />
}

function ArrivalAnnouncement({ arrivals, onArrival }: { arrivals: Row[]; onArrival: (arrivals: Row[]) => void }) {
	useMountEffect(() => {
		if (arrivals.some((row) => SOUNDED_KINDS.has(row.kind))) playArrivalSound()
		onArrival(arrivals)
	})
	return null
}

function useArrivalToast(): (arrivals: Row[]) => void {
	const openNotification = useOpenNotification()
	const { membersMap } = useOrgMembers()
	const location = useRouterState({ select: (state) => state.location })
	const recentlyToasted = useRef<{ key: string; at: number }[]>([])

	return (arrivals) => {
		if (useNotificationInboxStore.getState().open) return
		const announced = arrivals.filter((row) => !isViewingDestination(row.destination, location))
		const [newest] = announced
		if (!newest) return
		const now = Date.now()
		const announcedKeys = new Set(announced.map((row) => row.key))
		recentlyToasted.current = [
			...recentlyToasted.current.filter(
				(entry) => now - entry.at < ARRIVAL_TOAST_DURATION_MS && !announcedKeys.has(entry.key),
			),
			...announced.map((row) => ({ key: row.key, at: now })),
		]
		const moreCount = recentlyToasted.current.length - 1
		const view = notificationRowView(newest, membersMap)

		toast.custom(
			(toastId) => (
				<NotificationToast
					kind={view.kind}
					headline={view.actorName ? `${view.actorName} ${view.action}` : view.action}
					subject={view.subject}
					moreCount={moreCount}
					shortcut={formatShortcut(hotkeysCatalog.global.shortcuts.latestNotification.display)}
					onOpen={() => openNotification(newest)}
					onShowAll={() => useNotificationInboxStore.getState().setOpen(true)}
					onClose={() => toast.dismiss(toastId)}
				/>
			),
			{
				id: NOTIFICATION_ARRIVAL_TOAST_ID,
				duration: ARRIVAL_TOAST_DURATION_MS,
				className: '!border-0 !bg-transparent !p-0 !shadow-none',
			},
		)
	}
}

function isViewingDestination(destination: NotificationDestination, location: ParsedLocation): boolean {
	const search = location.search as Record<string, unknown>
	switch (destination.kind) {
		case 'session':
			return location.pathname === `/sessions/${destination.sessionId}`
		case 'workspace-setup':
			return location.pathname === `/tasks/${destination.taskId}`
		case 'artifact-comment':
			return search.artifactId === destination.artifactId
		case 'diff-comment':
			return false
	}
}
