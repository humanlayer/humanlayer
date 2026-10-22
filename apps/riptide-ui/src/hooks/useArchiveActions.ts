import { useAuth } from '@workos-inc/authkit-react'
import { useCallback } from 'react'

import { archiveTaskWithCleanup } from '@/actions/archiveTaskWithCleanup'
import { useTerminalStore } from '@/hooks/stores/terminalStore'
import { useSessionActions } from '@/hooks/useSessionActions'
import { useTaskActions } from '@/hooks/useTaskActions'
import { cleanupPtyForSession } from '@/integrations/desktop/pty'
import { showUndoToast } from '@/utils/undoToast'

export interface ArchiveTaskTarget {
	id: string
	name: string
	ownerUserId?: string | null
	sessionIds: string[]
}

export interface ArchiveSessionTarget {
	id: string
	name: string
	ownerUserId?: string | null
}

/** Shared owner-gated task archive action. Callers retain layout-specific focus movement. */
export function useArchiveTaskAction() {
	const { user } = useAuth()
	const taskActions = useTaskActions()

	return useCallback(
		(target: ArchiveTaskTarget): boolean => {
			if (!user?.id || target.ownerUserId !== user.id) return false

			archiveTaskWithCleanup({
				taskActions,
				taskId: target.id,
				taskName: target.name,
				archived: true,
				sessionIds: target.sessionIds,
			})
			return true
		},
		[taskActions, user?.id],
	)
}

/** Shared owner-gated session archive action. Callers retain route and focus behavior. */
export function useArchiveSessionAction() {
	const { user } = useAuth()
	const sessionActions = useSessionActions()

	return useCallback(
		(target: ArchiveSessionTarget): boolean => {
			if (!user?.id || target.ownerUserId !== user.id) return false

			sessionActions.archiveSession({ sessionId: target.id, archived: true })
			cleanupPtyForSession(target.id)
			useTerminalStore.getState().clearTerminalState(target.id)

			showUndoToast({
				type: 'archive_session',
				entityId: target.id,
				title: 'Session Archived',
				description: target.name,
				onUndo: () => {
					sessionActions.archiveSession({ sessionId: target.id, archived: false })
				},
			})
			return true
		},
		[sessionActions, user?.id],
	)
}
