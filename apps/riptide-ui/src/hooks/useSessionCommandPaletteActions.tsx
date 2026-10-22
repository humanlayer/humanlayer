import { useCopyToClipboard } from '@uidotdev/usehooks'
import {
	Archive,
	CircleStop,
	Clipboard,
	Cpu,
	Folder,
	FolderOpen,
	FolderPlus,
	IterationCw,
	Link as LinkIcon,
	MessageSquareText,
	ShieldOff,
	SkipForward,
	Split,
	SquareSplitHorizontal,
	SquareSplitVertical,
	StepForward,
	Terminal,
	Users,
} from 'lucide-react'
import { type Dispatch, type SetStateAction, useCallback } from 'react'
import { toast } from 'sonner'

import type { useSessionAutoAdvance } from '@/hooks/session-detail/useSessionAutoAdvance'
import type { useSessionForkMode } from '@/hooks/session-detail/useSessionForkMode'
import type { useSessionHostStatus } from '@/hooks/session-detail/useSessionHostStatus'
import type { useSessionNextStep } from '@/hooks/session-detail/useSessionNextStep'
import type { useSessionPermissionControls } from '@/hooks/session-detail/useSessionPermissionControls'
import type { useSessionSendControls } from '@/hooks/session-detail/useSessionSendControls'
import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { useCommandPaletteAction } from '@/hooks/useCommandPaletteAction'
import { useKeybindingDisplays } from '@/hooks/useKeybindingDisplays'
import { useSelectedArtifactCommentActions } from '@/hooks/useSelectedArtifactCommentActions'
import { hotkeysCatalog } from '@/hotkeysCatalog'
import type { ArtifactViewerMode } from '@/lib/artifact-viewer-mode'
import { getContextWarningThreshold } from '@/lib/context-warning'
import { openWorkingDirectoryInEditor } from '@/lib/file-opener'
import { isDesktop } from '@/lib/utils'
import { copySessionDeepLink, copyTaskDeepLink } from '@/utils/sharing-links'

interface UseSessionCommandPaletteActionsParams {
	session:
		| {
				id: string
				task_id: string | null
				permissions_mode: string | null
				coding_agent_session_id: string | null
				status: string
				working_directory: string | null
				context_window_tokens: number | null
				provider: string | null
				model: string | null
		  }
		| null
		| undefined
	canManageSession: boolean
	canSendPrompt: boolean
	isReadyForInput: boolean
	toggleTaskTerminal: () => void
	onArchiveSession: () => void
	setIsTaskAssignmentOpen: (open: boolean) => void
	setModelSelectorOpen: Dispatch<SetStateAction<boolean>>
	host: ReturnType<typeof useSessionHostStatus>
	permissionControls: ReturnType<typeof useSessionPermissionControls>
	autoAdvance: ReturnType<typeof useSessionAutoAdvance>
	fork: ReturnType<typeof useSessionForkMode>
	sendControls: ReturnType<typeof useSessionSendControls>
	nextStep: ReturnType<typeof useSessionNextStep>
	onOpenMultiplayerPrompting: () => void
	commentDeliveryOwner: ArtifactViewerMode['commentDeliveryOwner']
}

export function useLegacyArtifactCommentCommandPaletteActions(
	commentDeliveryOwner: ArtifactViewerMode['commentDeliveryOwner'],
	enabled = true,
) {
	const commentActions = useSelectedArtifactCommentActions()
	const legacyOwnsDelivery = enabled && commentDeliveryOwner === 'legacy'

	useCommandPaletteAction({
		id: 'send-all-artifact-comments-to-agent',
		label: 'Send All Comments to Agent',
		icon: MessageSquareText,
		enabled: legacyOwnsDelivery && commentActions.canSendAll,
		onSelect: commentActions.sendAll,
	})

	useCommandPaletteAction({
		id: 'send-all-artifact-comments-to-agent-and-resolve',
		label: 'Send All Comments to Agent and Resolve',
		icon: MessageSquareText,
		enabled: legacyOwnsDelivery && commentActions.canSendAll,
		onSelect: commentActions.sendAllAndResolve,
	})
}

export function useSessionCommandPaletteActions({
	session,
	canManageSession,
	canSendPrompt,
	isReadyForInput,
	toggleTaskTerminal,
	onArchiveSession,
	setIsTaskAssignmentOpen,
	setModelSelectorOpen,
	host,
	permissionControls,
	autoAdvance,
	fork,
	sendControls,
	nextStep,
	onOpenMultiplayerPrompting,
	commentDeliveryOwner,
}: UseSessionCommandPaletteActionsParams) {
	const [, copyToClipboard] = useCopyToClipboard()
	const keybindingDisplays = useKeybindingDisplays()
	const { isColocated } = host
	const { handleBypassPermissions, handleAutoAcceptToggle } = permissionControls
	const {
		isAutoAdvanceEnabled,
		autoAdvanceConfig,
		iterateSlashCommand,
		handleAutoAdvanceToggle,
		handleIterateInNewSession,
	} = autoAdvance
	const { isForkMode, userMessageCount, handleEnterForkMode } = fork
	const { handleInterrupt } = sendControls
	const {
		siblingSessionId,
		handleNavigateToSibling,
		lastNextStepEventId,
		lastNextStepSuggestion,
		handleRowProceedToNextStep,
	} = nextStep

	useLegacyArtifactCommentCommandPaletteActions(commentDeliveryOwner, canSendPrompt)
	const handleCopyCodingAgentSessionId = useCallback(() => {
		if (!session?.coding_agent_session_id) return

		void copyToClipboard(session.coding_agent_session_id)
		toast.success('Coding agent session ID copied to clipboard')
	}, [copyToClipboard, session?.coding_agent_session_id])

	const sessionId = session?.id
	const taskId = session?.task_id
	const workingDirectory = session?.working_directory ?? null
	const handleCopySessionUrl = useCallback(() => {
		if (!sessionId) return
		void copySessionDeepLink(sessionId)
	}, [sessionId])
	const handleCopyTaskUrl = useCallback(() => {
		if (!taskId) return
		void copyTaskDeepLink(taskId)
	}, [taskId])

	const handleCopyWorkingDirectory = useCallback(() => {
		if (!workingDirectory) return
		void copyToClipboard(workingDirectory)
		toast.success('Working directory copied to clipboard')
	}, [copyToClipboard, workingDirectory])

	const handleOpenWorkingDirectoryInEditor = useCallback(() => {
		if (!workingDirectory) return
		openWorkingDirectoryInEditor(workingDirectory)
	}, [workingDirectory])

	const handleInterruptSelect = useCallback(() => void handleInterrupt(), [handleInterrupt])

	const diffStyle = useSettingsStore((s) => s.diffStyle)
	const handleToggleDiffStyle = useCallback(() => {
		const settings = useSettingsStore.getState()
		settings.setDiffStyle(settings.diffStyle === 'split' ? 'unified' : 'split')
	}, [])

	const handleOpenTaskAssignment = useCallback(() => setIsTaskAssignmentOpen(true), [setIsTaskAssignmentOpen])

	const handleToggleModelSelector = useCallback(() => setModelSelectorOpen((prev) => !prev), [setModelSelectorOpen])

	// Single-step version of the ⌘⇧↵ hotkey's two-step machine: palette selection
	// is explicit intent, so it opens the draft launcher (or the existing sibling
	// session) directly instead of scrolling the next-step row into view first.
	const handleProceedToNextStep = useCallback(() => {
		if (siblingSessionId) {
			handleNavigateToSibling()
			return
		}
		if (!lastNextStepEventId || !lastNextStepSuggestion) return
		handleRowProceedToNextStep(lastNextStepEventId, lastNextStepSuggestion)
	}, [
		siblingSessionId,
		handleNavigateToSibling,
		lastNextStepEventId,
		lastNextStepSuggestion,
		handleRowProceedToNextStep,
	])

	useCommandPaletteAction({
		id: 'multiplayer-prompting',
		label: 'Multiplayer Prompting',
		icon: Users,
		enabled: canManageSession && Boolean(session),
		onSelect: onOpenMultiplayerPrompting,
	})

	useCommandPaletteAction({
		id: 'toggle-terminal',
		label: 'Toggle Terminal',
		icon: Terminal,
		shortcut: hotkeysCatalog.desktopApp.shortcuts.toggleTerminal.display,
		enabled: isDesktop() && isColocated && canManageSession,
		onSelect: useCallback(() => toggleTaskTerminal(), [toggleTaskTerminal]),
	})

	useCommandPaletteAction({
		id: 'bypass-permissions',
		label: session?.permissions_mode === 'bypass' ? 'Disable Bypass Permissions' : 'Bypass Permissions',
		icon: ShieldOff,
		shortcut: hotkeysCatalog.sessionDetail.shortcuts.bypass.display,
		enabled: canSendPrompt,
		onSelect: handleBypassPermissions,
	})

	useCommandPaletteAction({
		id: 'auto-accept-edits',
		label: session?.permissions_mode === 'accept_edits' ? 'Disable Auto-Accept Edits' : 'Auto-Accept Edits',
		icon: ({ className }: { className?: string }) => <div className={className}>⏵⏵</div>,
		shortcut: hotkeysCatalog.sessionDetail.shortcuts.autoAccept.display,
		enabled: canSendPrompt,
		onSelect: handleAutoAcceptToggle,
	})

	useCommandPaletteAction({
		id: 'fork-session',
		label: 'Fork Session',
		icon: Split,
		shortcut: hotkeysCatalog.sessionDetail.shortcuts.fork.display,
		enabled: canManageSession && userMessageCount >= 2 && !isForkMode,
		onSelect: handleEnterForkMode,
	})

	useCommandPaletteAction({
		id: 'copy-coding-agent-session-id',
		label: 'Copy Coding Agent Session ID',
		icon: Clipboard,
		enabled: Boolean(session?.coding_agent_session_id),
		onSelect: handleCopyCodingAgentSessionId,
	})

	useCommandPaletteAction({
		id: 'copy-session-url',
		label: 'Copy Session URL',
		icon: LinkIcon,
		shortcut: hotkeysCatalog.sessionDetail.shortcuts.copyPrimaryUrl.display,
		enabled: Boolean(sessionId),
		onSelect: handleCopySessionUrl,
	})

	useCommandPaletteAction({
		id: 'copy-task-url',
		label: 'Copy Task URL',
		icon: LinkIcon,
		enabled: Boolean(taskId),
		onSelect: handleCopyTaskUrl,
	})

	useCommandPaletteAction({
		id: 'attach-file',
		label: 'Attach File',
		icon: FolderOpen,
		shortcut: hotkeysCatalog.sessionDetail.shortcuts.attachFile.display,
		enabled: canSendPrompt,
		onSelect: useCallback(() => {
			const fileInput = document.querySelector('input[type="file"][multiple]') as HTMLInputElement | null
			fileInput?.click()
		}, []),
	})

	useCommandPaletteAction({
		id: 'auto-advance',
		label: isAutoAdvanceEnabled
			? `Disable Auto-Advance to ${autoAdvanceConfig.nextStepName}`
			: `Auto-Advance to ${autoAdvanceConfig.nextStepName}`,
		icon: SkipForward,
		shortcut: hotkeysCatalog.sessionDetail.shortcuts.autoAdvance.display,
		enabled: autoAdvanceConfig.show && canManageSession,
		onSelect: handleAutoAdvanceToggle,
	})

	// Reuses the session-detail archive handler wired to the `e` hotkey
	// (useSessionArchiveAndTask.handleToggleArchive) so palette behavior — PTY
	// cleanup, undo toast, and post-archive navigation — stays identical to `e`.
	useCommandPaletteAction({
		id: 'archive-session',
		label: 'Archive Session',
		icon: Archive,
		shortcut: keybindingDisplays.archive,
		enabled: canManageSession,
		onSelect: onArchiveSession,
	})

	// Mirrors the Ctrl+C hotkey, but only enabled while the session is actually
	// interruptible — the hotkey shows warning toasts for other states instead.
	useCommandPaletteAction({
		id: 'interrupt-session',
		label: 'Interrupt Session',
		icon: CircleStop,
		shortcut: hotkeysCatalog.sessionDetail.shortcuts.interrupt.display,
		enabled:
			canSendPrompt &&
			(session?.status === 'running' ||
				session?.status === 'needs_approval' ||
				session?.status === 'waiting_for_usage_limit'),
		onSelect: handleInterruptSelect,
	})

	useCommandPaletteAction({
		id: 'proceed-to-next-step',
		label: 'Proceed to Next Step',
		icon: StepForward,
		shortcut: hotkeysCatalog.sessionDetail.shortcuts.proceedNext.display,
		enabled:
			canSendPrompt &&
			!isAutoAdvanceEnabled &&
			(Boolean(siblingSessionId) || Boolean(lastNextStepEventId && lastNextStepSuggestion)),
		onSelect: handleProceedToNextStep,
	})

	// Same gating as the ⌥↵ hotkey: only offered once the context window is past
	// the warning threshold, an iterate slash command exists, and the session isn't
	// running or transitioning.
	useCommandPaletteAction({
		id: 'iterate-in-new-session',
		label: 'Iterate in New Session',
		icon: IterationCw,
		shortcut: hotkeysCatalog.sessionDetail.shortcuts.iterate.display,
		enabled:
			canManageSession &&
			Boolean(iterateSlashCommand) &&
			session?.context_window_tokens != null &&
			session.context_window_tokens >= getContextWarningThreshold(session.provider, session.model) &&
			session.status !== 'running' &&
			!['launching', 'interrupt_requested', 'waiting_for_agent', 'resuming'].includes(session.status),
		onSelect: handleIterateInNewSession,
	})

	useCommandPaletteAction({
		id: 'switch-model',
		label: 'Switch Model',
		icon: Cpu,
		shortcut: hotkeysCatalog.sessionDetail.shortcuts.switchModel.display,
		enabled: canSendPrompt && isReadyForInput,
		onSelect: handleToggleModelSelector,
	})

	// Opens the same lightweight assignment dialog as the ⇧T hotkey.
	useCommandPaletteAction({
		id: 'add-session-to-task',
		label: 'Change task',
		icon: FolderPlus,
		shortcut: hotkeysCatalog.sessionDetail.shortcuts.addToTask.display,
		enabled: canManageSession && Boolean(session),
		onSelect: handleOpenTaskAssignment,
	})

	useCommandPaletteAction({
		id: 'copy-working-directory',
		label: 'Copy Working Directory',
		icon: Folder,
		enabled: Boolean(workingDirectory),
		onSelect: handleCopyWorkingDirectory,
	})

	useCommandPaletteAction({
		id: 'open-working-directory-in-editor',
		label: 'Open Working Directory in Editor',
		icon: FolderOpen,
		shortcut: hotkeysCatalog.desktopApp.shortcuts.openEditor.display,
		enabled: isDesktop() && isColocated && Boolean(workingDirectory),
		onSelect: handleOpenWorkingDirectoryInEditor,
	})

	// Same settings toggle as the diff-style button in SessionInfoBar.
	useCommandPaletteAction({
		id: 'toggle-diff-view',
		label: diffStyle === 'split' ? 'Switch to Unified Diff View' : 'Switch to Split Diff View',
		icon: diffStyle === 'split' ? SquareSplitVertical : SquareSplitHorizontal,
		shortcut: hotkeysCatalog.sessionDetail.shortcuts.toggleDiff.display,
		onSelect: handleToggleDiffStyle,
	})
}
