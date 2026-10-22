import { BypassPermissionsDialog } from '@humanlayer/ui/components/bypass-permissions-dialog'
import { useNavigate } from '@tanstack/react-router'
import { useAuth } from '@workos-inc/authkit-react'
import { Archive } from 'lucide-react'
import { useCallback, useMemo } from 'react'

import { HotkeyScopeBoundary } from '@/components/HotkeyScopeBoundary'
import { SessionTable } from '@/components/session-table/SessionTable'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { useActiveSessions } from '@/hooks/live-queries/useActiveSessions'
import { useCommandPaletteStore } from '@/hooks/stores/commandPaletteStore'
import { useFocusStore } from '@/hooks/stores/focusStore'
import { useUnreadStore } from '@/hooks/stores/unreadStore'
import { useCommandPaletteAction } from '@/hooks/useCommandPaletteAction'
import { useSessionListFocusNav, useSessionRowActions } from '@/hooks/useSessionRowActions'
import { useSessionTableHotkeys } from '@/hooks/useSessionTableHotkeys'
import { toTableSession } from '@/utils/session-transforms'

/**
 * The Sessions tab on the sessions list page: the active (non-draft,
 * non-archived) owned sessions table. Owns its data, row actions, hotkeys,
 * and the bypass-permissions dialog.
 */
export function ActiveSessionsTab() {
	const navigate = useNavigate()
	const { user } = useAuth()
	const activeSessions = useActiveSessions(user?.id)
	const unreadSessionIds = useUnreadStore((s) => s.unreadSessionIds)
	const hasFocusedSession = useFocusStore((s) => s.focusedSessionId !== null)

	const sessions = useMemo(
		() =>
			activeSessions.map((s) => ({
				...toTableSession(s),
				isUnread: unreadSessionIds.has(s.id),
			})),
		[activeSessions, unreadSessionIds],
	)

	const actions = useSessionRowActions(sessions)
	const focusNav = useSessionListFocusNav(sessions)

	// Keep one tab-level archive action; its gate changes only on none↔some focus
	// transitions and the action resolves the current ID at invocation time.
	const handleArchiveOrDiscardById = actions.handleArchiveOrDiscardById
	useCommandPaletteAction({
		id: 'archive-session',
		label: 'Archive Session',
		icon: Archive,
		shortcut: 'E',
		enabled: hasFocusedSession,
		onSelect: useCallback(() => {
			const sessionId = useFocusStore.getState().focusedSessionId
			if (sessionId) handleArchiveOrDiscardById(sessionId)
		}, [handleArchiveOrDiscardById]),
	})

	useSessionTableHotkeys({
		sessions,
		editingSessionId: actions.editingSessionId,
		scope: HOTKEY_SCOPES.SESSIONS_LIST,
		onFocusNext: focusNav.handleFocusNext,
		onFocusPrevious: focusNav.handleFocusPrevious,
		onFocusFirst: focusNav.handleFocusFirst,
		onFocusLast: focusNav.handleFocusLast,
		onActivateSession: actions.handleActivateSession,
		onActivateDraft: actions.handleActivateDraft,
		onStartEdit: actions.handleStartEdit,
		onArchiveOrDiscard: actions.handleArchiveOrDiscard,
		onBypassPermissions: actions.handleBypassPermissions,
		onAutoAcceptEdits: actions.handleAutoAcceptEdits,
	})

	return (
		<>
			<SessionTable
				sessions={sessions}
				isArchivedView={false}
				isDraftsView={false}
				editingSessionId={actions.editingSessionId}
				onEditingChange={actions.setEditingSessionId}
				onFocusSession={actions.handleFocusSession}
				onBlurSession={actions.handleBlurSession}
				onActivateSession={actions.handleActivateSession}
				onActivateDraft={actions.handleActivateDraft}
				onSaveTitle={actions.handleSaveTitle}
				onOpenArchiveDialog={actions.handleArchiveOrDiscard}
				onOpenBypassDialog={actions.handleOpenBypassSessionDialog}
				onCreateSession={() => navigate({ to: '/sessions/draft' })}
				onOpenCommandPalette={() => useCommandPaletteStore.getState().open()}
				onNavigateToSessions={() => navigate({ to: '/sessions', search: { tab: 'sessions' } })}
			/>

			<HotkeyScopeBoundary
				scope={HOTKEY_SCOPES.BYPASS_PERMISSIONS_DIALOG}
				isActive={actions.bypassDialogOpen}
				rootScopeDisabled={true}
				componentName="BypassPermissionsDialog"
			>
				<BypassPermissionsDialog
					open={actions.bypassDialogOpen}
					onOpenChange={actions.setBypassDialogOpen}
					onConfirm={actions.handleBypassConfirm}
					sessionCount={actions.bypassSessionCount}
					hotkeyScope={HOTKEY_SCOPES.BYPASS_PERMISSIONS_DIALOG}
				/>
			</HotkeyScopeBoundary>
		</>
	)
}
