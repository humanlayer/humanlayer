import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { useAppHotkeys } from '@/hooks/hotkeys/useAppHotkeys'

import type { useSessionArtifactPanel } from './useSessionArtifactPanel'

/** Bind the existing artifact model; this hook owns no artifact or sidebar state. */
export function useSessionArtifactPanelHotkeys({
	artifactPanel,
	isModalOpen,
}: {
	artifactPanel: Pick<
		ReturnType<typeof useSessionArtifactPanel>,
		'selectedArtifactId' | 'selectedArtifact' | 'handleRestoreSelectedArtifact' | 'handleArtifactPanelClose'
	>
	isModalOpen: boolean
}) {
	const { selectedArtifactId, selectedArtifact, handleRestoreSelectedArtifact, handleArtifactPanelClose } =
		artifactPanel

	// E restores a tombstoned artifact open in the panel.
	useAppHotkeys(
		'e',
		() => handleRestoreSelectedArtifact(),
		{
			scopes: [HOTKEY_SCOPES.SESSION_DETAIL, HOTKEY_SCOPES.ARTIFACT_PANEL],
			area: 'RIGHT_PANE',
			enabled: !!selectedArtifactId && !!selectedArtifact?.is_deleted && !isModalOpen,
		},
		[selectedArtifactId, selectedArtifact?.is_deleted, isModalOpen, handleRestoreSelectedArtifact],
	)

	// Escape closes the preview side panel (matches the X button).
	useAppHotkeys(
		'Escape',
		() => handleArtifactPanelClose(),
		{
			scopes: [HOTKEY_SCOPES.ARTIFACT_PANEL],
			area: 'MAIN',
			enabled: !!selectedArtifactId && !isModalOpen,
		},
		[handleArtifactPanelClose, selectedArtifactId, isModalOpen],
	)
}
