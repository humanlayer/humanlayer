import { toast } from 'sonner'

import { NOTIFICATION_ARRIVAL_TOAST_ID, useNotificationInboxStore } from '@/hooks/stores/notificationInboxStore'
import { useNotificationRows } from '@/hooks/useNotificationRows'
import { useOpenNotification } from '@/hooks/useOpenNotification'
import type { NotificationRow } from '@/lib/notifications/notification-row'
import { useOpenInTask } from '@/minimalist/lib/thread-panel'
import { useUi } from '@/minimalist/lib/ui-state'

/** Shared inbox rules and destinations, with the minimalist sidebar's close-on-open behavior. */
export function useMinimalistInbox() {
	const inbox = useNotificationRows()
	const openNotification = useOpenNotification()
	const openInTask = useOpenInTask()
	const { closeSidebarOnNarrow } = useUi()
	return {
		...inbox,
		openNotification: (row: NotificationRow) => {
			const destination = row.destination
			if (destination.kind === 'artifact-comment' || destination.kind === 'diff-comment') {
				// Match the shared inbox's seen/open rules, but replace the target rather than merge it.
				const store = useNotificationInboxStore.getState()
				const now = Date.now()
				store.markOpened(row.key, now)
				store.markSeen(row.key, now)
				store.setOpen(false)
				toast.dismiss(NOTIFICATION_ARRIVAL_TOAST_ID)
				void openInTask(
					destination.taskId,
					destination.kind === 'artifact-comment'
						? { artifactId: destination.artifactId, commentId: destination.commentId }
						: { diffCommentId: destination.diffCommentId },
				)
			} else openNotification(row)
			closeSidebarOnNarrow()
		},
		dismissNotification,
	}
}

export type MinimalistInbox = ReturnType<typeof useMinimalistInbox>

/** Approvals stay until answered; other rows use the main inbox's persisted seen timestamp. */
export function dismissNotification(row: NotificationRow): boolean {
	if (!row.dismissible) return false
	useNotificationInboxStore.getState().markSeen(row.key, Date.now())
	return true
}
