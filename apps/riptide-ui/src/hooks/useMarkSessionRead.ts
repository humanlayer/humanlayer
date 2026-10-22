import { useEffect } from 'react'

import { useUnreadStore } from '@/hooks/stores/unreadStore'

/**
 * Clears the session from the unread store whenever the active sessionId
 * changes. The session detail route stays mounted across sidebar
 * navigation between sessions, so a mount-only effect would only clear
 * the first session visited.
 */
export function useMarkSessionRead(sessionId: string) {
	useEffect(() => {
		useUnreadStore.getState().markRead(sessionId)
	}, [sessionId])
}
