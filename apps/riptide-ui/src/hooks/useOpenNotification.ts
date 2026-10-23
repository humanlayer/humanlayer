import { useNavigate, useRouterState } from '@tanstack/react-router'
import { toast } from 'sonner'

import {
	createSessionNotificationDestination,
	createWorkspaceSetupNotificationDestination,
} from '@/components/horizontal-tabs/horizontalTabNotificationDestination'
import { useSync } from '@/components/providers/SyncProvider'
import { NOTIFICATION_ARRIVAL_TOAST_ID, useNotificationInboxStore } from '@/hooks/stores/notificationInboxStore'
import { useNotificationDestinationNavigation } from '@/hooks/useNotificationDestinationNavigation'
import type { NotificationKind, NotificationRow } from '@/lib/notifications/notification-row'

const CLEARED_ON_OPEN = new Set<NotificationKind>(['prompt_invite', 'artifact_comment', 'thread_reply', 'diff_comment'])

export function useOpenNotification(): (row: NotificationRow) => void {
	const navigate = useNavigate()
	const navigateToDestination = useNotificationDestinationNavigation()
	const matches = useRouterState({ select: (state) => state.matches, structuralSharing: false })
	const { sessionsCollection } = useSync()

	const currentSessionOnTask = (taskId: string): string | undefined => {
		const sessionMatch = matches.find((match) => match.routeId === '/_app/sessions/$sessionId')
		const sessionId = sessionMatch?.params.sessionId as string | undefined
		const session = sessionId ? sessionsCollection.state.get(sessionId) : undefined
		return sessionId && session?.task_id === taskId ? sessionId : undefined
	}

	return (row) => {
		const store = useNotificationInboxStore.getState()
		const now = Date.now()
		store.markOpened(row.key, now)
		if (CLEARED_ON_OPEN.has(row.kind)) store.markSeen(row.key, now)
		store.setOpen(false)
		toast.dismiss(NOTIFICATION_ARRIVAL_TOAST_ID)

		const destination = row.destination
		switch (destination.kind) {
			case 'session':
				navigateToDestination(createSessionNotificationDestination(destination.sessionId))
				return
			case 'workspace-setup':
				navigateToDestination(createWorkspaceSetupNotificationDestination(destination.taskId))
				return
			case 'artifact-comment': {
				const { taskId, artifactId, commentId } = destination
				const sessionId = currentSessionOnTask(taskId)
				if (sessionId) {
					navigate({
						to: '/sessions/$sessionId',
						params: { sessionId },
						search: (previous: Record<string, unknown>) => ({ ...previous, artifactId, commentId }),
					})
					return
				}
				navigate({ to: '/tasks/$taskId', params: { taskId }, search: { artifactId, commentId } })
				return
			}
			case 'diff-comment': {
				const { taskId, diffCommentId } = destination
				const sessionId = currentSessionOnTask(taskId)
				if (sessionId) {
					navigate({
						to: '/sessions/$sessionId',
						params: { sessionId },
						search: (previous: Record<string, unknown>) => ({
							...previous,
							diffCommentId,
							diffPresentation: 'sidebar' as const,
						}),
					})
					return
				}
				navigate({
					to: '/tasks/$taskId',
					params: { taskId },
					search: { diffCommentId, diffPresentation: 'sidebar' },
				})
			}
		}
	}
}
