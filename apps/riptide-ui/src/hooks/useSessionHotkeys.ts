import { parseSuggestions } from '@humanlayer/db/zodschemas/permission-update'
import type { ConversationEvent } from '@humanlayer/ui/components/conversation-stream'
import type { RichTextEditorRef } from '@humanlayer/ui/components/rich-text-editor'
import { isPreviewableFile } from '@humanlayer/ui/lib/file-types'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { useCopyToClipboard } from '@uidotdev/usehooks'
import { type Dispatch, type RefObject, type SetStateAction, useCallback } from 'react'
import { toast } from 'sonner'

import { focusMainAndReleaseSpatialDomFocus } from '@/components/keyboard-focus-transfer'
import { useEditableFocus } from '@/hooks/hotkeys/editable-focus'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { useAppHotkeys } from '@/hooks/hotkeys/useAppHotkeys'
import { useArchiveHotkey } from '@/hooks/hotkeys/useArchiveHotkey'
import type { useSessionArchiveAndTask } from '@/hooks/session-detail/useSessionArchiveAndTask'
import type { useSessionArtifactPanel } from '@/hooks/session-detail/useSessionArtifactPanel'
import type { useSessionAutoAdvance } from '@/hooks/session-detail/useSessionAutoAdvance'
import type { SessionDetailSession } from '@/hooks/session-detail/useSessionDetailData'
import type { useSessionHostStatus } from '@/hooks/session-detail/useSessionHostStatus'
import type { useSessionNextStep } from '@/hooks/session-detail/useSessionNextStep'
import type { useSessionPermissionControls } from '@/hooks/session-detail/useSessionPermissionControls'
import type { useSessionSendControls } from '@/hooks/session-detail/useSessionSendControls'
import { useApprovalStore } from '@/hooks/stores/approvalStore'
import { useArtifactViewerStore } from '@/hooks/stores/artifactViewerStore'
import { useDismissedNextStepStore } from '@/hooks/stores/dismissedNextStepStore'
import { FOCUSED_AREAS } from '@/hooks/stores/focus-areas'
import { useFocusStore } from '@/hooks/stores/focusStore'
import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { useApprovalActions } from '@/hooks/useApprovalActions'
import { hotkeysCatalog } from '@/hotkeysCatalog'
import { getContextWarningThreshold } from '@/lib/context-warning'
import { openWorkingDirectoryInEditor } from '@/lib/file-opener'
import { isDesktop } from '@/lib/utils'
import { copySessionDeepLink } from '@/utils/sharing-links'

/**
 * Hotkey registrations for the session detail page. Takes the feature-hook
 * groups from SessionDetailProvider's state plus the page-level UI state the
 * hotkeys close over; owns its own router and clipboard access.
 */
export function useSessionHotkeys({
	session,
	events,
	canResolveApproval,
	canManageSession,
	canSendPrompt,
	isModalOpen,
	isEditorFocused: storedEditorFocused,
	isReadyForInput,
	setFocusedEventId,
	continueEditorRef,
	toggleTaskTerminal,
	setModelSelectorOpen,
	host,
	permissionControls,
	autoAdvance,
	nextStep,
	sendControls,
	artifactPanel,
	archiveTask,
}: {
	session: SessionDetailSession | undefined
	events: ConversationEvent[]
	canResolveApproval: boolean
	canManageSession: boolean
	canSendPrompt: boolean
	isModalOpen: boolean
	isEditorFocused: boolean
	isReadyForInput: boolean
	setFocusedEventId: (id: string, source: 'mouse' | 'keyboard') => void
	continueEditorRef: RefObject<RichTextEditorRef | null>
	toggleTaskTerminal: () => void
	setModelSelectorOpen: Dispatch<SetStateAction<boolean>>
	host: ReturnType<typeof useSessionHostStatus>
	permissionControls: ReturnType<typeof useSessionPermissionControls>
	autoAdvance: ReturnType<typeof useSessionAutoAdvance>
	nextStep: ReturnType<typeof useSessionNextStep>
	sendControls: ReturnType<typeof useSessionSendControls>
	artifactPanel: ReturnType<typeof useSessionArtifactPanel>
	archiveTask: ReturnType<typeof useSessionArchiveAndTask>
}) {
	const editableHasFocus = useEditableFocus()
	const isEditorFocused = storedEditorFocused || editableHasFocus
	const navigate = useNavigate()
	const { from } = useSearch({ from: '/_app/sessions/$sessionId' })
	const [, copyToClipboard] = useCopyToClipboard()
	const { approve, approveWithSuggestions } = useApprovalActions()
	const denyingApproval = useApprovalStore((state) => state.denyingApproval)
	const cancelDeny = useApprovalStore((state) => state.cancelDeny)

	const { isColocated } = host
	const { bypassDialogOpen, handleBypassPermissions, handleAutoAcceptToggle } = permissionControls
	const {
		isAutoAdvanceEnabled,
		autoAdvanceConfig,
		iterateSlashCommand,
		handleAutoAdvanceToggle,
		handleIterateInNewSession,
	} = autoAdvance
	const {
		siblingSessionId,
		handleNavigateToSibling,
		handleRowProceedToNextStep,
		lastNextStepEventId,
		lastNextStepEventInViewport,
		lastNextStepSuggestion,
		scrollToNextStepEvent,
		oldestPendingApprovalEventId,
		oldestPendingApprovalInViewport,
		scrollToPendingApprovalEvent,
	} = nextStep
	const { handleInterrupt } = sendControls
	const { selectedArtifactId, selectedArtifact, handleArtifactPanelClose, toggleFullscreen, openFullscreenModal } =
		artifactPanel
	const { setIsTaskAssignmentOpen, handleToggleArchive } = archiveTask

	// Helper to check if current focused event is a pending approval. Reads
	// focus via getState() — a subscription would re-render the provider on
	// every j/k, and this only runs inside hotkey handlers.
	const getFocusedPendingApproval = useCallback(() => {
		const focusedEventId = useFocusStore.getState().focusedEventId
		if (focusedEventId == null) return null
		const focusedEvent = events.find((e) => e.id === focusedEventId)
		if (focusedEvent?.approvalStatus === 'pending' && focusedEvent.approvalId) {
			return focusedEvent
		}
		return null
	}, [events])

	const getApprovableSuggestions = useCallback((event: ConversationEvent) => {
		return (parseSuggestions(event.suggestions) ?? []).filter((suggestion) => suggestion.type !== 'setMode')
	}, [])

	// ===== Hotkey Registrations =====

	// Approval hotkeys. Pressing A scrolls/focuses the oldest pending approval;
	// pressing A again approves it. Pressing L applies all non-mode suggestions.
	useAppHotkeys(
		'a',
		() => {
			const focusedApproval = getFocusedPendingApproval()
			if (focusedApproval?.approvalId) {
				void approve(focusedApproval.approvalId)
				return
			}
			if (!oldestPendingApprovalEventId) return
			if (!oldestPendingApprovalInViewport) {
				scrollToPendingApprovalEvent(oldestPendingApprovalEventId)
				return
			}
			setFocusedEventId(oldestPendingApprovalEventId, 'keyboard')
		},
		{
			scopes: [HOTKEY_SCOPES.SESSION_DETAIL, HOTKEY_SCOPES.ARTIFACT_PANEL],
			area: 'MAIN',
			enabled: canResolveApproval && !isModalOpen,
		},
		[
			canResolveApproval,
			getFocusedPendingApproval,
			approve,
			isModalOpen,
			oldestPendingApprovalEventId,
			oldestPendingApprovalInViewport,
			scrollToPendingApprovalEvent,
			setFocusedEventId,
		],
	)

	useAppHotkeys(
		'l',
		() => {
			const focusedApproval = getFocusedPendingApproval()
			if (!focusedApproval?.approvalId) return
			const approvableSuggestions = getApprovableSuggestions(focusedApproval)
			if (approvableSuggestions.length === 0) return
			void approveWithSuggestions(focusedApproval.approvalId, approvableSuggestions)
		},
		{
			scopes: [HOTKEY_SCOPES.SESSION_DETAIL, HOTKEY_SCOPES.ARTIFACT_PANEL],
			area: 'MAIN',
			enabled: canResolveApproval && !isModalOpen,
		},
		[canResolveApproval, getApprovableSuggestions, getFocusedPendingApproval, approveWithSuggestions, isModalOpen],
	)

	useAppHotkeys(
		'd',
		() => {
			const focusedApproval = getFocusedPendingApproval()
			if (focusedApproval?.approvalId) {
				useApprovalStore.getState().startDeny(focusedApproval.approvalId, focusedApproval.toolName || 'Unknown')
				return
			}
			if (!oldestPendingApprovalEventId) return
			if (session?.status === 'needs_approval') {
				if (!oldestPendingApprovalInViewport) {
					scrollToPendingApprovalEvent(oldestPendingApprovalEventId)
				} else {
					setFocusedEventId(oldestPendingApprovalEventId, 'keyboard')
				}
				return
			}
			const oldest = events.find((e) => e.id === oldestPendingApprovalEventId)
			if (oldest?.approvalId) {
				useApprovalStore.getState().startDeny(oldest.approvalId, oldest.toolName || 'Unknown')
			}
		},
		{
			scopes: [HOTKEY_SCOPES.SESSION_DETAIL, HOTKEY_SCOPES.ARTIFACT_PANEL],
			area: 'MAIN',
			enabled: canResolveApproval && !isModalOpen,
		},
		[
			canResolveApproval,
			getFocusedPendingApproval,
			isModalOpen,
			events,
			oldestPendingApprovalEventId,
			oldestPendingApprovalInViewport,
			scrollToPendingApprovalEvent,
			setFocusedEventId,
			session?.status,
		],
	)

	// Yank (copy) focused message content to clipboard
	useAppHotkeys(
		'y',
		() => {
			const focusedEventId = useFocusStore.getState().focusedEventId
			if (focusedEventId == null) return
			const event = events.find((e) => e.id === focusedEventId)
			if (!event) return

			// Copy user/assistant messages
			if (event.eventType === 'message' && (event.role === 'user' || event.role === 'assistant')) {
				if (event.content) {
					void copyToClipboard(event.content)
					toast.success('Copied to clipboard')
				}
				return
			}

			// Copy bash command from tool_call events
			if (event.eventType === 'tool_call' && event.toolName === 'Bash') {
				try {
					const toolInput = JSON.parse(event.toolInputJson || '{}') as { command?: string }
					if (toolInput.command) {
						void copyToClipboard(toolInput.command)
						toast.success('Copied command to clipboard')
					}
				} catch {
					toast.error('Failed to parse command')
				}
				return
			}

			// Other event types - no copy action
			toast.warning('Cannot copy this content')
		},
		{
			scopes: [HOTKEY_SCOPES.SESSION_DETAIL, HOTKEY_SCOPES.ARTIFACT_PANEL],
			enabled: !isModalOpen && !isEditorFocused,
		},
		[events, copyToClipboard, isModalOpen, isEditorFocused],
	)

	// Escape to cancel transient state, recover spatial ownership, then navigate back.
	// Pattern from wui: 2-step exit from denying mode (blur editor first, then cancel deny)
	useAppHotkeys(
		'Escape',
		() => {
			// Step 1: If denying and editor is focused, just blur the editor
			// User needs to press Escape again to actually cancel the deny
			if (denyingApproval && isEditorFocused) {
				continueEditorRef.current?.blur()
				return
			}

			// Step 2: If denying (editor not focused), cancel the deny
			if (denyingApproval) {
				cancelDeny()
				return
			}

			if (useFocusStore.getState().focusedArea !== FOCUSED_AREAS.MAIN) {
				focusMainAndReleaseSpatialDomFocus()
				return
			}

			const activeEl = document.activeElement
			const isBodyOrNull = !activeEl || activeEl === document.body

			if (!isBodyOrNull && activeEl instanceof HTMLElement) {
				activeEl.blur()
				focusMainAndReleaseSpatialDomFocus()
				return
			}

			if (from === 'archive-sessions') {
				navigate({ to: '/archive/sessions' })
			} else if (session?.task_id) {
				if (from === 'archive-tasks') window.history.back()
				else navigate({ to: '/tasks/$taskId', params: { taskId: session.task_id } })
			} else {
				navigate({ to: '/sessions', search: { tab: 'sessions' } })
			}
		},
		{
			scopes: [HOTKEY_SCOPES.SESSION_DETAIL, HOTKEY_SCOPES.ARTIFACT_PANEL],
			enabled: !isModalOpen,
			enableOnFormTags: true,
		},
		[denyingApproval, cancelDeny, isModalOpen, isEditorFocused, from, navigate, session?.task_id],
	)

	// Bypass permissions hotkey (opt+y) - works even when editor is focused
	useAppHotkeys(
		'alt+y',
		(e) => {
			e.preventDefault()
			handleBypassPermissions()
		},
		{
			scopes: [HOTKEY_SCOPES.SESSION_DETAIL, HOTKEY_SCOPES.ARTIFACT_PANEL],
			enabled: canSendPrompt && !isModalOpen && !bypassDialogOpen,
			enableOnFormTags: true,
			enableOnContentEditable: true,
		},
		[canSendPrompt, handleBypassPermissions, isModalOpen, bypassDialogOpen],
	)

	// Auto-accept edits hotkey (opt+a) - works even when editor is focused
	useAppHotkeys(
		'alt+a',
		(e) => {
			e.preventDefault()
			handleAutoAcceptToggle()
		},
		{
			scopes: [HOTKEY_SCOPES.SESSION_DETAIL, HOTKEY_SCOPES.ARTIFACT_PANEL],
			enabled: canSendPrompt && !isModalOpen && !bypassDialogOpen,
			enableOnFormTags: true,
			enableOnContentEditable: true,
		},
		[canSendPrompt, handleAutoAcceptToggle, isModalOpen, bypassDialogOpen],
	)

	// Auto-advance toggle hotkey (opt+shift+a)
	useAppHotkeys(
		'alt+shift+a',
		(e) => {
			e.preventDefault()
			handleAutoAdvanceToggle()
		},
		{
			scopes: [HOTKEY_SCOPES.SESSION_DETAIL, HOTKEY_SCOPES.ARTIFACT_PANEL],
			enabled: canManageSession && autoAdvanceConfig.show && !isModalOpen && !bypassDialogOpen,
			enableOnFormTags: true,
			enableOnContentEditable: true,
		},
		[canManageSession, handleAutoAdvanceToggle, autoAdvanceConfig.show, isModalOpen, bypassDialogOpen],
	)

	// Archive session hotkey (settings-selected binding) - only when editor is NOT focused
	useArchiveHotkey(
		() => {
			handleToggleArchive()
		},
		{
			scopes: [HOTKEY_SCOPES.SESSION_DETAIL, HOTKEY_SCOPES.ARTIFACT_PANEL],
			area: 'MAIN',
			enabled: canManageSession && !isModalOpen && !isEditorFocused,
		},
		[canManageSession, handleToggleArchive, isModalOpen, isEditorFocused],
	)

	// Create new session hotkey (c) - navigate to draft launcher with task pre-filled if present
	useAppHotkeys(
		'c',
		() => {
			navigate({
				to: '/sessions/draft',
				search: session?.task_id ? { taskId: session.task_id } : undefined,
			})
		},
		{
			scopes: [HOTKEY_SCOPES.SESSION_DETAIL, HOTKEY_SCOPES.ARTIFACT_PANEL],
			area: 'MAIN',
			enabled: !isModalOpen,
			enableOnFormTags: false,
		},
		[navigate, isModalOpen, session?.task_id],
	)

	// t - Create new task
	useAppHotkeys(
		't',
		(e) => {
			e.stopPropagation()
			navigate({ to: '/tasks/new' })
		},
		{
			scopes: [HOTKEY_SCOPES.SESSION_DETAIL, HOTKEY_SCOPES.ARTIFACT_PANEL],
			enabled: !isModalOpen && !isEditorFocused && !denyingApproval,
			preventDefault: true,
			enableOnFormTags: false,
		},
		[navigate, isModalOpen, isEditorFocused, denyingApproval],
	)

	// Open task assignment dialog for both standalone and task-linked sessions.
	useAppHotkeys(
		'shift+t',
		(e) => {
			e.preventDefault()
			setIsTaskAssignmentOpen(true)
		},
		{
			scopes: [HOTKEY_SCOPES.SESSION_DETAIL, HOTKEY_SCOPES.ARTIFACT_PANEL],
			enabled: canManageSession && !isModalOpen && Boolean(session),
			enableOnFormTags: false,
		},
		[canManageSession, isModalOpen, session],
	)

	// Enter to focus editor when not already focused
	useAppHotkeys(
		'enter',
		(e) => {
			if (useFocusStore.getState().focusedArea === FOCUSED_AREAS.RIGHT_PANE) {
				queueMicrotask(() => {
					const originatedInFileTree = e
						.composedPath()
						.some((target) => target instanceof HTMLElement && target.tagName === 'FILE-TREE-CONTAINER')
					if (
						e.defaultPrevented ||
						originatedInFileTree ||
						useArtifactViewerStore.getState().selectedArtifactId
					)
						return
					e.preventDefault()
					focusMainAndReleaseSpatialDomFocus(e.view?.document ?? document)
					continueEditorRef.current?.focus()
				})
				return
			}
			e.preventDefault()
			continueEditorRef.current?.focus()
		},
		{
			enabled: canSendPrompt && !isEditorFocused && !isModalOpen,
			scopes: [HOTKEY_SCOPES.SESSION_DETAIL, HOTKEY_SCOPES.ARTIFACT_PANEL],
			area: [FOCUSED_AREAS.MAIN, FOCUSED_AREAS.RIGHT_PANE],
			enableOnContentEditable: false,
			enableOnFormTags: false,
		},
		[canSendPrompt, isEditorFocused, isModalOpen],
	)

	// shift+m - Toggle model selector dropdown
	useAppHotkeys(
		'shift+m',
		(e) => {
			e.preventDefault()
			setModelSelectorOpen((prev) => !prev)
		},
		{
			enabled: canSendPrompt && isReadyForInput && !isModalOpen,
			enableOnFormTags: false,
			enableOnContentEditable: false,
			scopes: [HOTKEY_SCOPES.SESSION_DETAIL, HOTKEY_SCOPES.ARTIFACT_PANEL],
		},
		[canSendPrompt, isReadyForInput, isModalOpen],
	)

	useAppHotkeys(
		hotkeysCatalog.sessionDetail.shortcuts.copyPrimaryUrl.reactHotkeys,
		(e) => {
			e.preventDefault()
			if (session?.id) void copySessionDeepLink(session.id)
		},
		{
			scopes: [HOTKEY_SCOPES.SESSION_DETAIL, HOTKEY_SCOPES.ARTIFACT_PANEL],
			enabled: Boolean(session?.id) && !isModalOpen,
			preventDefault: true,
			enableOnFormTags: false,
		},
		[session?.id, isModalOpen],
	)

	useAppHotkeys(
		hotkeysCatalog.sessionDetail.shortcuts.attachFile.reactHotkeys,
		(e) => {
			e.preventDefault()
			const fileInput = document.querySelector('input[type="file"][multiple]') as HTMLInputElement | null
			fileInput?.click()
		},
		{
			scopes: [HOTKEY_SCOPES.SESSION_DETAIL, HOTKEY_SCOPES.ARTIFACT_PANEL],
			enabled: canSendPrompt && !isModalOpen,
			preventDefault: true,
			enableOnFormTags: true,
			enableOnContentEditable: true,
		},
		[canSendPrompt, isModalOpen],
	)

	useAppHotkeys(
		hotkeysCatalog.sessionDetail.shortcuts.toggleDiff.reactHotkeys,
		(e) => {
			e.preventDefault()
			const settings = useSettingsStore.getState()
			settings.setDiffStyle(settings.diffStyle === 'split' ? 'unified' : 'split')
		},
		{
			scopes: [HOTKEY_SCOPES.SESSION_DETAIL, HOTKEY_SCOPES.ARTIFACT_PANEL],
			enabled: !isModalOpen && !isEditorFocused,
			preventDefault: true,
			enableOnFormTags: false,
		},
		[isModalOpen, isEditorFocused],
	)

	// Open in Editor hotkey
	useAppHotkeys(
		'mod+shift+o',
		() => {
			if (isDesktop() && isColocated && session?.working_directory) {
				openWorkingDirectoryInEditor(session.working_directory)
			}
		},
		{
			scopes: [HOTKEY_SCOPES.SESSION_DETAIL, HOTKEY_SCOPES.ARTIFACT_PANEL],
			enabled: isDesktop() && isColocated && !!session?.working_directory,
			preventDefault: true,
			enableOnFormTags: true,
			enableOnContentEditable: true,
		},
		[session?.working_directory, isColocated],
	)

	// Ctrl+C / Ctrl+X - Interrupt session (matching wui pattern at useSessionActions.ts:247-267)
	// Show warning toast if session is not in an interruptable state
	useAppHotkeys(
		'ctrl+c, ctrl+x',
		(e) => {
			e.preventDefault()
			const isRunning = session?.status === 'running'
			const isNeedsApproval = session?.status === 'needs_approval'
			const isTransitional = ['launching', 'interrupt_requested', 'waiting_for_agent', 'resuming'].includes(
				session?.status ?? '',
			)

			if (isRunning || isNeedsApproval) {
				// Session is running - interrupt it
				void handleInterrupt()
			} else if (isTransitional) {
				// Session is in a transitional state - show warning
				toast.warning('Session cannot be interrupted yet', {
					description: 'The session is currently transitioning. Please wait a moment.',
				})
			} else {
				// Session is not running at all - show warning
				toast.warning('Unable to interrupt session', {
					description: 'Only running sessions can be interrupted.',
				})
			}
		},
		{
			scopes: [HOTKEY_SCOPES.SESSION_DETAIL, HOTKEY_SCOPES.ARTIFACT_PANEL],
			enabled: canSendPrompt && !isModalOpen,
			enableOnFormTags: true,
			enableOnContentEditable: true,
		},
		[canSendPrompt, session?.status, handleInterrupt, isModalOpen],
	)

	// Cmd+Shift+Enter to proceed to next step — two-step state machine.
	// First press (out of viewport): scroll + focus the most-recent next-step row.
	// Second press (in viewport): open the draft launcher for that suggestion + dismiss.
	// No-op when no per-event next-step suggestions exist. Dismiss state only
	// affects the floating indicator's visibility, not the hotkey — the inline
	// next-step button remains usable after dismissal.
	useAppHotkeys(
		'mod+shift+enter',
		(e) => {
			e.preventDefault()
			// Sibling-session override remains the highest priority.
			if (siblingSessionId) {
				handleNavigateToSibling()
				return
			}
			// No per-event next-step suggestions → no-op (drops the zero-events branch per Q3).
			if (!lastNextStepEventId || !lastNextStepSuggestion) return

			if (lastNextStepEventInViewport) {
				// In viewport → open draft launcher + dismiss.
				handleRowProceedToNextStep(lastNextStepEventId, lastNextStepSuggestion)
				useDismissedNextStepStore.getState().dismiss(lastNextStepEventId)
			} else {
				// Out of viewport → scroll + focus. (Second press matches the in-viewport branch.)
				scrollToNextStepEvent(lastNextStepEventId)
			}
		},
		{
			scopes: [HOTKEY_SCOPES.SESSION_DETAIL, HOTKEY_SCOPES.ARTIFACT_PANEL],
			enabled: canSendPrompt && !isModalOpen && !isAutoAdvanceEnabled,
			enableOnFormTags: true,
			enableOnContentEditable: true,
		},
		[
			canSendPrompt,
			handleRowProceedToNextStep,
			siblingSessionId,
			handleNavigateToSibling,
			isModalOpen,
			isAutoAdvanceEnabled,
			lastNextStepEventId,
			lastNextStepEventInViewport,
			lastNextStepSuggestion,
			scrollToNextStepEvent,
		],
	)

	// Alt+Enter — iterate in new session
	useAppHotkeys(
		'alt+enter',
		(e) => {
			e.preventDefault()
			handleIterateInNewSession()
		},
		{
			scopes: [HOTKEY_SCOPES.SESSION_DETAIL, HOTKEY_SCOPES.ARTIFACT_PANEL],
			enabled:
				!!iterateSlashCommand &&
				session?.context_window_tokens != null &&
				session.context_window_tokens >= getContextWarningThreshold(session?.provider, session?.model) &&
				session?.status !== 'running' &&
				!['launching', 'interrupt_requested', 'waiting_for_agent', 'resuming'].includes(session?.status ?? ''),
			enableOnFormTags: true,
			enableOnContentEditable: true,
		},
		[
			iterateSlashCommand,
			session?.context_window_tokens,
			session?.provider,
			session?.model,
			session?.status,
			handleIterateInNewSession,
		],
	)

	// s / shift+s to close artifact viewer and return to sidebar. Includes the
	// panel review scope (like `f` below) so the keys keep working while a block
	// is hover- or keyboard-focused; the sidebar cycle registration yields to
	// these whenever an artifact is selected.
	useAppHotkeys(
		's',
		() => handleArtifactPanelClose(),
		{
			preventDefault: true,
			scopes: [
				HOTKEY_SCOPES.SESSION_DETAIL,
				HOTKEY_SCOPES.ARTIFACT_PANEL,
				HOTKEY_SCOPES.ARTIFACT_V2_PANEL_REVIEW,
			],
			enabled: !!selectedArtifactId && !isModalOpen,
		},
		[handleArtifactPanelClose, selectedArtifactId, isModalOpen],
	)
	useAppHotkeys(
		'shift+s',
		() => handleArtifactPanelClose(),
		{
			preventDefault: true,
			scopes: [
				HOTKEY_SCOPES.SESSION_DETAIL,
				HOTKEY_SCOPES.ARTIFACT_PANEL,
				HOTKEY_SCOPES.ARTIFACT_V2_PANEL_REVIEW,
			],
			enabled: !!selectedArtifactId && !isModalOpen,
		},
		[handleArtifactPanelClose, selectedArtifactId, isModalOpen],
	)

	// f to open fullscreen artifact viewer. Previewable artifacts (image / HTML / PDF)
	// open the content-only modal; markdown/text/code keep the comment-gutter overlay.
	useAppHotkeys(
		'f',
		(event) => {
			event.stopPropagation()
			if (selectedArtifact && isPreviewableFile(selectedArtifact.file_name ?? '')) openFullscreenModal()
			else toggleFullscreen()
		},
		{
			preventDefault: true,
			// Include the panel review scope: the V2 viewer's target boundary shadows the
			// panel/page scopes whenever a block is hover- or keyboard-focused (the
			// instant-verdict target). Without the review scope here, `f` would fall
			// silent almost any time the pointer sits over the document.
			scopes: [
				HOTKEY_SCOPES.SESSION_DETAIL,
				HOTKEY_SCOPES.ARTIFACT_PANEL,
				HOTKEY_SCOPES.ARTIFACT_V2_PANEL_REVIEW,
			],
			enabled: !!selectedArtifactId && !isModalOpen,
		},
		[selectedArtifactId, selectedArtifact, isModalOpen, openFullscreenModal, toggleFullscreen],
	)

	// Cmd+J - Toggle terminal panel (VS Code style, only for session owners on colocated hosts)
	useAppHotkeys(
		'mod+j',
		() => {
			if (isDesktop() && isColocated && canManageSession) {
				toggleTaskTerminal()
			}
		},
		{
			scopes: [HOTKEY_SCOPES.SESSION_DETAIL, HOTKEY_SCOPES.ARTIFACT_PANEL],
			enabled: !!session && canManageSession,
			preventDefault: true,
			enableOnFormTags: true,
			enableOnContentEditable: true,
		},
		[session, canManageSession, isColocated],
	)
}
