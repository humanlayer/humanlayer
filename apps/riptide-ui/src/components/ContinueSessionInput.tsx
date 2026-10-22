import { matchCodelayerAuthError } from '@humanlayer/ai/config'
import { type CodingAgent, isLaunchableCodingAgent } from '@humanlayer/schemas/coding-agent'
import type { SessionErrorReason } from '@humanlayer/schemas/effect/session/session-error-reason'
import type { ClaudeUsageLimits } from '@humanlayer/schemas/zod/host/usage-limits'
import {
	AttachFileButton,
	InterruptAndSendButton,
	InterruptButton,
	IterateInNewSessionButton,
	QueueSplitButton,
} from '@humanlayer/ui/components/action-buttons'
import { Button } from '@humanlayer/ui/components/button'
import { Checkbox } from '@humanlayer/ui/components/checkbox'
import { getCodingAgentLabel } from '@humanlayer/ui/components/coding-agent-badge'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@humanlayer/ui/components/dropdown-menu'
import { EffortSelector } from '@humanlayer/ui/components/effort-selector'
import { FastModeToggle } from '@humanlayer/ui/components/fast-mode-toggle'
import { KeyboardShortcut } from '@humanlayer/ui/components/keyboard-shortcut'
import {
	RichTextEditor,
	type RichTextEditorRef,
	type RichTextEditorBinding,
	type SlashCommand,
} from '@humanlayer/ui/components/rich-text-editor'
import { SessionActionButtons } from '@humanlayer/ui/components/session-action-buttons'
import { Tooltip, TooltipContent, TooltipTrigger } from '@humanlayer/ui/components/tooltip'
import { MODEL_OPTIONS, type ModelOption } from '@humanlayer/ui/constants/models'
import type { PermissionsMode, PermissionsModeNoBypass } from '@humanlayer/ui/constants/permission-modes'
import type { ProviderOption } from '@humanlayer/ui/constants/providers'
import type { CollaborationIdentity } from '@humanlayer/ui/lib/collaboration-colors'
import { dragCarriesFiles, readDroppedFiles } from '@humanlayer/ui/lib/dropped-files'
import { cn } from '@humanlayer/ui/lib/utils'
import { eq, useLiveQuery } from '@tanstack/react-db'
import { useNavigate } from '@tanstack/react-router'
import type { Content } from '@tiptap/core'
import { ArrowLeftRight, ArrowRight, Loader2, MessageCircleX, OctagonX, Pencil, Send, Split } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { uuidv7 } from 'uuidv7'

import { artifactCommentDeliveryTraySlotId } from '@/components/comment-delivery/tray-slot'
import { diffFeedbackDeliveryTraySlotId } from '@/components/diffs/delivery/tray-slot'
import { FastModeWarningDialog } from '@/components/FastModeWarningDialog'
import { FileMentionDropdown } from '@/components/FileMentionDropdown'
import { useSync } from '@/components/providers/SyncProvider'
import { HarnessHandoffDialog } from '@/components/session-detail/HarnessHandoffDialog'
import { useSessionDetail } from '@/components/session-detail/session-detail-context'
import { RESPONSE_SLASH_COMMANDS } from '@/constants/response-slash-commands'
import { useAgentSlashCommands } from '@/hooks/live-queries/use-agent-slash-commands'
import { useHostModelRegistry } from '@/hooks/live-queries/use-model-registry'
import { resolveCollaborationIdentities } from '@/hooks/session-detail/response-editor-presence'
import {
	useResponseEditorCollaboration,
	type SharedResponseOptions,
	type SharedResponseSnapshot,
} from '@/hooks/session-detail/use-response-editor-collaboration'
import { useHarnessHandoff } from '@/hooks/session-detail/useHarnessHandoff'
import { useApprovalStore } from '@/hooks/stores/approvalStore'
import { useCodingAgentSetupStore } from '@/hooks/stores/codingAgentSetupStore'
import { useDraftsStore } from '@/hooks/stores/draftsStore'
import { FOCUSED_AREAS } from '@/hooks/stores/focus-areas'
import { useFocusStore } from '@/hooks/stores/focusStore'
import { useSessionInputStore } from '@/hooks/stores/sessionInputStore'
import { useSessionUiStore } from '@/hooks/stores/sessionUiStore'
import { type ModelType, useSettingsStore } from '@/hooks/stores/settingsStore'
import { useCodingAgentSetupHost } from '@/hooks/use-coding-agent-setup-host'
import {
	createResponseEditorContentPort,
	getResponseEditorContentPort,
	type ResponseEditorSubmission,
} from '@/hooks/use-response-editor-content-port'
import { useApprovalActions } from '@/hooks/useApprovalActions'
import { useFastModeToggleGuard } from '@/hooks/useFastModeToggleGuard'
import { useFileMentionSuggestion } from '@/hooks/useFileMentionSuggestion'
import { useFileUpload } from '@/hooks/useFileUpload'
import { useIsNarrow } from '@/hooks/useIsNarrow'
import { useKeybindingDisplays } from '@/hooks/useKeybindingDisplays'
import { useMountEffect } from '@/hooks/useMountEffect'
import { useOrgMembers } from '@/hooks/useOrgMembers'
import { useSessionActions } from '@/hooks/useSessionActions'
import { useViewportFileDrop } from '@/hooks/useViewportFileDrop'
import { formatShortcut, shortcutKeycaps } from '@/hotkeysCatalog'
import type { ArtifactViewerMode } from '@/lib/artifact-viewer-mode'
import { copyAsyncTextToClipboard } from '@/lib/clipboard'
import { CLAUDE_SIGN_IN_VARIANT, getCodingAgentSetupTarget, type CodingAgentSetupHost } from '@/lib/coding-agent-setup'
import { getContextWarningThreshold, isContextWarningShown } from '@/lib/context-warning'
import { startDocumentRootScrollGuard } from '@/lib/document-root-scroll-guard'
import { resolvePermissionsModeForSelectedModel } from '@/lib/model-permissions'
import { BUNDLED_MODEL_REGISTRY, type ModelRegistry } from '@/lib/model-registry'
import { recordSendScrollDiagnostic } from '@/lib/send-scroll-diagnostics'
import { type SessionStatusHost, sessionStatusLabel } from '@/lib/session-status-label'
import { navigateToSettings } from '@/lib/settings-navigation'
import { getSessionErrorDisplayMessage, resolveSessionErrorReason } from '@/utils/session-error-messages'
import { sanitizeMessageText } from '@/utils/text-sanitization'
import { getTextFromContent } from '@/utils/tiptap-content'

import { ContextWarningBanner } from './ContextWarningBanner'
import { getContinueEditorAutoFocus } from './continue-editor-focus-policy'
import { shouldFocusComposerFromPointerTarget, shouldShowLaunchDaemonAction } from './continue-session-input-utils'
import { HostOfflineBadge } from './HostOfflineBadge'
import { HostReturningBadge } from './HostReturningBadge'
import { LaunchDaemonEntryPoint } from './launch-daemon/LaunchDaemonEntryPoint'
import { SendCommentsSplitButton } from './SendCommentsSplitButton'
import { MultiplayerPromptingControl } from './session-detail/MultiplayerPromptingControl'
import { ResponseEditorPresenceContext } from './session-detail/response-editor-presence-context'
import { getSessionStatusClass, type SessionStatus } from './session-table/types'
import { SessionCostBadge } from './SessionCostBadge'
import { TokenUsageBadge } from './TokenUsageBadge'
import { UsageLimitBadge } from './usage-limits/UsageLimitBadge'
import { UsageLimitNotice } from './usage-limits/UsageLimitNotice'
import { useUsageLimitNotice } from './usage-limits/use-usage-limit-notice'

const NARROW_BREAKPOINT_PX = 1100
const ITERATE_BUTTON_NARROW_BREAKPOINT_PX = 750
const ITERATE_BUTTON_ICON_ONLY_BREAKPOINT_PX = 570

function getContentMode(
	hasSharedResponse: boolean,
	isDenying: boolean,
	isForkMode: boolean,
): 'local' | 'denial' | 'fork' | 'shared' {
	if (!hasSharedResponse) return 'local'
	if (isDenying) return 'denial'
	if (isForkMode) return 'fork'
	return 'shared'
}

function getResponseEditorPlaceholder(isDenying: boolean, isForkMode: boolean, isFocused: boolean): string {
	if (isDenying) return 'Type your instructions here, then press Enter to deny with feedback...'
	if (isForkMode) return 'Enter your message to continue the conversation...'
	if (!isFocused) return 'ENTER to start typing...'
	return ''
}

function getSharedResponseStatusLabel(status: SharedResponseSnapshot['status']): string {
	switch (status) {
		case 'view-only':
			return 'Shared response · view only'
		case 'access-lost':
			return 'Shared response access lost'
		case 'reconnecting':
			return 'Reconnecting to shared response…'
		default:
			return 'Connecting to shared response…'
	}
}

function getFailedSessionMessage({
	displayErrorMessage,
	codelayerAuthRemediationLabel,
	canOpenCodelayerSetup,
	canOpenClaudeSignIn,
	isClaudeCodeSessionIdFailure,
	onOpenCodelayerSetup,
	onOpenClaudeSignIn,
	onOpenDiagnostics,
}: {
	displayErrorMessage: string | null | undefined
	codelayerAuthRemediationLabel: string | null
	canOpenCodelayerSetup: boolean
	canOpenClaudeSignIn: boolean
	isClaudeCodeSessionIdFailure: boolean
	onOpenCodelayerSetup: () => void
	onOpenClaudeSignIn: () => void
	onOpenDiagnostics: () => void
}): ReactNode {
	if (!displayErrorMessage) return null
	if (canOpenClaudeSignIn) {
		return (
			<Button
				variant="link"
				onClick={onOpenClaudeSignIn}
				className="font-mono text-xs text-[var(--terminal-error)] truncate hover:underline cursor-pointer h-auto p-0"
			>
				Claude needs you to sign in. Sign in to Claude
			</Button>
		)
	}
	if (codelayerAuthRemediationLabel && canOpenCodelayerSetup) {
		return (
			<Button
				variant="link"
				onClick={onOpenCodelayerSetup}
				className="font-mono text-xs text-[var(--terminal-error)] truncate hover:underline cursor-pointer h-auto p-0"
			>
				Codex needs {codelayerAuthRemediationLabel} auth. Set up Codex
			</Button>
		)
	}
	if (isClaudeCodeSessionIdFailure) {
		return <span className="font-mono text-xs text-[var(--terminal-error)] truncate">{displayErrorMessage}</span>
	}
	if (displayErrorMessage.toLowerCase().includes('could not locate the claude code binary')) {
		return (
			<Button
				variant="link"
				onClick={onOpenDiagnostics}
				className="font-mono text-xs uppercase tracking-wider text-[var(--terminal-error)] truncate hover:underline cursor-pointer h-auto p-0"
			>
				{displayErrorMessage}: Show Diagnostics
			</Button>
		)
	}
	return (
		<span className="font-mono text-xs uppercase tracking-wider text-[var(--terminal-error)] truncate">
			{displayErrorMessage}
		</span>
	)
}

// Set of valid model option values for fast lookup
const VALID_MODEL_VALUES = new Set<string>(MODEL_OPTIONS.map((o) => o.value))

/**
 * Convert verbose model string (e.g., 'claude-opus-4-5-20251101') to short display name.
 * Returns short name for known models, fallback to 'opus' for unknown.
 * Shorthand 'opus' always resolves to latest. Removed 1M variants for 4.7/4.8
 * (and bare opus) fold to their base picker entry; 4.6 keeps its 1M distinction.
 */
function resolveModelSlug(
	modelTag: string | null | undefined,
	provider?: ProviderOption | null,
	models: ModelRegistry = BUNDLED_MODEL_REGISTRY,
	codingAgent?: CodingAgent | null,
): ModelOption {
	if (!modelTag) return 'opus'
	const hostModel = models.hostModelFor({ agent: codingAgent, provider, model: modelTag })
	if (hostModel) return hostModel
	if (provider === 'codex' && (modelTag === 'gpt-5.3-codex' || modelTag === 'gpt-5.3-codex-spark')) {
		return 'gpt-5.5'
	}
	// If it's already a valid model option value, return it directly
	if (VALID_MODEL_VALUES.has(modelTag)) return modelTag
	if (provider === 'codex' && modelTag.startsWith('gpt-')) return 'gpt-5.5'
	// Legacy Anthropic model pattern matching
	if (modelTag.includes('sonnet-5-5') || modelTag.includes('sonnet_5_5')) return 'claude-sonnet-5-5'
	if (modelTag.includes('sonnet-5') || modelTag.includes('sonnet_5')) return 'claude-sonnet-5'
	if (modelTag.includes('sonnet') && (modelTag.includes('4-') || modelTag.includes('4_'))) {
		return 'claude-sonnet-4-6'
	}
	if (modelTag.includes('sonnet')) return 'claude-sonnet-5'
	if (modelTag.includes('haiku')) return 'claude-haiku-4-5-20251001'
	// Check specific versions BEFORE generic opus. Opus 5.5, Opus 5, and base 4.8/4.7 are 1M models,
	// so any [1m]/-1m suffix folds to the base entry.
	if (modelTag.includes('opus-5-5') || modelTag.includes('opus_5_5')) return 'claude-opus-5-5'
	if (modelTag.includes('opus-5') || modelTag.includes('opus_5')) return 'claude-opus-5'
	if (modelTag.includes('4-8') || modelTag.includes('4_8')) return 'claude-opus-4-8'
	// Check 4-5 BEFORE generic opus — 'claude-opus-4-5-20251101' must not match 4-6/4-7
	if (modelTag.includes('4-5') || modelTag.includes('4_5')) return 'claude-opus-4-5'
	// Check 4-7 BEFORE 4-6 — 'claude-opus-4-7' must not match 4-6
	if (modelTag.includes('4-7') || modelTag.includes('4_7')) return 'claude-opus-4-7'
	// Check 4-6 before generic opus — 4.6 keeps its 1M variant
	if (modelTag.includes('4-6') || modelTag.includes('4_6')) {
		if (modelTag.includes('[1m]') || modelTag.includes('-1m')) return 'claude-opus-4-6-1m'
		return 'claude-opus-4-6'
	}
	// Generic opus fallback to shorthand (latest); stale opus-1m / opus[1m] folds here too
	if (modelTag.includes('opus')) return 'opus'
	return 'opus'
}

function getCodelayerAuthRemediationLabel(
	codingAgent: ContinueSessionInputPureProps['codingAgent'],
	errorMessage: string | null | undefined,
): string | null {
	if (codingAgent !== 'codelayer') return null
	return matchCodelayerAuthError(errorMessage)
}

/**
 * Props for the pure presentation component (ContinueSessionInputPure).
 * This is the full set of props including hook-derived values that the wired
 * ContinueSessionInput resolves internally.
 */
export interface ContinueSessionInputPureProps {
	collaborationIdentities?: ReadonlyMap<string, CollaborationIdentity>
	/** Shared content is read for UI/serialization only, never mirrored to the private draft. */
	sharedResponse?: SharedResponseSnapshot & {
		binding: Extract<RichTextEditorBinding, { mode: 'collaborative' }>
		retry?: () => void
	}
	onSubmit: (params: {
		text: string
		model: ModelType
		permissionsMode: PermissionsMode
		sharedSubmission?: ResponseEditorSubmission
	}) => void
	onInterrupt?: (message?: string) => boolean | undefined
	onQueue?: (params: { text: string; sharedSubmission?: ResponseEditorSubmission }) => void
	forkContent?: Content | null
	onForkContentChange?: (content: Content | null) => void
	isSubmitting?: boolean
	disabled?: boolean
	/** Prompt-level controls are available to owners and active prompters. */
	canPrompt: boolean
	/** Structural controls remain owner-only. */
	canManageSession: boolean
	className?: string
	/** Extra items appended to the model selector menu (e.g. hand off to another agent). */
	children?: React.ReactNode
	/** Session ID - required for model persistence */
	sessionId: string
	// For tracking focus state externally
	onFocusChange: (focused: boolean) => void
	// Ref for external control (e.g., focusing via hotkey)
	editorRef?: React.RefObject<RichTextEditorRef | null>
	// Session permission state (controlled mode)
	permissionsMode?: PermissionsMode
	// Callbacks for permission toggles (controlled mode)
	onToggleBypass?: () => void
	onPermissionModeChange?: (mode: PermissionsModeNoBypass) => void
	// Auto-advance state (optional)
	showAutoAdvance?: boolean
	autoAdvanceEnabled?: boolean
	autoAdvanceNextStepName?: string
	onToggleAutoAdvance?: () => void
	// Archive state (controlled mode)
	isArchived?: boolean
	sessionStatus?: string
	onToggleArchive?: () => void
	// Fork state (optional)
	showFork?: boolean
	onFork?: () => void
	forkDisabled?: boolean
	/** Whether fork mode is active — changes status bar and submit button */
	isForkMode?: boolean
	/** Archive current session when forking */
	archiveOnFork?: boolean
	/** Toggle archive on fork */
	onArchiveOnForkChange?: (value: boolean) => void
	/** Confirm fork (submits with text from editor) */
	onForkConfirm?: (text: string) => void
	/** Cancel fork mode */
	onForkCancel?: () => void
	/** Preview of the message being forked from */
	forkedFromMessage?: string | null
	// Controlled model selector state (optional)
	modelSelectorOpen?: boolean
	onModelSelectorOpenChange?: (open: boolean) => void
	// Token usage props
	contextWindowTokens?: number | null
	contextWindowLimit?: number | null
	model?: string | null
	/** Model the agent actually ran (from its init event) — may differ from the selected alias */
	resolvedModel?: string | null
	// Session cost props
	totalCostUsd?: number | null
	modelUsage?:
		| Record<
				string,
				{
					input_tokens: number
					output_tokens: number
					cache_read_input_tokens?: number
					cache_creation_input_tokens?: number
				}
		  >
		| string
		| null
	// Error message for failed sessions
	errorMessage?: string | null
	// Typed failure classification set by the daemon; drives sign-in and start-failed affordances
	errorReason?: SessionErrorReason | null
	// Host offline state
	isHostOffline?: boolean
	isHostStarting?: boolean
	isHostUpdating?: boolean
	hostName?: string | null
	statusHost?: SessionStatusHost | null
	/** Claude usage windows of the session's host, as last reported by its daemon. */
	hostUsageLimits?: ClaudeUsageLimits | null
	canLaunchLocalDaemon?: boolean
	onLaunchDaemon?: () => void
	// Denial mode - for approval rejection feedback
	isDenying?: boolean
	denyingToolName?: string
	onCancelDeny?: () => void
	onSubmitDeny?: (message: string) => void
	isDenySubmitting?: boolean
	/** Called when deny feedback content changes (syncs text to approval store for inline DENY button) */
	onDenyContentChange?: (text: string | null) => void
	/** Imperative handle ref for external control */
	denyRef?: React.Ref<ContinueSessionInputDenyHandle>
	/** Whether there are pending approvals - allows Cmd+Enter to enter denying mode with empty editor */
	hasPendingApprovals?: boolean
	/** Iterate slash command for the current workflow phase (null = not a workflow session or no iterate variant) */
	iterateSlashCommand?: string | null
	/** Callback when user triggers "Continue in New Session" */
	onIterateInNewSession?: () => void
	/** Number of files currently uploading — disables submit and shows indicator */
	pendingUploadCount?: number
	/** Disable editing for failed sessions that cannot be resumed. */
	responseEditorDisabled?: boolean
	// Hook-derived values (resolved by wired ContinueSessionInput, passed directly in Storybook)
	/** Task ID for file upload and mentions — resolved from session via useLiveQuery in wired version */
	taskId?: string | null
	/** Task slug for file upload path — resolved from task via useLiveQuery in wired version */
	taskSlug?: string | null
	/** Working directory for file mention suggestions */
	workingDirectory?: string | null
	slashCommands?: SlashCommand[]
	/** Coding agent for this session (claude or codelayer) */
	codingAgent?: CodingAgent
	/** Provider for model filtering (anthropic, copilot, etc.) */
	provider?: ProviderOption | null
	/** Daemon host used to open a provider-specific setup notice from auth-error recovery. */
	setupHost?: CodingAgentSetupHost | null
	/** What the session's host can run; the bundled registry answers when no host is in scope. */
	models?: ModelRegistry
	/** Upload files callback — from useFileUpload in wired version */
	uploadFiles?: (files: File[]) => void
	/** Persist model change — from useSessionActions in wired version */
	updateSessionModel: (params: { sessionId: string; model: string }) => void
	/** Current effort level (null/undefined = none) */
	effort?: string | null
	/** Current Fast Mode flag */
	fastMode?: boolean | null
	/** Persist effort change — from useSessionActions in wired version */
	updateSessionEffort: (params: { sessionId: string; effort: string | null }) => void
	/** Persist Fast Mode change — from useSessionActions in wired version */
	updateSessionFastMode: (params: { sessionId: string; fastMode: boolean | null }) => void
	/** Whether to show session cost badge — from useSettingsStore in wired version */
	showSessionCosts?: boolean
	/** Whether to show the context window warning — from useSettingsStore in wired version */
	showContextWarning?: boolean
	/** Composer icon-row slot for Multiplayer Prompting discovery and status. */
	multiplayerPromptingControl: React.ReactElement
	/** Comment format that owns delivery for the selected artifact surface. */
	commentDeliveryOwner?: ArtifactViewerMode['commentDeliveryOwner']
}

/** Imperative handle for controlling deny submit from external components */
export interface ContinueSessionInputDenyHandle {
	/** Triggers deny submit with current content - use for inline DENY button clicks */
	submitDeny: () => void
}

function useContinueResponseBinding(
	sessionId: string,
	sharedResponse: ContinueSessionInputPureProps['sharedResponse'],
	canPrompt: boolean,
	isDenying: boolean,
	isForkMode: boolean,
	forkContent: Content | null,
	onForkContentChange?: (content: Content | null) => void,
) {
	const privateContent = useDraftsStore((s) => s.drafts[sessionId] ?? null)
	const denyContent = useApprovalStore((s) => s.denyContent)
	const privateMode = sharedResponse && (isDenying || isForkMode)
	const setContent = useCallback(
		(next: Content | null) => {
			if (sharedResponse && isDenying) return useApprovalStore.getState().setDenyContent(next)
			if (sharedResponse && isForkMode) return onForkContentChange?.(next)
			if (sharedResponse) return
			if (next == null) useDraftsStore.getState().clearDraft(sessionId)
			else useDraftsStore.getState().setDraft(sessionId, next)
		},
		[sessionId, sharedResponse, isDenying, isForkMode, onForkContentChange],
	)
	const content = privateMode
		? isDenying
			? denyContent
			: forkContent
		: sharedResponse
			? sharedResponse.content
			: privateContent
	const binding: RichTextEditorBinding =
		!privateMode && sharedResponse
			? sharedResponse.binding
			: {
					mode: 'local',
					value: content,
					onChange: setContent,
				}
	const sharedWritable = !!privateMode || !sharedResponse || sharedResponse.status === 'connected'
	return {
		privateContent,
		content,
		sharedWritable,
		canEditPrompt: canPrompt && sharedWritable,
		binding,
		setContent,
	}
}

function isContinueSubmissionDisabled(input: {
	canPrompt: boolean
	sharedWritable: boolean
	disabled: boolean
	isSubmitting: boolean
	isHostOffline: boolean
	pendingUploadCount: number
	hasText: boolean
	isRunning: boolean
	hasPendingApprovals: boolean
}) {
	if (
		!input.canPrompt ||
		!input.sharedWritable ||
		input.disabled ||
		input.isSubmitting ||
		input.isHostOffline ||
		input.pendingUploadCount > 0
	)
		return true
	return !input.isRunning && !input.hasText && !input.hasPendingApprovals
}

export function ContinueSessionInputPure({
	sharedResponse,
	onSubmit,
	onInterrupt,
	onQueue,
	isSubmitting = false,
	disabled = false,
	canPrompt,
	canManageSession,
	className,
	children,
	sessionId,
	onFocusChange,
	editorRef: externalEditorRef,
	permissionsMode,
	onToggleBypass,
	onPermissionModeChange,
	showAutoAdvance,
	autoAdvanceEnabled,
	autoAdvanceNextStepName,
	onToggleAutoAdvance,
	isArchived,
	sessionStatus,
	onToggleArchive,
	showFork,
	onFork,
	forkDisabled,
	isForkMode = false,
	forkContent = null,
	onForkContentChange,
	archiveOnFork = false,
	onArchiveOnForkChange,
	onForkConfirm,
	onForkCancel,
	forkedFromMessage,
	modelSelectorOpen: controlledModelSelectorOpen,
	onModelSelectorOpenChange,
	contextWindowTokens,
	contextWindowLimit,
	model: sessionModel,
	resolvedModel,
	totalCostUsd,
	modelUsage,
	errorMessage,
	errorReason,
	isHostOffline = false,
	isHostStarting = false,
	isHostUpdating = false,
	hostName,
	statusHost,
	hostUsageLimits,
	canLaunchLocalDaemon = false,
	onLaunchDaemon,
	isDenying = false,
	denyingToolName: _denyingToolName,
	onCancelDeny,
	onSubmitDeny,
	isDenySubmitting = false,
	onDenyContentChange,
	denyRef,
	hasPendingApprovals = false,
	iterateSlashCommand,
	onIterateInNewSession,
	pendingUploadCount = 0,
	responseEditorDisabled = false,
	taskId = null,
	taskSlug = null,
	workingDirectory = null,
	slashCommands = RESPONSE_SLASH_COMMANDS,
	codingAgent,
	provider,
	setupHost = null,
	models = BUNDLED_MODEL_REGISTRY,
	uploadFiles: uploadFilesProp,
	updateSessionModel: updateSessionModelProp,
	effort: sessionEffort,
	fastMode: sessionFastMode,
	updateSessionEffort: updateSessionEffortProp,
	updateSessionFastMode: updateSessionFastModeProp,
	showSessionCosts = false,
	showContextWarning = true,
	multiplayerPromptingControl,
	commentDeliveryOwner = 'none',
}: ContinueSessionInputPureProps) {
	const navigate = useNavigate()
	// Device-level Send-message binding: chooses the editor submit gesture and the hint keycaps.
	const sendMessageKeybinding = useSettingsStore((state) => state.sendMessageKeybinding)
	const keybindingDisplays = useKeybindingDisplays()
	const editorRef = useRef<RichTextEditorRef>(null)
	useImperativeHandle(externalEditorRef, () => {
		if (!editorRef.current) throw new Error('Response editor ref was not initialized')
		return editorRef.current
	})
	const composerWrapperRef = useRef<HTMLDivElement>(null)
	const isNarrow = useIsNarrow(composerWrapperRef, NARROW_BREAKPOINT_PX)
	const isIterateButtonNarrow = useIsNarrow(composerWrapperRef, ITERATE_BUTTON_NARROW_BREAKPOINT_PX)
	const isIterateButtonIconOnly = useIsNarrow(composerWrapperRef, ITERATE_BUTTON_ICON_ONLY_BREAKPOINT_PX)

	const {
		fileMentionSuggestion,
		fileMentionOpen,
		fileMentionPosition,
		fileMentionQuery,
		fileMentionDropdownRef,
		commandAndClose,
		continueQuery,
	} = useFileMentionSuggestion(canPrompt && !isHostOffline)

	const uploadFiles = uploadFilesProp ?? ((_files: File[]) => {})

	// Drag-and-drop state and handlers
	const [isDragging, setIsDragging] = useState(false)
	const dragCounterRef = useRef(0)

	const handleDragEnter = useCallback(
		(e: React.DragEvent) => {
			e.preventDefault()
			e.stopPropagation()
			dragCounterRef.current += 1
			if (canPrompt && !isHostOffline && taskId && taskSlug && dragCarriesFiles(e.dataTransfer)) {
				setIsDragging(true)
			}
		},
		[canPrompt, isHostOffline, taskId, taskSlug],
	)

	const handleDragLeave = useCallback((e: React.DragEvent) => {
		e.preventDefault()
		e.stopPropagation()
		dragCounterRef.current -= 1
		if (dragCounterRef.current === 0) {
			setIsDragging(false)
		}
	}, [])

	const handleDragOver = useCallback((e: React.DragEvent) => {
		e.preventDefault()
		e.stopPropagation()
	}, [])

	const handleDrop = useCallback(
		(e: React.DragEvent) => {
			e.preventDefault()
			e.stopPropagation()
			dragCounterRef.current = 0
			setIsDragging(false)
			if (!canPrompt || isHostOffline || !taskId || !taskSlug) return
			// Reads dataTransfer before yielding; the event's data is gone after that.
			void readDroppedFiles(e.dataTransfer).then((files) => {
				if (files.length > 0) uploadFiles(files)
			})
		},
		[canPrompt, isHostOffline, uploadFiles, taskId, taskSlug],
	)

	const { privateContent, content, sharedWritable, canEditPrompt, binding, setContent } = useContinueResponseBinding(
		sessionId,
		sharedResponse,
		canPrompt,
		isDenying,
		isForkMode,
		forkContent,
		onForkContentChange,
	)
	const contentMode = getContentMode(Boolean(sharedResponse), isDenying, isForkMode)
	const bindEditor = useCallback(
		(handle: RichTextEditorRef | null) => {
			editorRef.current = handle
			if (!handle?.editor) return
			const port = createResponseEditorContentPort({
				editor: handle.editor,
				mode: contentMode,
				canClear: canEditPrompt,
				sharedDocument: sharedResponse?.binding.document,
				canInsert:
					canEditPrompt && !isHostOffline && !isSubmitting && !isDenySubmitting && !responseEditorDisabled,
			})
			return () => {
				port.dispose()
				if (editorRef.current === handle) editorRef.current = null
			}
		},
		[
			editorRef,
			contentMode,
			canEditPrompt,
			isHostOffline,
			isSubmitting,
			isDenySubmitting,
			responseEditorDisabled,
			sharedResponse?.binding.document,
		],
	)
	const captureResponseSubmission = (): { text: string; sharedSubmission?: ResponseEditorSubmission } => {
		const port = getResponseEditorContentPort(editorRef.current?.editor)
		const submission = port?.beginSubmission()
		const captured: { text: string; sharedSubmission?: ResponseEditorSubmission } = {
			text: port?.mode === 'shared' ? port.serialize() : sanitizeMessageText(getTextFromContent(content)).trim(),
		}
		if (port?.mode === 'shared') captured.sharedSubmission = submission
		return captured
	}
	const clearComposer = useCallback(() => {
		if (sharedResponse && !isDenying && !isForkMode) return
		startDocumentRootScrollGuard()
		editorRef.current?.blurImmediately()
		setContent(null)
	}, [editorRef, setContent, sharedResponse, isDenying, isForkMode])
	const [isFocused, setIsFocused] = useState(false)
	const hideContextWarning = useSettingsStore((state) => state.hideContextWarning)

	// Register append handler with sessionInputStore for SendCommentsSplitButton
	useEffect(() => {
		const handler = (text: string) => {
			getResponseEditorContentPort(editorRef.current?.editor)?.insert(`\n\n${text}`, 'end')
		}
		useSessionInputStore.getState().setAppendHandler(handler)
		return () => useSessionInputStore.getState().setAppendHandler(null)
	}, [editorRef])

	// Determine session state (matching wui ActiveSessionInput.tsx pattern)
	const isWaitingForUsageLimit = sessionStatus === 'waiting_for_usage_limit'
	const isRunning = sessionStatus === 'running' || isWaitingForUsageLimit
	const isTransitional = ['launching', 'interrupt_requested', 'waiting_for_agent', 'resuming'].includes(
		sessionStatus ?? '',
	)
	const isNeedsApproval = sessionStatus === 'needs_approval'
	const usageLimitNotice = useUsageLimitNotice({
		hostUsageLimits,
		model: sessionModel,
		resolvedModel,
		isParked: isWaitingForUsageLimit,
		suppressed: isDenying,
	})
	const showLaunchDaemonAction = shouldShowLaunchDaemonAction({
		isHostOffline,
		canLaunchLocalDaemon: canManageSession && canLaunchLocalDaemon,
		onLaunchDaemon,
	})
	const launchDaemonAction =
		showLaunchDaemonAction && onLaunchDaemon ? (
			<LaunchDaemonEntryPoint onClick={onLaunchDaemon} variant="outline" className="h-6 px-2 text-[10px]" />
		) : null

	// Model-aware context-window warning threshold (200k for 1M/codex, else 100k).
	const contextWarningThreshold = getContextWarningThreshold(provider, sessionModel)

	// Derived: should we show the iterate button?
	const showIterateButton =
		!!iterateSlashCommand &&
		contextWindowTokens != null &&
		contextWindowTokens >= contextWarningThreshold &&
		!isRunning &&
		!isTransitional

	// Derive display model from session's model prop (no local state needed)
	const model = resolveModelSlug(sessionModel, provider, models, codingAgent)
	const modelCapabilities = models.capabilitiesOf({ agent: codingAgent, provider, model })
	const canUseFiles = canEditPrompt && !isHostOffline

	// A file may also be dropped anywhere in the viewport, not just on the box.
	useViewportFileDrop(canUseFiles && taskId && taskSlug ? uploadFiles : null)

	// A session the daemon doesn't run (pi, opencode) picks its model in its own terminal.
	const isAgentSettingsLocked = codingAgent != null && !isLaunchableCodingAgent(codingAgent)

	// Effort + Fast Mode capability gating (mirrors DraftLauncher)
	const effortCapability = modelCapabilities.effort
	const fastModeCapability = modelCapabilities.fastMode
	const isEffortDisabled = !canEditPrompt || isAgentSettingsLocked || sessionStatus === 'interrupt_requested'
	const isFastModeDisabled = !canEditPrompt || isAgentSettingsLocked || sessionStatus === 'interrupt_requested'

	// Handle model change - persist to database via optimistic action.
	// Changing model can invalidate the current effort/fastMode, so reset
	// those in the same event when the new model doesn't support them.
	const handleModelChange = (newModel: ModelType) => {
		if (!canEditPrompt || isAgentSettingsLocked) return
		updateSessionModelProp({ sessionId, model: newModel })
		const nextModel = resolveModelSlug(newModel, provider, models, codingAgent)
		const nextCapabilities = models.capabilitiesOf({ agent: codingAgent, provider, model: nextModel })
		if (!nextCapabilities.effort.supported && sessionEffort != null) {
			updateSessionEffortProp({ sessionId, effort: null })
		}
		if (!nextCapabilities.fastMode.supported && sessionFastMode) {
			updateSessionFastModeProp({ sessionId, fastMode: false })
		}

		const permissionResult = resolvePermissionsModeForSelectedModel({
			model: nextModel,
			currentPermissionsMode: permissionsMode ?? 'default',
			autoMode: nextCapabilities.autoMode,
		})
		if (permissionResult.changed && permissionResult.nextPermissionsMode !== 'bypass') {
			onPermissionModeChange?.(permissionResult.nextPermissionsMode)
		}
	}

	const [effortSelectorOpen, setEffortSelectorOpen] = useState(false)

	const handleEffortChange = (next: string) => {
		if (!canEditPrompt) return
		updateSessionEffortProp({ sessionId, effort: next })
	}

	const handleFastModeCommit = useCallback(
		(next: boolean) => {
			if (!canEditPrompt) return
			updateSessionFastModeProp({ sessionId, fastMode: next })
		},
		[canEditPrompt, updateSessionFastModeProp, sessionId],
	)

	const {
		onToggle: handleFastModeToggle,
		pendingEnable: fastModePendingEnable,
		setPendingEnable: setFastModePendingEnable,
		confirm: confirmFastMode,
	} = useFastModeToggleGuard(handleFastModeCommit)

	// Model selector should only be disabled during interrupt_requested (transitional state)
	// It remains available during running, ready_for_input, needs_approval, etc.
	const isModelSelectorDisabled = !canEditPrompt || isAgentSettingsLocked || sessionStatus === 'interrupt_requested'

	// Filter models by provider for codelayer sessions, or show all anthropic models for claude sessions
	// Note: Claude Code only works with anthropic models; codelayer defaults to anthropic (provider selection not yet implemented)
	const filteredModels = models.optionsFor({ agent: codingAgent, provider })

	// Model selector state - use controlled mode if props provided
	const isModelSelectorControlled = controlledModelSelectorOpen !== undefined
	const [internalModelSelectorOpen, setInternalModelSelectorOpen] = useState(false)

	const requestedModelSelectorOpen = isModelSelectorControlled
		? controlledModelSelectorOpen
		: internalModelSelectorOpen
	const modelSelectorOpen = canEditPrompt && requestedModelSelectorOpen
	const setModelSelectorOpen = isModelSelectorControlled
		? (open: boolean) => onModelSelectorOpenChange?.(open)
		: setInternalModelSelectorOpen
	const [isModelTooltipOpen, setIsModelTooltipOpen] = useState(false)

	// Permissions state - use controlled mode if props provided, otherwise internal state
	const isControlled = permissionsMode !== undefined
	const [internalBypassEnabled, setInternalBypassEnabled] = useState(false)
	const [internalAutoAcceptEnabled, setInternalAutoAcceptEnabled] = useState(false)

	// Derive bypass/autoAccept from controlled permissionsMode or internal state
	const bypassEnabled = isControlled ? permissionsMode === 'bypass' : internalBypassEnabled
	const autoAcceptEnabled = isControlled ? permissionsMode === 'accept_edits' : internalAutoAcceptEnabled

	const text = sanitizeMessageText(getTextFromContent(content))
	const hasText = !!text.trim()

	// Notify parent when deny content changes (for inline DENY button state)
	useEffect(() => {
		if (!sharedResponse && isDenying && onDenyContentChange) {
			onDenyContentChange(hasText ? text.trim() : null)
		}
	}, [isDenying, hasText, text, onDenyContentChange, sharedResponse])

	// Clear editor when denial mode ends (covers inline DENY button and cancel)
	const wasDenyingRef = useRef(isDenying)
	useEffect(() => {
		if (!sharedResponse && wasDenyingRef.current && !isDenying) {
			setContent(null)
		}
		wasDenyingRef.current = isDenying
	}, [isDenying, setContent, sharedResponse])

	// Can edit while waiting, but can only submit when ready
	// Allow submit with empty text when hasPendingApprovals so Cmd+Enter can enter denying mode
	const submitDisabled = isContinueSubmissionDisabled({
		canPrompt,
		sharedWritable,
		disabled,
		isSubmitting,
		isHostOffline,
		pendingUploadCount,
		hasText,
		isRunning,
		hasPendingApprovals,
	})

	// Derive permissionsMode from toggle state
	const getPermissionsMode = (): PermissionsMode => {
		// In controlled mode, use the prop value directly
		if (isControlled && permissionsMode !== undefined) return permissionsMode
		if (bypassEnabled) return 'bypass'
		if (autoAcceptEnabled) return 'accept_edits'
		return 'default'
	}

	// Determine button variant (matching wui pattern at line 471-477)
	// Destructive when running with empty prompt, default otherwise
	let submitButtonVariant: 'default' | 'destructive' = 'default'
	if (isRunning && !hasText) {
		submitButtonVariant = 'destructive'
	}

	// Determine keyboard shortcut to display (matching wui pattern at line 469)
	const submitKey = formatShortcut(keybindingDisplays.sendMessage)
	const sendKey = isRunning && !hasText ? 'Ctrl+C' : submitKey
	const forkKey = submitKey

	// Get button text (matching wui getSendButtonText pattern at line 118-142)
	const getButtonText = () => {
		if (isSubmitting) return 'Sending...'
		if (isTransitional) return 'Waiting...'

		if (isArchived && isRunning) {
			return hasText ? 'Interrupt & Unarchive' : 'Interrupt & Unarchive'
		}
		if (isArchived) return 'Send & Unarchive'

		if (isRunning && !hasText) return 'Interrupt'
		if (isRunning && hasText && !onQueue) return 'Interrupt & Send'
		if (isRunning && hasText && onQueue) return 'Queue'

		return 'Send'
	}

	const handleSubmit = (): boolean => {
		if (submitDisabled) return false
		const submission = captureResponseSubmission()
		recordSendScrollDiagnostic('composer_submit_entered')
		onSubmit({
			...submission,
			model,
			permissionsMode: getPermissionsMode(),
		})
		recordSendScrollDiagnostic('composer_submit_returned')
		startDocumentRootScrollGuard()
		recordSendScrollDiagnostic('root_scroll_guard_started')
		// Clear content after submit, but NOT when entering denying mode
		// (hasPendingApprovals means we're transitioning to deny mode, not sending)
		if (!hasPendingApprovals && !sharedResponse) {
			recordSendScrollDiagnostic('editor_immediate_blur_requested')
			editorRef.current?.blurImmediately()
			recordSendScrollDiagnostic('editor_immediate_blur_returned')
			setContent(null)
			recordSendScrollDiagnostic('composer_draft_clear_requested')
		}
		return true
	}

	// Handle submit/interrupt action
	const handleSubmitOrInterrupt = () => {
		if (!canEditPrompt || isHostOffline) return
		if (isRunning || (isNeedsApproval && !hasText)) {
			// Queue flow (primary action when onQueue is provided and there's text)
			if (hasText && onQueue) {
				onQueue(captureResponseSubmission())
				clearComposer()
			} else {
				// Interrupt flow
				if (!onInterrupt) return
				if (hasText) {
					const result = onInterrupt(text.trim())
					if (result !== false) {
						clearComposer()
					}
				} else {
					onInterrupt()
				}
			}
		} else {
			// Normal submit flow
			const submitted = handleSubmit()
			if (submitted && !hasPendingApprovals) return
		}
		recordSendScrollDiagnostic('editor_blur_requested')
		// Blur the editor so hotkeys are immediately available
		editorRef.current?.blur()
		recordSendScrollDiagnostic('editor_blur_returned')
	}

	// Handle interrupt & send (secondary action when onQueue is present)
	const handleInterruptAndSend = useCallback(() => {
		if (!canEditPrompt || isHostOffline || !onInterrupt) return
		const result = onInterrupt(text.trim())
		if (result !== false) {
			clearComposer()
		}
		editorRef.current?.blur()
	}, [canEditPrompt, isHostOffline, onInterrupt, text, clearComposer, editorRef])

	const handleForkSubmit = () => {
		if (!canManageSession || !canEditPrompt || !onForkConfirm || !hasText) return
		onForkConfirm(text.trim())
		clearComposer()
		editorRef.current?.blur()
	}

	const handleFocus = () => {
		recordSendScrollDiagnostic('editor_focus_event')
		setIsFocused(true)
		onFocusChange(true)
	}

	const handleBlur = () => {
		recordSendScrollDiagnostic('editor_blur_event')
		setIsFocused(false)
		onFocusChange(false)
	}

	// In fork mode, first ESC cancels fork; second ESC (after cancel) blurs normally
	const handleEscape = useCallback(() => {
		if (isForkMode && onForkCancel) {
			onForkCancel()
			return true // prevent blur
		}
		useFocusStore.getState().focusMain()
		return false
	}, [isForkMode, onForkCancel])

	const handleComposerPointerDown = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			if (!shouldFocusComposerFromPointerTarget(event.target)) return
			editorRef.current?.focus()
		},
		[editorRef],
	)

	const handleToggleBypass = () => {
		if (!canEditPrompt) return
		if (isControlled && onToggleBypass) {
			onToggleBypass()
		} else {
			setInternalBypassEnabled(!internalBypassEnabled)
			if (!internalBypassEnabled) {
				setInternalAutoAcceptEnabled(false)
			}
		}
	}

	// Determine border color based on mode
	const getBorderColor = () => {
		if (isDenying) {
			return isFocused ? 'border-[var(--terminal-error)]' : 'border-[var(--terminal-error)]/50'
		}
		if (isForkMode) {
			return 'border-[var(--terminal-accent)]'
		}
		return isFocused ? 'border-[var(--terminal-accent)]' : 'border-transparent'
	}

	// Handle deny submit
	const handleDenySubmit = () => {
		if (!canEditPrompt || isHostOffline || !hasText || isDenySubmitting || !onSubmitDeny) return
		onSubmitDeny(text.trim())
		clearComposer()
		// Blur the editor so hotkeys are immediately available
		editorRef.current?.blur()
	}

	// Expose deny submit for external control (inline DENY button)
	useImperativeHandle(denyRef, () => ({
		submitDeny: handleDenySubmit,
	}))

	// Ctrl+Enter triggers "Interrupt & Send" when onQueue is present
	const handleContainerKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (
				canEditPrompt &&
				!isHostOffline &&
				e.ctrlKey &&
				!e.metaKey &&
				e.key === 'Enter' &&
				isRunning &&
				hasText &&
				onQueue &&
				onInterrupt
			) {
				e.preventDefault()
				e.stopPropagation()
				handleInterruptAndSend()
			}
		},
		[canEditPrompt, isHostOffline, isRunning, hasText, onQueue, onInterrupt, handleInterruptAndSend],
	)

	const handleSelectorTriggerKeyDown = useCallback((e: React.KeyboardEvent<HTMLButtonElement>) => {
		if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(e.key)) {
			e.stopPropagation()
		}
	}, [])

	const handleModelSelectorOpenChange = useCallback(
		(open: boolean) => {
			if (open && (!canEditPrompt || isAgentSettingsLocked)) return
			if (open) {
				setIsModelTooltipOpen(false)
			}
			setModelSelectorOpen(open)
		},
		[canEditPrompt, isAgentSettingsLocked, setModelSelectorOpen],
	)

	const handleModelTooltipOpenChange = useCallback(
		(open: boolean) => {
			setIsModelTooltipOpen(modelSelectorOpen ? false : open)
		},
		[modelSelectorOpen],
	)

	const isModelTooltipVisible = !modelSelectorOpen && isModelTooltipOpen
	const codelayerAuthRemediationLabel = getCodelayerAuthRemediationLabel(codingAgent, errorMessage)
	const codelayerSetupTarget = getCodingAgentSetupTarget({ agent: codingAgent, provider, host: setupHost })
	const claudeSignInTarget =
		setupHost && errorReason === 'auth_required' ? { variant: CLAUDE_SIGN_IN_VARIANT, host: setupHost } : null
	const isClaudeCodeSessionIdFailure = resolveSessionErrorReason(errorReason, errorMessage) === 'start_failed'
	const displayErrorMessage = getSessionErrorDisplayMessage(errorReason, errorMessage)
	const isResponseEditorDisabled =
		!canEditPrompt || responseEditorDisabled || isHostOffline || isSubmitting || isDenySubmitting
	const canInterruptAndSend = canEditPrompt && !isHostOffline && isRunning && hasText && !!onQueue && !!onInterrupt
	const showNarrowQueueControls = canInterruptAndSend && isNarrow
	const editorPlaceholder = getResponseEditorPlaceholder(isDenying, isForkMode, isFocused)
	const failedSessionMessage = getFailedSessionMessage({
		displayErrorMessage,
		codelayerAuthRemediationLabel,
		canOpenCodelayerSetup: Boolean(codelayerSetupTarget),
		canOpenClaudeSignIn: Boolean(claudeSignInTarget),
		isClaudeCodeSessionIdFailure,
		onOpenCodelayerSetup: () => {
			if (codelayerSetupTarget) useCodingAgentSetupStore.getState().open({ target: codelayerSetupTarget })
		},
		onOpenClaudeSignIn: () => {
			if (claudeSignInTarget) useCodingAgentSetupStore.getState().open({ target: claudeSignInTarget })
		},
		onOpenDiagnostics: () => navigateToSettings(navigate, 'diagnostics'),
	})

	return (
		<div
			ref={composerWrapperRef}
			data-session-composer
			data-focus-area={FOCUSED_AREAS.MAIN}
			className={cn(
				// Transparent border keeps layout stable for the dragging border below
				'@container border border-transparent bg-accent/5 rounded-lg py-2 px-2 relative',
				isDragging && 'border-dashed border-[var(--terminal-accent)]',
				className,
			)}
			onKeyDown={handleContainerKeyDown}
			onPointerDown={canEditPrompt ? handleComposerPointerDown : undefined}
			onDragEnter={canUseFiles ? handleDragEnter : undefined}
			onDragLeave={handleDragLeave}
			onDragOver={handleDragOver}
			onDrop={canUseFiles ? handleDrop : undefined}
		>
			{isDragging && (
				<div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--terminal-accent)_10%,transparent)] pointer-events-none">
					<span className="text-[var(--terminal-accent)] font-mono text-sm uppercase tracking-wider">
						Drop files here
					</span>
				</div>
			)}
			<div className={cn('border-l-2 pl-2 pr-2 space-y-2 transition-colors', getBorderColor())}>
				{/* Status indicator and model selector */}
				<div className="flex flex-wrap items-center gap-2">
					{isDenying ? (
						<span className="font-mono text-xs uppercase tracking-wider flex items-center gap-1.5 text-destructive">
							<MessageCircleX className="h-3 w-3" />
							{sharedResponse ? 'PRIVATE DENIAL FEEDBACK' : 'TELL CLAUDE WHAT TO DO DIFFERENTLY'}
							{' ('}
							<KeyboardShortcut size="xs">Esc</KeyboardShortcut>
							{' to cancel)'}
						</span>
					) : isForkMode ? (
						<span className="font-mono text-xs uppercase tracking-wider flex items-center gap-1.5 text-[var(--terminal-accent)]">
							<Split className="h-3 w-3" />
							{sharedResponse ? 'PRIVATE FORK PROMPT' : 'FORK MODE'}
							{forkedFromMessage && (
								<span className="normal-case tracking-normal opacity-70 italic truncate max-w-[300px]">
									from &quot;{forkedFromMessage}&quot;
								</span>
							)}
							{' ('}
							<KeyboardShortcut size="xs">Esc</KeyboardShortcut>
							{' to cancel)'}
						</span>
					) : (
						<span
							className={cn(
								'font-mono text-xs uppercase tracking-wider',
								getSessionStatusClass(sessionStatus as SessionStatus),
							)}
						>
							{sessionStatusLabel(sessionStatus, statusHost)}
						</span>
					)}

					{/* Model Selector Dropdown */}
					<Tooltip open={isModelTooltipVisible} onOpenChange={handleModelTooltipOpenChange}>
						<TooltipTrigger asChild>
							<div>
								<DropdownMenu open={modelSelectorOpen} onOpenChange={handleModelSelectorOpenChange}>
									<DropdownMenuTrigger asChild disabled={isModelSelectorDisabled}>
										<Button
											variant="outline"
											size="sm"
											className={cn(
												'h-6 px-2 py-0 text-xs font-mono uppercase tracking-wider',
												'border-muted-foreground/20 transition-colors duration-200',
												isModelSelectorDisabled
													? 'cursor-not-allowed opacity-50'
													: 'hover:border-muted-foreground/40 hover:text-primary hover:bg-primary/10',
											)}
											disabled={isModelSelectorDisabled}
											onKeyDown={handleSelectorTriggerKeyDown}
										>
											{models.labelOf({ agent: codingAgent, provider, model })}
											{!isModelSelectorDisabled && (
												<Pencil className="h-3 w-3 ml-1.5 opacity-50" />
											)}
										</Button>
									</DropdownMenuTrigger>
									<DropdownMenuContent align="start" className="min-w-[120px]">
										<DropdownMenuRadioGroup
											value={model}
											onValueChange={(value) => handleModelChange(value as ModelType)}
										>
											{filteredModels.map((option) => (
												<DropdownMenuRadioItem
													key={option.value}
													value={option.value}
													className="font-mono uppercase text-xs tracking-wider"
												>
													{option.label}
												</DropdownMenuRadioItem>
											))}
										</DropdownMenuRadioGroup>
										{children}
									</DropdownMenuContent>
								</DropdownMenu>
							</div>
						</TooltipTrigger>
						<TooltipContent>
							{isAgentSettingsLocked ? (
								<p>Change the model in {getCodingAgentLabel(codingAgent)}</p>
							) : (
								<p className="flex items-center gap-1">
									Select model <KeyboardShortcut>Shift+M</KeyboardShortcut>
								</p>
							)}
							{resolvedModel && resolvedModel !== sessionModel && (
								<p className="font-mono text-muted-foreground">running as {resolvedModel}</p>
							)}
						</TooltipContent>
					</Tooltip>

					{/* Effort Selector */}
					{effortCapability.supported && (
						<EffortSelector
							effort={sessionEffort}
							levels={effortCapability.levels}
							onEffortChange={handleEffortChange}
							selectorOpen={canEditPrompt && effortSelectorOpen}
							onSelectorOpenChange={setEffortSelectorOpen}
							contentSide="top"
							disabled={isEffortDisabled}
						/>
					)}

					{/* Fast Mode Toggle */}
					{fastModeCapability.supported && (
						<FastModeToggle
							enabled={sessionFastMode ?? false}
							onToggle={handleFastModeToggle}
							disabled={isFastModeDisabled}
						/>
					)}

					{/* Token Usage Badge */}
					<TokenUsageBadge
						contextWindowTokens={contextWindowTokens}
						contextWindowLimit={contextWindowLimit}
						provider={provider}
						model={sessionModel}
					/>

					{/* Context Window Warning */}
					{showContextWarning &&
						contextWindowTokens != null &&
						contextWindowTokens >= contextWarningThreshold &&
						!isDenying && <ContextWarningBanner onDismiss={hideContextWarning} />}

					{/* Session Cost Badge */}
					{showSessionCosts && <SessionCostBadge totalCostUsd={totalCostUsd} modelUsage={modelUsage} />}

					{/* Host Offline Badge */}
					{isHostOffline && <HostOfflineBadge hostName={hostName} action={launchDaemonAction} />}
					{isHostStarting && <HostReturningBadge hostName={hostName} state="starting" />}
					{isHostUpdating && <HostReturningBadge hostName={hostName} state="updating" />}

					{!isDenying && !isHostOffline && (
						<UsageLimitBadge limits={usageLimitNotice.limits} hostName={hostName} />
					)}

					{/* Error Message Display - hidden in denial mode */}
					{!isDenying && sessionStatus === 'lost' && displayErrorMessage && (
						<span className="font-mono text-xs uppercase tracking-wider text-[var(--terminal-warning)] break-words">
							{displayErrorMessage}
						</span>
					)}
					{!isDenying && sessionStatus === 'failed' && failedSessionMessage}
				</div>

				{usageLimitNotice.show && (
					<UsageLimitNotice
						limits={usageLimitNotice.limits}
						hostName={hostName}
						parked={isWaitingForUsageLimit}
						onDismiss={usageLimitNotice.onDismiss}
					/>
				)}

				<SharedResponseNotice
					status={contentMode === 'shared' ? sharedResponse?.status : undefined}
					retry={sharedResponse?.retry}
					privateContent={privateContent}
					editorRef={editorRef}
					disabled={isResponseEditorDisabled}
				/>
				<RichTextEditor
					key={contentMode}
					ref={bindEditor}
					{...binding}
					autoFocus={canEditPrompt ? getContinueEditorAutoFocus() : undefined}
					className="max-h-[25vh]"
					placeholder={editorPlaceholder}
					disabled={isResponseEditorDisabled}
					onSubmit={isDenying ? handleDenySubmit : isForkMode ? handleForkSubmit : handleSubmitOrInterrupt}
					submitShortcut={sendMessageKeybinding}
					onFocus={handleFocus}
					onBlur={handleBlur}
					onEscape={handleEscape}
					slashCommands={slashCommands}
					showSkillsHint={codingAgent === 'claude' || codingAgent === 'claude-code'}
					fileMentionSuggestion={fileMentionSuggestion}
					onFilePaste={canUseFiles && taskId && taskSlug ? uploadFiles : undefined}
				/>

				{canUseFiles &&
					fileMentionOpen &&
					createPortal(
						<div
							className="fixed z-50 bg-popover border rounded-md shadow-lg min-w-[300px] w-fit"
							style={{
								top: fileMentionPosition.direction === 'up' ? 'auto' : fileMentionPosition.top,
								bottom:
									fileMentionPosition.direction === 'up'
										? window.innerHeight - fileMentionPosition.top
										: 'auto',
								left: fileMentionPosition.horizontal === 'left' ? fileMentionPosition.left : 'auto',
								right: fileMentionPosition.horizontal === 'right' ? fileMentionPosition.right : 'auto',
								maxWidth: fileMentionPosition.maxWidth,
							}}
						>
							<FileMentionDropdown
								ref={fileMentionDropdownRef}
								query={fileMentionQuery}
								command={commandAndClose}
								taskId={taskId}
								workingDirectory={workingDirectory}
								isHostOffline={isHostOffline}
								continueQuery={continueQuery}
							/>
						</div>,
						document.body,
					)}

				{/* Action buttons row */}
				<div className="flex items-center justify-between gap-2">
					{isDenying ? (
						<>
							{/* Empty spacer for left side */}
							<div />
							<div className="flex min-w-0 items-center gap-2">
								<Button
									variant="outline"
									size="sm"
									onClick={onCancelDeny}
									disabled={!canEditPrompt || isDenySubmitting}
									className="h-auto py-0.5 px-2 text-xs"
								>
									Cancel
									<KeyboardShortcut size="xs">Esc</KeyboardShortcut>
								</Button>
								<Button
									variant="destructive"
									size="sm"
									onClick={handleDenySubmit}
									disabled={!canEditPrompt || isHostOffline || !hasText || isDenySubmitting}
									className="h-auto py-0.5 px-2 text-xs"
								>
									<MessageCircleX className="h-3 w-3 mr-1" />
									{isDenySubmitting ? 'Denying...' : 'DENY'}
									<KeyboardShortcut size="xs">{submitKey.toUpperCase()}</KeyboardShortcut>
								</Button>
							</div>
						</>
					) : isForkMode ? (
						<>
							<div className="flex items-center gap-2">
								<label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
									<Checkbox
										checked={archiveOnFork}
										onCheckedChange={(checked) => onArchiveOnForkChange?.(checked === true)}
									/>
									Archive current session
								</label>
							</div>
							<div className="flex items-center gap-2">
								<Button
									variant="outline"
									size="sm"
									className="h-auto py-0.5 px-2 text-xs"
									onClick={onForkCancel}
								>
									Cancel
									<KeyboardShortcut size="xs">Esc</KeyboardShortcut>
								</Button>
								<Button
									onClick={handleForkSubmit}
									disabled={!hasText}
									className="h-auto py-0.5 px-2 text-xs"
								>
									<Split className="h-3 w-3 mr-1" />
									Fork
									<KeyboardShortcut size="xs" className="ml-1">
										{forkKey}
									</KeyboardShortcut>
								</Button>
							</div>
						</>
					) : (
						<>
							<div className="flex items-center gap-1">
								<SessionActionButtons
									bypassEnabled={bypassEnabled}
									bypassTimeoutMinutes={null}
									onToggleBypass={handleToggleBypass}
									permissionsMode={permissionsMode ?? 'default'}
									onPermissionModeChange={(mode) => {
										if (canEditPrompt) onPermissionModeChange?.(mode)
									}}
									codingAgent={codingAgent}
									showAutoAdvance={showAutoAdvance}
									autoAdvanceEnabled={autoAdvanceEnabled}
									autoAdvanceNextStepName={autoAdvanceNextStepName}
									onToggleAutoAdvance={onToggleAutoAdvance}
									isArchived={isArchived ?? false}
									sessionStatus={sessionStatus ?? 'unknown'}
									onToggleArchive={onToggleArchive ?? (() => {})}
									showFork={showFork}
									onFork={onFork}
									forkDisabled={forkDisabled}
									promptControlsDisabled={!canEditPrompt}
									showOwnerControls={canManageSession}
									archiveShortcutKeys={shortcutKeycaps(keybindingDisplays.archive)}
								/>
								{canUseFiles && taskId && taskSlug && <AttachFileButton onFiles={uploadFiles} />}
								{multiplayerPromptingControl}
							</div>

							<div className="flex items-center gap-2">
								{pendingUploadCount > 0 && (
									<div className="flex items-center gap-1.5 text-xs text-muted-foreground">
										<Loader2 className="h-3 w-3 animate-spin" />
										Uploading {pendingUploadCount} {pendingUploadCount === 1 ? 'file' : 'files'}...
									</div>
								)}
								{canManageSession && showIterateButton && onIterateInNewSession && (
									<IterateInNewSessionButton
										isNarrow={isIterateButtonNarrow}
										isIconOnly={isIterateButtonIconOnly}
										onIterateInNewSession={onIterateInNewSession}
									/>
								)}
								{isNeedsApproval && onInterrupt && (
									<InterruptButton
										isNarrow={isNarrow}
										onInterrupt={() => onInterrupt()}
										disabled={!canEditPrompt || isHostOffline}
									/>
								)}
								{/* Non-narrow: Interrupt + Interrupt & Send buttons */}
								{canInterruptAndSend && !isNarrow && (
									<>
										<InterruptButton
											isNarrow={isNarrow}
											onInterrupt={() => onInterrupt()}
											disabled={!canEditPrompt || isHostOffline}
										/>
										<InterruptAndSendButton
											isNarrow={isNarrow}
											onInterruptAndSend={handleInterruptAndSend}
											disabled={!canEditPrompt || isHostOffline}
										/>
									</>
								)}
								<div id={diffFeedbackDeliveryTraySlotId(sessionId)} />
								{!isRunning && !isTransitional && (
									<ArtifactCommentDeliveryControls
										sessionId={sessionId}
										commentDeliveryOwner={commentDeliveryOwner}
										disabled={
											!canEditPrompt || isSubmitting || isHostOffline || responseEditorDisabled
										}
										isNarrow={isNarrow}
										editorText={sharedResponse ? '' : text}
										onSubmit={(commentText) => {
											onSubmit({
												text: commentText,
												model,
												permissionsMode: getPermissionsMode(),
											})
										}}
										onClearEditor={clearComposer}
									/>
								)}
								{/* Narrow: Queue split button (primary action) */}
								{showNarrowQueueControls && (
									<QueueSplitButton
										className="session-composer-primary-action"
										onQueue={() => {
											onQueue(captureResponseSubmission())
											clearComposer()
											editorRef.current?.blur()
										}}
										onInterrupt={() => onInterrupt()}
										onInterruptAndSend={handleInterruptAndSend}
										disabled={!canEditPrompt || isSubmitting || isTransitional || isHostOffline}
									/>
								)}
								{/* Non-narrow: Send/Queue button (primary action) */}
								{!showNarrowQueueControls && (
									<Button
										onClick={handleSubmitOrInterrupt}
										disabled={
											!canEditPrompt ||
											isSubmitting ||
											isTransitional ||
											isHostOffline ||
											responseEditorDisabled ||
											(!isRunning && !hasText)
										}
										variant={submitButtonVariant}
										aria-label={getButtonText()}
										className="session-composer-primary-action h-auto py-0.5 px-2 text-xs"
									>
										{isRunning && !hasText ? (
											<OctagonX className="session-composer-primary-action-icon h-3.5 w-3.5 mr-1" />
										) : (
											<Send className="session-composer-primary-action-icon h-3.5 w-3.5 mr-1" />
										)}
										<span className="session-composer-primary-action-label">{getButtonText()}</span>
										<KeyboardShortcut
											size="xs"
											className="session-composer-primary-action-shortcut ml-1"
										>
											{sendKey}
										</KeyboardShortcut>
									</Button>
								)}
							</div>
						</>
					)}
				</div>
			</div>
			<FastModeWarningDialog
				open={canEditPrompt && fastModePendingEnable}
				onOpenChange={setFastModePendingEnable}
				onConfirm={confirmFastMode}
			/>
		</div>
	)
}

function SharedResponseNotice({
	status,
	retry,
	privateContent,
	editorRef,
	disabled,
}: {
	status: SharedResponseSnapshot['status'] | undefined
	retry?: () => void
	privateContent: Content | null
	editorRef: React.RefObject<RichTextEditorRef | null>
	disabled: boolean
}) {
	const [copyStatus, setCopyStatus] = useState('')
	const copyText = () => {
		const content = editorRef.current?.editor?.getJSON()
		if (!content) return
		void copyAsyncTextToClipboard(Promise.resolve(getTextFromContent(content))).then(
			() => setCopyStatus('Copied'),
			() => setCopyStatus('Could not copy text'),
		)
	}
	const insertPrivateText = () => {
		const editor = editorRef.current?.editor
		if (disabled || !editor?.isEditable || !privateContent) return
		const insertion =
			typeof privateContent === 'string' || Array.isArray(privateContent)
				? privateContent
				: (privateContent.content ?? [])
		editor.chain().focus('end').insertContent(insertion).run()
	}
	const hasPrivateText = Boolean(getTextFromContent(privateContent).trim())
	if (!status || (status === 'connected' && !hasPrivateText)) return null
	return (
		<div className="font-mono text-xs text-muted-foreground">
			{status !== 'connected' && <span role="status">{getSharedResponseStatusLabel(status)}</span>}
			{status === 'reconnecting' && (
				<>
					<Button variant="outline" size="sm" className="ml-2 h-6 text-xs" onClick={retry}>
						Retry
					</Button>
					<Button variant="outline" size="sm" className="ml-2 h-6 text-xs" onClick={copyText}>
						Copy local text
					</Button>
					{copyStatus && (
						<span role="status" className="ml-2">
							{copyStatus}
						</span>
					)}
				</>
			)}
			{hasPrivateText && (
				<Button
					variant="outline"
					size="sm"
					className="ml-2 h-6 text-xs"
					disabled={disabled}
					onClick={insertPrivateText}
				>
					Insert private text
				</Button>
			)}
		</div>
	)
}

export function ArtifactCommentDeliveryControls({
	sessionId,
	commentDeliveryOwner,
	disabled,
	isNarrow,
	editorText,
	onSubmit,
	onClearEditor,
}: {
	sessionId: string
	commentDeliveryOwner: ArtifactViewerMode['commentDeliveryOwner']
	disabled: boolean
	isNarrow: boolean
	editorText: string
	onSubmit: (text: string) => void
	onClearEditor: () => void
}) {
	return (
		<>
			<div
				id={artifactCommentDeliveryTraySlotId(sessionId)}
				data-comment-delivery-owner={commentDeliveryOwner}
				className="session-composer-artifact-delivery min-w-0"
			/>
			{commentDeliveryOwner === 'legacy' && (
				<SendCommentsSplitButton
					className="session-composer-comment-delivery"
					disabled={disabled}
					isNarrow={isNarrow}
					hidden={false}
					editorText={editorText}
					onSubmit={onSubmit}
					onClearEditor={onClearEditor}
				/>
			)}
		</>
	)
}

/**
 * Wired version of ContinueSessionInput for the desktop session detail page.
 * Pulls all session state from useSessionDetail() and resolves hook-derived
 * values (taskId, taskSlug, workingDirectory, uploadFiles, session actions,
 * showSessionCosts) internally. Use ContinueSessionInputPure in Storybook.
 */
export function ContinueSessionInput({
	className,
	collaborationOptions,
}: { className?: string; collaborationOptions?: SharedResponseOptions } = {}) {
	const { membersMap } = useOrgMembers()
	const collaborationIdentities = useMemo(() => resolveCollaborationIdentities(membersMap), [membersMap])
	const {
		sessionId,
		session,
		conversation,
		isReadyForInput,
		canManageSession,
		canSendPrompt,
		isMultiplayerPromptingOpen,
		setIsMultiplayerPromptingOpen,
		selectedArtifactViewerMode,
		continueEditorRef,
		setIsEditorFocused,
		archiveTask,
		sessionActions,
		sendControls,
		permissionControls,
		autoAdvance,
		fork,
		host,
		jumpToBottom,
		handleSubmitWithApprovalCheck,
	} = useSessionDetail()
	const modelSelectorOpen = useSessionUiStore((state) => state.modelSelectorOpen)
	const setModelSelectorOpen = useSessionUiStore((state) => state.setModelSelectorOpen)
	const denyingApproval = useApprovalStore((state) => state.denyingApproval)
	const setDenyFeedbackText = useApprovalStore((state) => state.setDenyFeedbackText)
	const { deny } = useApprovalActions()

	// Denial mode can start from a row or hotkey. This surface owns the editor
	// ref, so it also owns the store subscription that focuses the editor.
	useMountEffect(() => {
		let timer: ReturnType<typeof setTimeout> | undefined
		const focusSoon = () => {
			clearTimeout(timer)
			timer = setTimeout(() => continueEditorRef.current?.focus(), 10)
		}
		if (useApprovalStore.getState().denyingApproval) focusSoon()
		const unsubscribe = useApprovalStore.subscribe((state, previousState) => {
			if (state.denyingApproval === previousState.denyingApproval) return
			if (state.denyingApproval) focusSoon()
			else clearTimeout(timer)
		})
		return () => {
			clearTimeout(timer)
			unsubscribe()
		}
	})

	const handleDenyCancel = useCallback(() => {
		useApprovalStore.getState().cancelDeny()
	}, [])

	const handleDenySubmit = useCallback(
		(message: string) => {
			const current = useApprovalStore.getState().denyingApproval
			if (!current) return
			useApprovalStore.getState().cancelDeny()
			jumpToBottom()
			void deny(current.id, message)
		},
		[deny, jumpToBottom],
	)
	const { sessionsCollection, tasksCollection } = useSync()
	const { data: sessionData } = useLiveQuery(
		(q) =>
			q
				.from({ sessions: sessionsCollection })
				.where(({ sessions }) => eq(sessions.id, sessionId))
				.select(({ sessions }) => ({
					task_id: sessions.task_id,
					working_directory: sessions.working_directory,
					effort: sessions.effort,
					fast_mode: sessions.fast_mode,
				})),
		[sessionsCollection, sessionId],
	)
	const taskId = sessionData?.[0]?.task_id ?? null
	const workingDirectory = sessionData?.[0]?.working_directory ?? null
	const sessionEffort = sessionData?.[0]?.effort ?? null
	const sessionFastMode = sessionData?.[0]?.fast_mode ?? null

	const { data: taskData } = useLiveQuery(
		(q) =>
			taskId
				? q
						.from({ tasks: tasksCollection })
						.where(({ tasks }) => eq(tasks.id, taskId))
						.select(({ tasks }) => ({ slug: tasks.slug }))
				: undefined,
		[tasksCollection, taskId],
	)
	const taskSlug = taskData?.[0]?.slug ?? null

	const { uploadFiles, pendingUploadCount } = useFileUpload({
		taskId: taskId ?? '',
		taskSlug: taskSlug ?? '',
		editorRef: continueEditorRef,
	})

	const { updateSessionModel, updateSessionEffort, updateSessionFastMode } = useSessionActions()
	const showSessionCosts = useSettingsStore((state) => state.showSessionCosts)
	const showContextWarning = useSettingsStore((state) => isContextWarningShown(state, Date.now()))
	const setupHost = useCodingAgentSetupHost(session.host_id)
	const slashCommands = useAgentSlashCommands({
		hostId: session.host_id,
		agent: session.coding_agent,
		workspacePath: workingDirectory,
		fallbackCommands: RESPONSE_SLASH_COMMANDS,
	})
	const models = useHostModelRegistry(session.host_id)
	const responseEditorDisabled =
		resolveSessionErrorReason(session.error_reason, session.error_message) === 'start_failed'
	const handoff = useHarnessHandoff()

	return (
		<>
			<HarnessHandoffDialog
				open={handoff.isOpen}
				onOpenChange={(open) => (open ? handoff.open() : handoff.close())}
				targetLabel={handoff.targetLabel}
				modelOptions={handoff.modelOptions}
				pending={handoff.pending}
				onConfirm={handoff.confirm}
			/>
			<ContinueSessionInputBinding
				key={
					collaborationOptions
						? `${collaborationOptions.organizationId}:${sessionId}:${collaborationOptions.memberId}:${collaborationOptions.contentAccess}`
						: `${sessionId}:private`
				}
				collaborationOptions={collaborationOptions}
				collaborationIdentities={collaborationIdentities}
				className={className}
				sessionId={sessionId}
				onSubmit={handleSubmitWithApprovalCheck}
				onInterrupt={sendControls.handleInterruptWithConfirmation}
				onQueue={({ text, sharedSubmission }) =>
					sessionActions.continueV2({
						sessionId,
						messageId: uuidv7(),
						eventId: uuidv7(),
						text,
						intent: 'queue',
						sharedSubmission,
					})
				}
				isSubmitting={sendControls.isSubmittingContinue}
				disabled={!isReadyForInput || !canSendPrompt}
				canPrompt={canSendPrompt}
				canManageSession={canManageSession}
				onFocusChange={setIsEditorFocused}
				editorRef={continueEditorRef}
				permissionsMode={session.permissions_mode as PermissionsMode}
				onToggleBypass={permissionControls.handleBypassPermissions}
				onPermissionModeChange={permissionControls.handlePermissionModeChange}
				showAutoAdvance={autoAdvance.autoAdvanceConfig.show}
				autoAdvanceEnabled={autoAdvance.isAutoAdvanceEnabled}
				autoAdvanceNextStepName={autoAdvance.autoAdvanceConfig.nextStepName ?? 'research'}
				onToggleAutoAdvance={autoAdvance.handleAutoAdvanceToggle}
				isArchived={session.archived ?? false}
				sessionStatus={session.status}
				onToggleArchive={archiveTask.handleToggleArchive}
				modelSelectorOpen={modelSelectorOpen}
				onModelSelectorOpenChange={setModelSelectorOpen}
				contextWindowTokens={session.context_window_tokens}
				contextWindowLimit={session.context_window_limit}
				model={session.model}
				resolvedModel={session.resolved_model}
				codingAgent={session.coding_agent}
				provider={session.provider as ProviderOption | null}
				setupHost={setupHost}
				models={models}
				totalCostUsd={session.total_cost_usd}
				modelUsage={session.model_usage}
				errorMessage={session.error_message}
				errorReason={session.error_reason}
				isHostOffline={host.isHostOffline}
				isHostStarting={host.isHostStarting}
				isHostUpdating={host.isHostUpdating}
				hostName={host.hostDisplayName}
				statusHost={host.statusHost}
				hostUsageLimits={host.usageLimits}
				canLaunchLocalDaemon={host.canLaunchLocalDaemon}
				onLaunchDaemon={() => host.setLaunchModalOpen(true)}
				hasPendingApprovals={conversation.hasPendingApprovals}
				isDenying={!!denyingApproval}
				denyingToolName={denyingApproval?.toolName}
				onCancelDeny={handleDenyCancel}
				onSubmitDeny={handleDenySubmit}
				onDenyContentChange={setDenyFeedbackText}
				iterateSlashCommand={autoAdvance.iterateSlashCommand}
				onIterateInNewSession={autoAdvance.handleIterateInNewSession}
				showFork={fork.canFork && fork.userMessageCount >= 2}
				onFork={fork.handleEnterForkMode}
				forkDisabled={fork.isForkMode}
				isForkMode={fork.isForkMode}
				forkContent={fork.forkContent}
				onForkContentChange={fork.setForkContent}
				archiveOnFork={fork.archiveOnFork}
				onArchiveOnForkChange={fork.setArchiveOnFork}
				onForkConfirm={fork.handleForkConfirm}
				onForkCancel={fork.handleForkCancel}
				forkedFromMessage={fork.forkedFromMessage}
				commentDeliveryOwner={selectedArtifactViewerMode.commentDeliveryOwner}
				taskId={taskId}
				taskSlug={taskSlug}
				workingDirectory={workingDirectory}
				slashCommands={slashCommands}
				uploadFiles={uploadFiles}
				pendingUploadCount={pendingUploadCount}
				responseEditorDisabled={responseEditorDisabled}
				updateSessionModel={updateSessionModel}
				effort={sessionEffort}
				fastMode={sessionFastMode}
				updateSessionEffort={updateSessionEffort}
				updateSessionFastMode={updateSessionFastMode}
				showSessionCosts={showSessionCosts}
				showContextWarning={showContextWarning}
				multiplayerPromptingControl={
					<MultiplayerPromptingControl
						isOwner={canManageSession}
						session={session}
						open={isMultiplayerPromptingOpen}
						onOpenChange={setIsMultiplayerPromptingOpen}
					/>
				}
			>
				{handoff.visible && (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuItem
							disabled={!!handoff.blockedReason}
							onSelect={() => {
								setModelSelectorOpen(false)
								handoff.open()
							}}
							className="flex flex-col items-start gap-0.5 py-2"
						>
							<span className="flex w-full items-center gap-2">
								<ArrowLeftRight className="h-3.5 w-3.5 shrink-0" />
								<span>Hand off to {handoff.targetLabel}</span>
								<ArrowRight className="ml-auto h-3.5 w-3.5 shrink-0 opacity-60" />
							</span>
							<span className="whitespace-nowrap pl-[1.375rem] text-xs text-muted-foreground">
								New session, same task and artifacts
							</span>
						</DropdownMenuItem>
						{handoff.blockedReason && (
							<p className="max-w-64 px-2 py-1 text-xs text-muted-foreground">{handoff.blockedReason}</p>
						)}
					</>
				)}
			</ContinueSessionInputBinding>
		</>
	)
}

export function ContinueSessionInputBinding({
	collaborationOptions,
	...props
}: ContinueSessionInputPureProps & { collaborationOptions?: SharedResponseOptions }) {
	if (!collaborationOptions) return <ContinueSessionInputPure {...props} />
	return <SharedContinueSessionInput {...props} collaborationOptions={collaborationOptions} />
}

function SharedContinueSessionInput({
	collaborationOptions,
	...props
}: ContinueSessionInputPureProps & { collaborationOptions: SharedResponseOptions }) {
	const internalRef = useRef<RichTextEditorRef>(null)
	const editorRef = props.editorRef ?? internalRef
	const shared = useResponseEditorCollaboration(collaborationOptions, editorRef)
	if (shared?.status === 'access-lost')
		return (
			<div role="status" className="font-mono text-xs">
				Shared response access lost
			</div>
		)
	if (!shared)
		return (
			<div role="status" className="font-mono text-xs">
				Connecting to shared response…
			</div>
		)
	return (
		<ResponseEditorPresenceContext value={shared.owner.presence}>
			<ContinueSessionInputPure
				{...props}
				editorRef={editorRef}
				sharedResponse={{
					retry: () => {
						void shared.owner.retry()
					},
					binding: { ...shared.owner.binding, identities: props.collaborationIdentities },
					status: shared.status,
					content: shared.content,
				}}
			/>
		</ResponseEditorPresenceContext>
	)
}
