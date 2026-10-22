import { useAuth } from '@workos-inc/authkit-react'
import { useMemo } from 'react'

import { useActiveSessions } from '@/hooks/live-queries/useActiveSessions'
import { useUnreadStore } from '@/hooks/stores/unreadStore'

/** Task ids that contain at least one unread owned session (for the unread bullet in task tables). */
export function useUnreadTaskIds(): Set<string> {
	const { user } = useAuth()
	const activeSessions = useActiveSessions(user?.id)
	const unreadSessionIds = useUnreadStore((s) => s.unreadSessionIds)

	return useMemo(() => {
		const ids = new Set<string>()
		for (const s of activeSessions) {
			if (s.task_id && unreadSessionIds.has(s.id)) ids.add(s.task_id)
		}
		return ids
	}, [activeSessions, unreadSessionIds])
}
