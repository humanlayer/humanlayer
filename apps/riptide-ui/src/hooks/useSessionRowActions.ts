import { useNavigate, useRouter } from '@tanstack/react-router'
import { useCallback, useState } from 'react'
import { toast } from 'sonner'

import type { TableSession } from '@/components/session-table/types'
import { useFocusStore } from '@/hooks/stores/focusStore'
import { useTerminalStore } from '@/hooks/stores/terminalStore'
import { useSessionActions } from '@/hooks/useSessionActions'
import { cleanupPtyForSession } from '@/integrations/desktop/pty'
import { captureException } from '@/integrations/sentry/sentry'
import { showUndoToast } from '@/utils/undoToast'

/**
 * Row-level actions for the session tables on the sessions list page (active
 * sessions and drafts tabs): activation, inline title editing, archive/discard
 * with undo, and the bypass-permissions / auto-accept flows including the
 * bypass confirmation dialog state. Focus and editing live in the focus store.
 */
export function useSessionRowActions(sessions: TableSession[]) {
	const navigate = useNavigate()
	const sessionActions = useSessionActions()
	const editingSessionId = useFocusStore((s) => s.editingSessionId)

	// Bypass permissions dialog state
	const [bypassDialogOpen, setBypassDialogOpen] = useState(false)
	const [bypassSessionIds, setBypassSessionIds] = useState<string[]>([])

	const setEditingSessionId = useCallback((id: string | null) => {
		useFocusStore.getState().setEditingSessionId(id)
	}, [])

	// Mouse focus — ignored until the mouse has actually moved, so hover can't
	// steal focus during keyboard navigation.
	const handleFocusSession = useCallback((session: TableSession) => {
		if (useFocusStore.getState().focusSource !== 'mouse') return
		useFocusStore.getState().setFocusedSessionId(session.id, 'mouse')
	}, [])
	const handleBlurSession = useCallback(() => {}, [])

	const handleActivateSession = useCallback(
		(session: TableSession) => {
			navigate({ to: '/sessions/$sessionId', params: { sessionId: session.id } })
		},
		[navigate],
	)

	const handleActivateDraft = useCallback(
		(session: TableSession) => {
			navigate({ to: '/sessions/draft', search: { draftId: session.id, taskId: session.taskId } })
		},
		[navigate],
	)

	const handleStartEdit = useCallback(
		(session: TableSession) => {
			setEditingSessionId(session.id)
		},
		[setEditingSessionId],
	)

	const handleSaveTitle = useCallback(
		(sessionId: string, newTitle: string) => {
			setEditingSessionId(null)
			const transaction = sessionActions.updateSessionTitle({ sessionId, title: newTitle })
			transaction.isPersisted.promise.catch((error) => {
				toast.error('Failed to update title')
				captureException(error, { extra: { action: 'updateSessionTitle', sessionId } })
			})
		},
		[sessionActions, setEditingSessionId],
	)

	const handleArchiveOrDiscard = useCallback(
		(session: TableSession) => {
			const isArchived = session.archived ?? false
			const newArchivedState = !isArchived
			const sessionTitle = session.title || session.summary || 'Untitled Session'

			sessionActions.archiveSession({ sessionId: session.id, archived: newArchivedState })

			// Session-scoped terminals die with the session; task terminals survive
			if (newArchivedState && !session.taskId) {
				cleanupPtyForSession(session.id)
				useTerminalStore.getState().clearTerminalState(session.id)
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

			// Move focus to next/previous session
			const currentFocusedId = useFocusStore.getState().focusedSessionId
			if (currentFocusedId === session.id) {
				const currentIndex = sessions.findIndex((s) => s.id === session.id)
				const nextSession = sessions[currentIndex + 1] || sessions[currentIndex - 1]
				useFocusStore.getState().setFocusedSessionId(nextSession?.id ?? null, 'keyboard')
			}
		},
		[sessions, sessionActions],
	)

	// SessionTable's onArchive/onDiscard pass ids; resolve to the session row
	const handleArchiveOrDiscardById = useCallback(
		(sessionId: string) => {
			const session = sessions.find((s) => s.id === sessionId)
			if (session) handleArchiveOrDiscard(session)
		},
		[sessions, handleArchiveOrDiscard],
	)

	// Disabling bypass needs no confirmation; enabling goes through the dialog
	const handleDirectDisableBypass = useCallback(
		(sessionId: string) => {
			const transaction = sessionActions.updateSessionPermissions({
				sessionId,
				permissionsMode: 'default',
			})
			// Silent disable to match WUI behavior (no success toast)
			transaction.isPersisted.promise.catch((error) => {
				toast.error('Failed to disable bypass permissions')
				captureException(error, { extra: { action: 'updateSessionPermissions', sessionId } })
			})
		},
		[sessionActions],
	)

	const handleOpenBypassSessionDialog = useCallback(
		(session: TableSession) => {
			if (session.dangerouslySkipPermissions) {
				handleDirectDisableBypass(session.id)
			} else {
				setBypassSessionIds([session.id])
				setBypassDialogOpen(true)
			}
		},
		[handleDirectDisableBypass],
	)

	const handleBypassPermissions = useCallback(
		(sessionId: string) => {
			const session = sessions.find((s) => s.id === sessionId)
			if (session) handleOpenBypassSessionDialog(session)
		},
		[sessions, handleOpenBypassSessionDialog],
	)

	const handleBypassConfirm = useCallback(
		(_timeoutMinutes: number | null) => {
			// Note: timeout is ignored per requirements (no timeout support)
			const transactions = bypassSessionIds.map((sessionId) =>
				sessionActions.updateSessionPermissions({ sessionId, permissionsMode: 'bypass' }),
			)

			// Close dialog - visual feedback is the red ShieldOff icons
			setBypassDialogOpen(false)
			setBypassSessionIds([])

			Promise.all(transactions.map((t) => t.isPersisted.promise)).catch((error) => {
				toast.error('Failed to enable bypass permissions')
				captureException(error, { extra: { action: 'updateSessionPermissions' } })
			})
		},
		[bypassSessionIds, sessionActions],
	)

	const handleAutoAcceptEdits = useCallback(
		(sessionId: string) => {
			const session = sessions.find((s) => s.id === sessionId)
			if (!session) return

			const newMode = session.autoAcceptEdits ? 'default' : 'accept_edits'
			const transaction = sessionActions.updateSessionPermissions({ sessionId, permissionsMode: newMode })

			// Visual feedback is the yellow double-arrow icons; only handle errors
			transaction.isPersisted.promise.catch((error) => {
				toast.error('Failed to update auto-accept settings')
				captureException(error, { extra: { action: 'updateSessionPermissions', sessionId } })
			})
		},
		[sessions, sessionActions],
	)

	return {
		editingSessionId,
		setEditingSessionId,
		handleFocusSession,
		handleBlurSession,
		handleActivateSession,
		handleActivateDraft,
		handleStartEdit,
		handleSaveTitle,
		handleArchiveOrDiscard,
		handleArchiveOrDiscardById,
		handleBypassPermissions,
		handleOpenBypassSessionDialog,
		handleBypassConfirm,
		handleAutoAcceptEdits,
		bypassDialogOpen,
		setBypassDialogOpen,
		bypassSessionCount: bypassSessionIds.length,
	}
}

/**
 * Keyboard focus navigation (j/k/gg/G) over a session list, preloading the
 * focused session's route so Enter feels instant.
 */
export function useSessionListFocusNav(sessions: TableSession[]) {
	const router = useRouter()

	const focusAndPreload = useCallback(
		(sessionId: string) => {
			useFocusStore.getState().setFocusedSessionId(sessionId, 'keyboard')
			void router.preloadRoute({ to: '/sessions/$sessionId', params: { sessionId } })
		},
		[router],
	)

	const handleFocusNext = useCallback(() => {
		if (sessions.length === 0) return
		const focusedId = useFocusStore.getState().focusedSessionId
		const currentIndex = sessions.findIndex((s) => s.id === focusedId)
		const nextIndex = currentIndex >= sessions.length - 1 ? 0 : currentIndex + 1
		const nextSession = sessions[nextIndex]
		if (nextSession === undefined) return
		focusAndPreload(nextSession.id)
	}, [sessions, focusAndPreload])

	const handleFocusPrevious = useCallback(() => {
		if (sessions.length === 0) return
		const focusedId = useFocusStore.getState().focusedSessionId
		const currentIndex = sessions.findIndex((s) => s.id === focusedId)
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

	return { handleFocusNext, handleFocusPrevious, handleFocusFirst, handleFocusLast }
}
