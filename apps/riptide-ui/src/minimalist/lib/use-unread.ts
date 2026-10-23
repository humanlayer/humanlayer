import { useNavigate } from '@tanstack/react-router'

import { useUnreadStore } from '@/hooks/stores/unreadStore'
import { useOpenTaskId } from '@/minimalist/lib/data'
import { useUi } from '@/minimalist/lib/ui-state'

type Sessions = readonly { id: string }[]

/** Whether any of the task's sessions has a turn you haven't read. */
export function useTaskUnread(sessions: Sessions): boolean {
	return useUnreadStore((state) => sessions.some((session) => state.unreadSessionIds.has(session.id)))
}

/**
 * Mark a task read or unread, for the sidebar menu, the palette and ⇧⌘U. Marking the open task
 * unread steps back to the home screen, the way mail clients do, since reading it clears the dot.
 */
export function useUnreadActions() {
	const navigate = useNavigate()
	const { showToast } = useUi()
	const openTaskId = useOpenTaskId()
	return {
		markUnread: async (taskId: string, latestSessionId: string) => {
			const mark = () => useUnreadStore.getState().markUnread(latestSessionId)
			if (taskId !== openTaskId) return mark()
			// Leave first: the open thread clears the dot the moment it appears.
			await navigate({ to: '/', search: {} })
			mark()
			showToast('Marked as unread')
		},
		markRead: (sessions: Sessions) => {
			for (const session of sessions) useUnreadStore.getState().markRead(session.id)
		},
	}
}
