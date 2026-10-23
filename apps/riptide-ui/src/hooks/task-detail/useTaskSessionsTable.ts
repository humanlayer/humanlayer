import { useNavigate, useRouter } from '@tanstack/react-router'
import { useCallback, useState } from 'react'
import { toast } from 'sonner'

import type { TableSession } from '@/components/session-table/types'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { useArtifactPaneOwnsNavigationKeys } from '@/hooks/stores/artifactViewerStore'
import { useFocusStore } from '@/hooks/stores/focusStore'
import { useTerminalStore } from '@/hooks/stores/terminalStore'
import { useSessionActions } from '@/hooks/useSessionActions'
import { useTaskDetailSessionsHotkeys } from '@/hooks/useTaskDetailSessionsHotkeys'
import { captureException } from '@/integrations/sentry/sentry'
import { showUndoToast } from '@/utils/undoToast'

function reportPersistFailure(
	transaction: { isPersisted: { promise: Promise<unknown> } },
	message: string,
	extra: Record<string, unknown>,
) {
	transaction.isPersisted.promise.catch((error) => {
		toast.error(message)
		captureException(error, { extra })
	})
}

/**
 * The sessions table on the task detail page: focus/edit state, activation
 * and archive handlers, optimistic session mutations, and the table's
 * keyboard navigation hotkeys.
 */
export function useTaskSessionsTable({
	taskId,
	from,
	sessions,
}: {
	taskId: string
	from: 'archive-tasks' | undefined
	sessions: TableSession[]
}) {
	const navigate = useNavigate()
	const router = useRouter()
	const sessionActions = useSessionActions()

	// Mouse protection - ignore mouse events until mouse has moved
	// Read focusSource via getState() to avoid subscription overhead
	const shouldIgnoreMouseEvent = useCallback(() => {
		return useFocusStore.getState().focusSource !== 'mouse'
	}, [])

	// Session editing state
	const [editingSessionId, setEditingSessionId] = useState<string | null>(null)

	const handleActivateSession = useCallback(
		(session: TableSession) => {
			navigate({
				to: '/sessions/$sessionId',
				params: { sessionId: session.id },
				// Preserve archive flow context so Esc can navigate back through history
				search: from === 'archive-tasks' ? { from: 'archive-tasks' } : undefined,
			})
		},
		[navigate, from],
	)

	const handleActivateDraft = useCallback(
		(session: TableSession) => {
			navigate({ to: '/sessions/draft', search: { draftId: session.id, taskId } })
		},
		[navigate, taskId],
	)

	// Focus a session via keyboard and preload its route for instant activation
	const focusAndPreload = useCallback(
		(sessionId: string) => {
			useFocusStore.getState().setFocusedSessionId(sessionId, 'keyboard')
			void router.preloadRoute({ to: '/sessions/$sessionId', params: { sessionId } })
		},
		[router],
	)

	// Focus next session, wrapping; starts at the first when nothing is focused
	const handleFocusNext = useCallback(() => {
		if (sessions.length === 0) return
		const focusedSessionId = useFocusStore.getState().focusedSessionId
		const currentIndex = sessions.findIndex((s) => s.id === focusedSessionId)
		const nextIndex = currentIndex >= sessions.length - 1 ? 0 : currentIndex + 1
		const nextSession = sessions[nextIndex]
		if (nextSession === undefined) return
		focusAndPreload(nextSession.id)
	}, [sessions, focusAndPreload])

	// Focus previous session, wrapping; starts at the last when nothing is focused
	const handleFocusPrevious = useCallback(() => {
		if (sessions.length === 0) return
		const focusedSessionId = useFocusStore.getState().focusedSessionId
		const currentIndex = sessions.findIndex((s) => s.id === focusedSessionId)
		const prevIndex = currentIndex <= 0 ? sessions.length - 1 : currentIndex - 1
		const prevSession = sessions[prevIndex]
		if (prevSession === undefined) return
		focusAndPreload(prevSession.id)
	}, [sessions, focusAndPreload])

	const handleFocusFirst = useCallback(() => {
		const firstSession = sessions[0]
		if (firstSession !== undefined) focusAndPreload(firstSession.id)
	}, [sessions, focusAndPreload])

	const handleFocusLast = useCallback(() => {
		const lastSession = sessions[sessions.length - 1]
		if (lastSession !== undefined) focusAndPreload(lastSession.id)
	}, [sessions, focusAndPreload])

	// Archive/unarchive focused session with undo toast
	const handleArchiveSession = useCallback(
		(session: TableSession) => {
			const isArchived = session.archived ?? false
			const newArchivedState = !isArchived
			const sessionTitle = session.title || session.summary || 'Untitled Session'

			sessionActions.archiveSession({ sessionId: session.id, archived: newArchivedState })

			if (newArchivedState) {
				useTerminalStore.getState().clearTerminalState(session.id)

				// Move focus to next non-archived session
				const currentFocusedId = useFocusStore.getState().focusedSessionId
				if (currentFocusedId === session.id) {
					const activeSessions = sessions.filter((s) => !s.archived)
					const currentIndex = activeSessions.findIndex((s) => s.id === session.id)
					const nextSession = activeSessions[currentIndex + 1] || activeSessions[currentIndex - 1]
					useFocusStore.getState().setFocusedSessionId(nextSession?.id ?? null, 'keyboard')
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
		},
		[sessionActions, sessions],
	)

	const handleCreateSession = useCallback(() => {
		navigate({ to: '/sessions/draft', search: { taskId } })
	}, [navigate, taskId])

	const handleStartEditSession = useCallback((session: TableSession) => {
		setEditingSessionId(session.id)
	}, [])

	const handleSaveSessionTitle = useCallback(
		(sessionId: string, newTitle: string) => {
			setEditingSessionId(null)
			const transaction = sessionActions.updateSessionTitle({ sessionId, title: newTitle })
			reportPersistFailure(transaction, 'Failed to update title', {
				action: 'updateSessionTitle',
				sessionId,
				taskId,
			})
		},
		[sessionActions, taskId],
	)

	// Toggle bypass permissions. Unlike other pages, the task detail page has no
	// bypass confirmation dialog, so enabling applies directly without a modal.
	const handleOpenBypassSessionDialog = useCallback(
		(session: TableSession) => {
			const enable = !session.dangerouslySkipPermissions
			const transaction = sessionActions.updateSessionPermissions({
				sessionId: session.id,
				permissionsMode: enable ? 'bypass' : 'default',
			})
			reportPersistFailure(transaction, `Failed to ${enable ? 'enable' : 'disable'} bypass permissions`, {
				action: 'updateSessionPermissions',
				sessionId: session.id,
				taskId,
			})
		},
		[sessionActions, taskId],
	)

	// Keyboard navigation for sessions table. Yield the navigation keys while
	// RIGHT_PANE owns the keyboard — both register under the ARTIFACT_PANEL
	// scope, so the focused area decides which one gets j/k.
	const artifactPaneOwnsNavigationKeys = useArtifactPaneOwnsNavigationKeys()
	useTaskDetailSessionsHotkeys({
		sessions,
		scopes: [HOTKEY_SCOPES.TASK_DETAIL, HOTKEY_SCOPES.ARTIFACT_PANEL],
		enabled: !artifactPaneOwnsNavigationKeys,
		onFocusNext: handleFocusNext,
		onFocusPrevious: handleFocusPrevious,
		onFocusFirst: handleFocusFirst,
		onFocusLast: handleFocusLast,
		onActivateSession: handleActivateSession,
		onActivateDraft: handleActivateDraft,
		onArchive: handleArchiveSession,
	})

	return {
		shouldIgnoreMouseEvent,
		editingSessionId,
		setEditingSessionId,
		handleActivateSession,
		handleActivateDraft,
		handleArchiveSession,
		handleCreateSession,
		handleStartEditSession,
		handleSaveSessionTitle,
		handleOpenBypassSessionDialog,
	}
}
