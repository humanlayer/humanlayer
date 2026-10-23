import { useHotkeys } from '@humanlayer/react-hotkeys-hook'

import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'

import type { useSessionForkMode } from './useSessionForkMode'

/** Bind the existing fork model, preserving the raw library's modifier handling. */
export function useSessionForkHotkeys({
	fork,
	canManageSession,
	isModalOpen,
}: {
	fork: Pick<
		ReturnType<typeof useSessionForkMode>,
		'isForkMode' | 'userMessageCount' | 'handleEnterForkMode' | 'handleForkCancel'
	>
	canManageSession: boolean
	isModalOpen: boolean
}) {
	const { isForkMode, userMessageCount, handleEnterForkMode, handleForkCancel } = fork

	// Cmd+Y to toggle fork mode (only for users with edit access).
	useHotkeys(
		'mod+y',
		(e) => {
			e.preventDefault()
			if (isForkMode) {
				handleForkCancel()
			} else {
				handleEnterForkMode()
			}
		},
		{
			scopes: [HOTKEY_SCOPES.SESSION_DETAIL, HOTKEY_SCOPES.ARTIFACT_PANEL],
			enabled: canManageSession && !isModalOpen && (isForkMode || userMessageCount >= 2),
			enableOnFormTags: true,
			enableOnContentEditable: true,
		},
		[canManageSession, isForkMode, isModalOpen, userMessageCount, handleEnterForkMode, handleForkCancel],
	)
}
