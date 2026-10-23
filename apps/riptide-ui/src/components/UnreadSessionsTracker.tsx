import { useParams } from '@tanstack/react-router'
import { useAuth } from '@workos-inc/authkit-react'
import { useEffect } from 'react'

import { useSync } from '@/components/providers/SyncProvider'
import { useUnreadStore } from '@/hooks/stores/unreadStore'
import { logger } from '@/lib/logger'
import { type SessionChangeMessage, shouldMarkSessionUnread } from '@/lib/shouldMarkSessionUnread'

/**
 * Tracks transitions of sessions into ready_for_input and marks them unread
 * in the in-memory unread store. Renders nothing.
 */
export function UnreadSessionsTracker() {
	const { sessionsCollection } = useSync()
	const params = useParams({ strict: false })
	const { user } = useAuth()

	const currentSessionId = 'sessionId' in params ? (params.sessionId as string) : null

	useEffect(() => {
		const subscription = sessionsCollection.subscribeChanges(
			(changes) => {
				for (const change of changes as SessionChangeMessage[]) {
					if (!shouldMarkSessionUnread(change, currentSessionId, user?.id)) continue

					const sessionId = change.value.id
					logger.debug({ sessionId, status: change.value.status }, 'Marking session unread')
					useUnreadStore.getState().markUnread(sessionId)
				}
			},
			{ includeInitialState: false },
		)

		return () => {
			subscription.unsubscribe()
		}
	}, [sessionsCollection, currentSessionId, user?.id])

	return null
}
