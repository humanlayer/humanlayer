import { useNavigate } from '@tanstack/react-router'
import { useCallback, useState } from 'react'

import { useTerminalStore } from '@/hooks/stores/terminalStore'
import type { useSessionActions } from '@/hooks/useSessionActions'
import { cleanupPtyForSession } from '@/integrations/desktop/pty'
import { showUndoToast } from '@/utils/undoToast'

import type { SessionDetailSession } from './useSessionDetailData'

/**
 * Session lifecycle state shared with the page hotkeys: archive/unarchive
 * (with undo toast and terminal cleanup) and the open state of the task
 * assignment dialog (Shift+T).
 */
export function useSessionArchiveAndTask({
	session,
	sessionActions,
}: {
	session: SessionDetailSession | undefined
	sessionActions: ReturnType<typeof useSessionActions>
}) {
	const navigate = useNavigate()

	const [isTaskAssignmentOpen, setIsTaskAssignmentOpen] = useState(false)

	// Archive handler with undo toast
	const handleToggleArchive = useCallback(() => {
		if (!session) return
		const isCurrentlyArchived = session.archived ?? false
		const newArchivedState = !isCurrentlyArchived
		const sessionTitle = session.title || session.summary || 'Untitled Session'

		sessionActions.archiveSession({ sessionId: session.id, archived: newArchivedState })

		// Clear terminal state on archive — skip for task-bound sessions,
		// the task owns the terminal and it should survive session archival
		if (newArchivedState) {
			if (!session.task_id) {
				cleanupPtyForSession(session.id)
				useTerminalStore.getState().clearTerminalState(session.id)
			}
		}

		showUndoToast({
			type: newArchivedState ? 'archive_session' : 'unarchive_session',
			entityId: session.id,
			title: newArchivedState ? 'Session Archived' : 'Session Un-archived',
			description: sessionTitle,
			onUndo: () => {
				sessionActions.archiveSession({ sessionId: session.id, archived: !newArchivedState })
			},
		})

		if (newArchivedState) {
			if (session.task_id) {
				navigate({ to: '/tasks/$taskId', params: { taskId: session.task_id } })
			} else {
				navigate({ to: '/sessions', search: { tab: 'sessions' } })
			}
		}
	}, [session, sessionActions, navigate])

	return { isTaskAssignmentOpen, setIsTaskAssignmentOpen, handleToggleArchive }
}
