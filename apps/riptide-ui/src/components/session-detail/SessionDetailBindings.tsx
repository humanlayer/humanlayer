import {
	type ConversationNavigationController,
	useConversationNavigationHotkeys,
} from '@/components/conversation-stream/hooks/useConversationNavigation'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { useSessionArtifactPanelHotkeys } from '@/hooks/session-detail/useSessionArtifactPanelHotkeys'
import { useSessionForkHotkeys } from '@/hooks/session-detail/useSessionForkHotkeys'
import { useArtifactPaneOwnsNavigationKeys } from '@/hooks/stores/artifactViewerStore'
import { useFocusStore } from '@/hooks/stores/focusStore'
import { useSessionUiStoreApi } from '@/hooks/stores/sessionUiStore'
import { useSessionCommandPaletteActions } from '@/hooks/useSessionCommandPaletteActions'
import { useSessionHotkeys } from '@/hooks/useSessionHotkeys'

import type { SessionDetailBindingState } from './SessionDetailProvider'

/** Registry and keyboard-only focus subscriptions must not live in the data owner. */
export function SessionKeyboardBindings({
	state,
	navigation,
}: {
	state: SessionDetailBindingState
	navigation: ConversationNavigationController
}) {
	const { setModelSelectorOpen, toggleTaskTerminal } = useSessionUiStoreApi().getState()
	const isEditorFocused = useFocusStore((store) => store.isEditorFocused)
	const artifactPaneOwnsNavigationKeys = useArtifactPaneOwnsNavigationKeys()

	useSessionArtifactPanelHotkeys({ artifactPanel: state.artifactPanel, isModalOpen: state.isModalOpen })
	useConversationNavigationHotkeys({
		controller: navigation,
		scopes: [HOTKEY_SCOPES.SESSION_DETAIL, HOTKEY_SCOPES.ARTIFACT_PANEL],
		disabled: state.isModalOpen || isEditorFocused || artifactPaneOwnsNavigationKeys,
	})
	useSessionForkHotkeys({
		fork: state.fork,
		canManageSession: state.canManageSession,
		isModalOpen: state.isModalOpen,
	})
	useSessionHotkeys({
		session: state.session,
		events: state.conversation.events,
		canResolveApproval: state.canResolveApproval,
		canManageSession: state.canManageSession,
		canSendPrompt: state.canSendPromptToHost,
		isModalOpen: state.isModalOpen,
		isEditorFocused,
		isReadyForInput: state.isReadyForInput,
		setFocusedEventId: state.setFocusedEventId,
		continueEditorRef: state.continueEditorRef,
		toggleTaskTerminal,
		setModelSelectorOpen,
		host: state.host,
		permissionControls: state.permissionControls,
		autoAdvance: state.autoAdvance,
		nextStep: state.nextStep,
		sendControls: state.sendControls,
		artifactPanel: state.artifactPanel,
		archiveTask: state.archiveTask,
	})
	return null
}

/** Keep palette/comment-query work out of keyboard-registry rerenders as well. */
export function SessionPaletteBindings({ state }: { state: SessionDetailBindingState }) {
	const { setModelSelectorOpen, toggleTaskTerminal } = useSessionUiStoreApi().getState()
	useSessionCommandPaletteActions({
		session: state.session,
		canManageSession: state.canManageSession,
		canSendPrompt: state.canSendPromptToHost,
		isReadyForInput: state.isReadyForInput,
		toggleTaskTerminal,
		onArchiveSession: state.archiveTask.handleToggleArchive,
		setIsTaskAssignmentOpen: state.archiveTask.setIsTaskAssignmentOpen,
		setModelSelectorOpen,
		host: state.host,
		permissionControls: state.permissionControls,
		autoAdvance: state.autoAdvance,
		fork: state.fork,
		sendControls: state.sendControls,
		nextStep: state.nextStep,
		onOpenMultiplayerPrompting: () => state.setIsMultiplayerPromptingOpen(true),
		commentDeliveryOwner: state.selectedArtifactViewerMode.commentDeliveryOwner,
	})
	return null
}
