import { useHotkeys } from '@humanlayer/react-hotkeys-hook'
import { createFileRoute, Navigate, useNavigate } from '@tanstack/react-router'
import { useAuth } from '@workos-inc/authkit-react'
import { useCallback, useMemo } from 'react'

import { HotkeyScopeBoundary } from '@/components/HotkeyScopeBoundary'
import { SessionTable } from '@/components/session-table/SessionTable'
import type { TableSession } from '@/components/session-table/types'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { useArchivedSessions } from '@/hooks/live-queries/useArchivedSessions'
import { useFocusStore } from '@/hooks/stores/focusStore'
import { useMinimalistLayout } from '@/hooks/use-minimalist-layout'
import { toTableSession } from '@/utils/session-transforms'

export const Route = createFileRoute('/_app/archive/sessions')({
	component: ArchivedSessionsRoute,
})

/** The minimalist layout keeps its archive in settings. */
function ArchivedSessionsRoute() {
	const minimalist = useMinimalistLayout()
	if (minimalist) return <Navigate to="/settings/archived" replace />
	return <ArchivedSessionsPage />
}

function ArchivedSessionsPage() {
	const { user } = useAuth()
	const navigate = useNavigate()
	const archivedSessions = useArchivedSessions(user?.id)
	const tableArchivedSessions = useMemo(() => archivedSessions.map(toTableSession), [archivedSessions])

	const hasFocusedSession = useFocusStore((state) => state.focusedArchivedSessionId !== null)

	function focusSession(sessionId: string) {
		useFocusStore.getState().setFocusedArchivedSessionId(sessionId, 'keyboard')
	}

	// Navigation handlers
	const handleFocusNext = useCallback(() => {
		if (tableArchivedSessions.length === 0) return

		const focusedSessionId = useFocusStore.getState().focusedArchivedSessionId
		if (!focusedSessionId) {
			const firstSession = tableArchivedSessions[0]
			if (firstSession === undefined) return
			focusSession(firstSession.id)
			return
		}
		const currentIndex = tableArchivedSessions.findIndex((s) => s.id === focusedSessionId)
		// Wrap to first item if at last item, otherwise move to next
		const nextIndex = currentIndex >= tableArchivedSessions.length - 1 ? 0 : currentIndex + 1
		const nextSession = tableArchivedSessions[nextIndex]
		if (nextSession === undefined) return
		focusSession(nextSession.id)
	}, [tableArchivedSessions])

	const handleFocusPrevious = useCallback(() => {
		if (tableArchivedSessions.length === 0) return

		const focusedSessionId = useFocusStore.getState().focusedArchivedSessionId
		if (!focusedSessionId) {
			const lastSession = tableArchivedSessions[tableArchivedSessions.length - 1]
			if (lastSession === undefined) return
			focusSession(lastSession.id)
			return
		}
		const currentIndex = tableArchivedSessions.findIndex((s) => s.id === focusedSessionId)
		// Wrap to last item if at first item, otherwise move to previous
		const nextIndex = currentIndex <= 0 ? tableArchivedSessions.length - 1 : currentIndex - 1
		const prevSession = tableArchivedSessions[nextIndex]
		if (prevSession === undefined) return
		focusSession(prevSession.id)
	}, [tableArchivedSessions])

	const handleActivateSession = useCallback(
		(session: TableSession) => {
			navigate({
				to: '/sessions/$sessionId',
				params: { sessionId: session.id },
				search: { from: 'archive-sessions' },
			})
		},
		[navigate],
	)

	const handleActivateFocusedSession = useCallback(() => {
		const focusedSessionId = useFocusStore.getState().focusedArchivedSessionId
		if (!focusedSessionId) return
		const session = tableArchivedSessions.find((s) => s.id === focusedSessionId)
		if (session) {
			handleActivateSession(session)
		}
	}, [tableArchivedSessions, handleActivateSession])

	// Escape - Navigate back to /sessions with sessions tab
	useHotkeys(
		'Escape',
		() => {
			if (window.history.length > 1) {
				window.history.back()
			} else {
				navigate({ to: '/sessions', search: { tab: 'sessions' } })
			}
		},
		{
			scopes: [HOTKEY_SCOPES.ARCHIVE_SESSIONS],
			enabled: true,
			preventDefault: true,
		},
		[navigate],
	)

	// j - Navigate down
	useHotkeys(
		'j',
		() => handleFocusNext(),
		{
			scopes: [HOTKEY_SCOPES.ARCHIVE_SESSIONS],
			enabled: tableArchivedSessions.length > 0,
			preventDefault: true,
		},
		[handleFocusNext, tableArchivedSessions.length],
	)

	// k - Navigate up
	useHotkeys(
		'k',
		() => handleFocusPrevious(),
		{
			scopes: [HOTKEY_SCOPES.ARCHIVE_SESSIONS],
			enabled: tableArchivedSessions.length > 0,
			preventDefault: true,
		},
		[handleFocusPrevious, tableArchivedSessions.length],
	)

	// Enter - Activate focused session
	useHotkeys(
		'enter',
		() => handleActivateFocusedSession(),
		{
			scopes: [HOTKEY_SCOPES.ARCHIVE_SESSIONS],
			enabled: hasFocusedSession,
			preventDefault: true,
		},
		[handleActivateFocusedSession],
	)

	return (
		<HotkeyScopeBoundary scope={HOTKEY_SCOPES.ARCHIVE_SESSIONS} componentName="ArchivedSessionsPage">
			<div className="flex flex-col h-full">
				<SessionTable
					sessions={tableArchivedSessions}
					focusCursor="archived-session"
					isArchivedView={true}
					isDraftsView={false}
					onFocusSession={(session) => {
						if (useFocusStore.getState().focusSource !== 'mouse') return
						useFocusStore.getState().setFocusedArchivedSessionId(session.id, 'mouse')
					}}
					onBlurSession={() => {}}
					onActivateSession={handleActivateSession}
					onSaveTitle={() => {}}
					onCreateSession={() => navigate({ to: '/sessions/draft' })}
					onNavigateToSessions={() => navigate({ to: '/sessions' })}
				/>
			</div>
		</HotkeyScopeBoundary>
	)
}
