import type { PermissionsModeNoBypass } from '@humanlayer/ui/constants/permission-modes'
import { useCallback, useState } from 'react'
import { toast } from 'sonner'

import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { usePermissionNudge } from '@/hooks/usePermissionNudge'
import type { useSessionActions } from '@/hooks/useSessionActions'
import { captureException } from '@/integrations/sentry/sentry'

import type { SessionDetailSession } from './useSessionDetailData'

/**
 * Permission-mode controls for the session detail page: the bypass
 * permissions dialog (manual ⌥+Y and auto-nudge variants) and the
 * permission-mode change handlers.
 */
export function useSessionPermissionControls({
	sessionId,
	session,
	sessionActions,
	approvals,
}: {
	sessionId: string
	session: SessionDetailSession | undefined
	sessionActions: ReturnType<typeof useSessionActions>
	approvals: Array<{ status: string }> | undefined
}) {
	// Bypass permissions dialog state
	const [bypassDialogOpen, setBypassDialogOpen] = useState(false)
	const bypassNudgeSilenced = useSettingsStore((s) => s.bypassNudgeSilenced)
	const setBypassNudgeSilenced = useSettingsStore((s) => s.setBypassNudgeSilenced)

	// Nudge: auto-open BypassPermissionsDialog after N approvals in default mode
	const { nudgeOpen: bypassNudgeOpen, dismissNudge: dismissBypassNudge } = usePermissionNudge({
		sessionId,
		approvals,
		silenced: bypassNudgeSilenced,
		permissionsMode: session?.permissions_mode ?? 'default',
	})

	// Handle bypass permissions toggle (opt+y)
	const handleBypassPermissions = useCallback(() => {
		if (!session) return

		const currentMode = session.permissions_mode

		if (currentMode === 'bypass') {
			// Currently bypassing - disable directly without dialog
			const transaction = sessionActions.updateSessionPermissions({
				sessionId: session.id,
				permissionsMode: 'default',
			})

			// Silent disable to match WUI behavior (no success toast)
			transaction.isPersisted.promise.catch((error) => {
				toast.error('Failed to disable bypass permissions')
				captureException(error, {
					extra: { action: 'updateSessionPermissions', sessionId: session.id, taskId: session.task_id },
				})
			})
		} else {
			// Not bypassing - show confirmation dialog
			setBypassDialogOpen(true)
		}
	}, [session, sessionActions])

	// Handle bypass dialog confirmation
	const handleBypassConfirm = useCallback(
		(_: number | null) => {
			if (!session) return

			const transaction = sessionActions.updateSessionPermissions({
				sessionId: session.id,
				permissionsMode: 'bypass',
			})

			// Close dialog - visual feedback is the red ShieldOff icon
			setBypassDialogOpen(false)

			// Only handle errors
			transaction.isPersisted.promise.catch((error) => {
				toast.error('Failed to enable bypass permissions')
				captureException(error, {
					extra: { action: 'updateSessionPermissions', sessionId: session.id, taskId: session.task_id },
				})
			})
		},
		[session, sessionActions],
	)

	// Handle permission mode change (used by the PermissionModeButton dropdown)
	const handlePermissionModeChange = useCallback(
		(mode: PermissionsModeNoBypass) => {
			if (!session) return
			sessionActions
				.updateSessionPermissions({ sessionId: session.id, permissionsMode: mode })
				.isPersisted.promise.catch((error) => {
					toast.error('Failed to update auto-accept settings')
					captureException(error, {
						extra: { action: 'updateSessionPermissions', sessionId: session.id, taskId: session.task_id },
					})
				})
		},
		[session, sessionActions],
	)

	// Handle auto-accept edits toggle (opt+a) — binary accept_edits ↔ default for the hotkey
	const handleAutoAcceptToggle = useCallback(() => {
		if (!session) return
		const current = session.permissions_mode as PermissionsModeNoBypass
		handlePermissionModeChange(current === 'accept_edits' ? 'default' : 'accept_edits')
	}, [session, handlePermissionModeChange])

	return {
		bypassDialogOpen,
		setBypassDialogOpen,
		bypassNudgeOpen,
		dismissBypassNudge,
		setBypassNudgeSilenced,
		handleBypassPermissions,
		handleBypassConfirm,
		handlePermissionModeChange,
		handleAutoAcceptToggle,
	}
}
