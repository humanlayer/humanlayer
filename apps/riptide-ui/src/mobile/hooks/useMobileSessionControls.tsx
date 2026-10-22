import { matchCodelayerAuthError } from '@humanlayer/ai/config'
import { permissionsModeSchema } from '@humanlayer/db/tables/sessions'
import { type CodingAgent, isLaunchableCodingAgent } from '@humanlayer/schemas/coding-agent'
import type { SessionErrorReason } from '@humanlayer/schemas/effect/session/session-error-reason'
import {
	ArchiveButton,
	AttachFileButton,
	BypassButton,
	PermissionModeButton,
} from '@humanlayer/ui/components/action-buttons'
import { AutoAdvanceButton } from '@humanlayer/ui/components/action-buttons/auto-advance-button'
import { Button } from '@humanlayer/ui/components/button'
import { MODEL_LABELS } from '@humanlayer/ui/components/status-bar'
import { getModelOptionsForAgentProvider, MODEL_OPTIONS } from '@humanlayer/ui/constants/models'
import type { PermissionsMode, PermissionsModeNoBypass } from '@humanlayer/ui/constants/permission-modes'
import type { ProviderOption } from '@humanlayer/ui/constants/providers'
import { useNavigate } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { useCallback, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { uuidv7 } from 'uuidv7'

import { ContextWarningBanner } from '@/components/ContextWarningBanner'
import { HostOfflineBadge } from '@/components/HostOfflineBadge'
import { SessionCostBadge } from '@/components/SessionCostBadge'
import { TokenUsageBadge } from '@/components/TokenUsageBadge'
import { useHostModelRegistry } from '@/hooks/live-queries/use-model-registry'
import { useSessionHostState } from '@/hooks/live-queries/use-session-host-state'
import { useCodingAgentSetupStore } from '@/hooks/stores/codingAgentSetupStore'
import { useDraftsStore } from '@/hooks/stores/draftsStore'
import { type ModelType, useSettingsStore } from '@/hooks/stores/settingsStore'
import { useCodingAgentSetupHost } from '@/hooks/use-coding-agent-setup-host'
import { useFastModeToggleGuard } from '@/hooks/useFastModeToggleGuard'
import { useFileUpload } from '@/hooks/useFileUpload'
import { useKeybindingDisplays } from '@/hooks/useKeybindingDisplays'
import type { useSessionActions } from '@/hooks/useSessionActions'
import type { useTaskSettings } from '@/hooks/useTaskSettings'
import { shortcutKeycaps } from '@/hotkeysCatalog'
import {
	AUTO_ADVANCE_FIELD_TO_SETTINGS_KEY,
	AUTO_ADVANCE_TRANSITIONS,
	findAutoAdvanceSourceLabel,
} from '@/lib/auto-advance-policy'
import { CLAUDE_SIGN_IN_VARIANT, getCodingAgentSetupTarget } from '@/lib/coding-agent-setup'
import { getContextWarningThreshold, isContextWarningShown } from '@/lib/context-warning'
import { BUNDLED_MODEL_REGISTRY, type ModelRegistry } from '@/lib/model-registry'
import { deriveSessionHostView } from '@/lib/session-host-state'
import { sessionStatusLabel } from '@/lib/session-status-label'
import { navigateToSettings } from '@/lib/settings-navigation'
import type { MobileInputAttachment, MobileInputSubmitMode } from '@/mobile/components/pure/MobileInput'
import type { MobileModelOption } from '@/mobile/components/pure/MobileModelSelector'
import { useMobileTaskComments } from '@/mobile/hooks/useMobileTaskComments'
import { getSessionErrorDisplayMessage, resolveSessionErrorReason } from '@/utils/session-error-messages'
import { getTextFromContent } from '@/utils/tiptap-content'

type SessionLike = {
	id: string
	status?: string | null
	archived?: boolean | null
	labels?: unknown
	permissions_mode?: string | null
	model?: string | null
	coding_agent?: CodingAgent | null
	provider?: string | null
	task_id?: string | null
	host_id?: string | null
	organization_id?: string | null
	created_by?: string | null
	effort?: string | null
	fast_mode?: boolean | null
	error_message?: string | null
	error_reason?: SessionErrorReason | null
	context_window_tokens?: number | null
	context_window_limit?: number | null
	total_cost_usd?: number | null
	// jsonb column — may arrive as an object or a JSON string from Electric sync
	model_usage?: Record<string, unknown> | string | null
}

type TaskLike = { id: string; workflow_type?: string | null; slug?: string | null }

const VALID_MODEL_VALUES = new Set(MODEL_OPTIONS.map((option) => option.value))

const EMPTY_EFFORT_LEVELS: readonly string[] = []

// eslint-disable-next-line react-refresh/only-export-components, react-doctor/only-export-components
export function resolveMobileModelValue(
	modelTag: string | null | undefined,
	models: ModelRegistry = BUNDLED_MODEL_REGISTRY,
	codingAgent: CodingAgent | null | undefined = null,
	provider: ProviderOption | null | undefined = null,
): ModelType {
	if (!modelTag) return 'opus'
	const hostModel = models.hostModelFor({ agent: codingAgent, provider, model: modelTag })
	if (hostModel) return hostModel
	if (VALID_MODEL_VALUES.has(modelTag as (typeof MODEL_OPTIONS)[number]['value'])) return modelTag as ModelType
	if (modelTag.includes('sonnet-5-5') || modelTag.includes('sonnet_5_5')) return 'claude-sonnet-5-5'
	if (modelTag.includes('sonnet-5') || modelTag.includes('sonnet_5')) return 'claude-sonnet-5'
	if (modelTag.includes('sonnet') && (modelTag.includes('4-') || modelTag.includes('4_'))) {
		return 'claude-sonnet-4-6'
	}
	if (modelTag.includes('sonnet')) return 'claude-sonnet-5'
	if (modelTag.includes('haiku')) return 'claude-haiku-4-5-20251001'
	// Opus 5.5, Opus 5, and base 4.8/4.7 are 1M models, so any [1m]/-1m suffix folds to the base entry.
	if (modelTag.includes('opus-5-5') || modelTag.includes('opus_5_5')) return 'claude-opus-5-5'
	if (modelTag.includes('opus-5') || modelTag.includes('opus_5')) return 'claude-opus-5'
	if (modelTag.includes('4-8') || modelTag.includes('4_8')) return 'claude-opus-4-8'
	if (modelTag.includes('4-5') || modelTag.includes('4_5')) return 'claude-opus-4-5'
	if (modelTag.includes('4-7') || modelTag.includes('4_7')) return 'claude-opus-4-7'
	if (modelTag.includes('4-6') || modelTag.includes('4_6')) {
		// 4.6 keeps its 1M variant
		if (modelTag.includes('[1m]') || modelTag.includes('-1m')) return 'claude-opus-4-6-1m'
		return 'claude-opus-4-6'
	}
	// Generic opus fallback to shorthand (latest); stale opus-1m / opus[1m] folds here too
	if (modelTag.includes('opus')) return 'opus'
	return 'opus'
}

// eslint-disable-next-line react-refresh/only-export-components, react-doctor/only-export-components
export function getMobileSessionModelOptions(
	agent: CodingAgent | null | undefined,
	provider: ProviderOption | null | undefined,
): MobileModelOption[] {
	const filteredOptions = getModelOptionsForAgentProvider({ agent, provider })
	const options = filteredOptions.length > 0 ? filteredOptions : MODEL_OPTIONS
	return options.map((option) => ({
		value: option.value,
		label: MODEL_LABELS[option.value as ModelType] ?? option.label,
	}))
}

function normalizePermissionsMode(mode: string | null | undefined): PermissionsMode {
	const parsed = permissionsModeSchema.safeParse(mode)
	return parsed.success ? parsed.data : 'default'
}

interface UseMobileSessionControlsArgs {
	session: SessionLike | undefined
	currentTask: TaskLike | undefined
	sessionActions: ReturnType<typeof useSessionActions>
	taskSettings: ReturnType<typeof useTaskSettings>['settings']
	updateAutoAdvance: ReturnType<typeof useTaskSettings>['updateAutoAdvance']
	canSendPrompt: boolean
	sessionId: string
	/** Archive/unarchive action for the composer's button row; omit to hide the button. */
	onToggleArchive?: () => void
}

/**
 * Consolidates the composer / permissions / model / auto-advance wiring for the
 * mobile session detail page. Keeping this in a hook lets the wired page stay
 * small and focused on data fetching + rendering.
 */
export function useMobileSessionControls({
	session,
	currentTask,
	sessionActions,
	taskSettings,
	updateAutoAdvance,
	canSendPrompt,
	sessionId,
	onToggleArchive,
}: UseMobileSessionControlsArgs): {
	inputValue: string
	setInputValue: (value: string) => void
	isModelSelectorOpen: boolean
	/** The session's agent picks its model in its own terminal, so the app can't change it. */
	isAgentSettingsLocked: boolean
	setIsModelSelectorOpen: (open: boolean) => void
	modelOptions: MobileModelOption[]
	selectedModel: ModelType
	submitMode: MobileInputSubmitMode
	isSubmitDisabled: boolean
	inputActionButtons: ReactNode
	handleSend: () => void
	// Stop button shown next to the clock while the session is busy (mirrors
	// desktop's Interrupt button; interrupts without sending, keeps the draft).
	handleInterruptOnly: () => void
	isInterruptDisabled: boolean
	// Files still uploading — MobileInput shows an indicator and submit is blocked.
	pendingUploadCount: number
	// Direct send bypassing the draft (queues while running / awaiting approval,
	// matching what the server does with the message) — used by the artifact
	// comment drawer's Send action. Reports how the message was dispatched, or
	// false when blocked by permissions/status/offline host.
	sendMessageToSession: (text: string) => 'queued' | 'sent' | false
	// Send-comments-and-resolve button next to Send (mobile analog of desktop's
	// SendCommentsSplitButton, but across all of the task's artifacts).
	commentsUnresolvedCount: number
	handleSendCommentsAndResolve: () => void
	isSendCommentsDisabled: boolean
	// Unread comment awareness across the task's artifacts (drives the unread
	// markers on the hamburger button and the artifact list).
	commentsUnreadCount: number
	commentsUnreadArtifactIds: ReadonlySet<string>
	// File attachments (reuses the desktop upload path via useFileUpload)
	attachments: MobileInputAttachment[]
	handleRemoveAttachment: (id: string) => void
	handleModelChange: (value: string) => void
	// Effort selector
	effortSupported: boolean
	effortLevels: readonly string[]
	effortLabel: string
	selectedEffort: string | null
	isEffortSelectorOpen: boolean
	setIsEffortSelectorOpen: (open: boolean) => void
	handleEffortChange: (value: string) => void
	isEffortDisabled: boolean
	// Fast Mode
	fastModeSupported: boolean
	fastModeEnabled: boolean
	handleFastModeToggle: (next: boolean) => void
	isFastModeDisabled: boolean
	fastModePendingEnable: boolean
	setFastModePendingEnable: (open: boolean) => void
	confirmFastMode: (dontAskAgain?: boolean) => void
	// Context-window counter shown inline on the composer pill row.
	contextCounter: ReactNode
	// Compact info row (cost/host-offline badges + context warning + error message)
	inputInfoRow: ReactNode
	isResponseEditorDisabled: boolean
	statusLabel: string | null
} {
	const navigate = useNavigate()
	const defaultModel = useSettingsStore((state) => state.defaultModel)
	const showSessionCosts = useSettingsStore((state) => state.showSessionCosts)
	const contextWarningShown = useSettingsStore((state) => isContextWarningShown(state, Date.now()))
	const hideContextWarning = useSettingsStore((state) => state.hideContextWarning)
	const setupHost = useCodingAgentSetupHost(session?.host_id)

	const draftContent = useDraftsStore((s) => s.drafts[sessionId] ?? null)
	const inputValue = useMemo(() => getTextFromContent(draftContent), [draftContent])
	const setInputValue = useCallback(
		(value: string) => {
			if (value.length === 0) useDraftsStore.getState().clearDraft(sessionId)
			else useDraftsStore.getState().setDraft(sessionId, value)
		},
		[sessionId],
	)

	// Unresolved comments across ALL of the task's artifacts (drives the
	// send-comments-and-resolve button next to Send).
	const taskComments = useMobileTaskComments(session?.task_id)

	const [isModelSelectorOpen, setIsModelSelectorOpen] = useState(false)
	const [isEffortSelectorOpen, setIsEffortSelectorOpen] = useState(false)
	const [isSubmittingContinue, setIsSubmittingContinue] = useState(false)
	const [attachments, setAttachments] = useState<MobileInputAttachment[]>([])

	// File attachments: reuse the desktop upload path (S3 presign / text pipeline)
	// via useFileUpload. There is no TipTap editor on mobile, so instead of
	// inserting an inline mention we track the returned mention id as a chip and
	// append it to the outgoing message text on send (same reference the daemon
	// receives on desktop).
	const taskSlug = currentTask?.slug ?? ''
	const canAttach = !!session?.task_id && !!taskSlug
	const handleUploaded = useCallback(({ mentionId, file }: { mentionId: string; file: File }) => {
		setAttachments((prev) =>
			prev.some((a) => a.id === mentionId) ? prev : [...prev, { id: mentionId, label: file.name }],
		)
	}, [])
	const { uploadFiles, pendingUploadCount } = useFileUpload({
		taskId: session?.task_id ?? '',
		taskSlug,
		onUploaded: handleUploaded,
	})
	const handleRemoveAttachment = useCallback((id: string) => {
		setAttachments((prev) => prev.filter((a) => a.id !== id))
	}, [])
	const mergeAttachments = useCallback(
		(base: string) =>
			[base, ...attachments.map((a) => a.id)]
				.map((s) => s.trim())
				.filter(Boolean)
				.join(' '),
		[attachments],
	)

	const host = useSessionHostState(session)
	const { isHostOffline } = deriveSessionHostView(host.state, host.isLocal)
	const statusLabel = sessionStatusLabel(
		session?.status,
		host.state && host.hostLabel ? { state: host.state, hostLabel: host.hostLabel, isLocal: host.isLocal } : null,
	)
	const models = useHostModelRegistry(session?.host_id)
	const codingAgent = session?.coding_agent as CodingAgent | null | undefined
	// A session the daemon doesn't run (pi, opencode) picks its model in its own terminal.
	const isAgentSettingsLocked = codingAgent != null && !isLaunchableCodingAgent(codingAgent)
	const sessionProvider = session?.provider as ProviderOption | null | undefined

	const modelOptions = useMemo<MobileModelOption[]>(() => {
		const filteredOptions = models.optionsFor({ agent: codingAgent, provider: sessionProvider })
		const options = filteredOptions.length > 0 ? filteredOptions : MODEL_OPTIONS
		return options.map((option) => ({ value: option.value, label: option.label }))
	}, [models, codingAgent, sessionProvider])

	const selectedModel = useMemo(
		() => resolveMobileModelValue(session?.model ?? defaultModel, models, codingAgent, sessionProvider),
		[session?.model, defaultModel, models, codingAgent, sessionProvider],
	)
	const selectedModelCapabilities = models.capabilitiesOf({
		agent: codingAgent,
		provider: sessionProvider,
		model: selectedModel,
	})

	const autoAdvanceConfig = useMemo(() => {
		if (!session?.task_id) return { show: false, field: null, nextStepName: null }
		const sourceLabel = findAutoAdvanceSourceLabel(session.labels)
		if (!sourceLabel) return { show: false, field: null, nextStepName: null }
		const transition = AUTO_ADVANCE_TRANSITIONS[sourceLabel]
		if (sourceLabel === 'rpi:research' && currentTask?.workflow_type === 'prd_tdd') {
			return {
				show: transition.field !== null,
				field: transition.field,
				nextStepName: 'Product Requirements Document',
			}
		}
		return { show: transition.field !== null, field: transition.field, nextStepName: transition.nextStepName }
	}, [session, currentTask?.workflow_type])

	const isAutoAdvanceEnabled = useMemo(() => {
		if (!autoAdvanceConfig.field) return false
		const settingsKey = AUTO_ADVANCE_FIELD_TO_SETTINGS_KEY[autoAdvanceConfig.field]
		return !!taskSettings[settingsKey]
	}, [autoAdvanceConfig.field, taskSettings])

	const updatePermissionsMode = useCallback(
		(nextMode: PermissionsMode) => {
			if (!session) return
			const transaction = sessionActions.updateSessionPermissions({
				sessionId: session.id,
				permissionsMode: nextMode,
			})
			transaction.isPersisted.promise.catch(() => {
				toast.error('Failed to update session permissions')
			})
		},
		[session, sessionActions],
	)

	const handleToggleBypass = useCallback(() => {
		const currentMode = normalizePermissionsMode(session?.permissions_mode)
		updatePermissionsMode(currentMode === 'bypass' ? 'default' : 'bypass')
	}, [session, updatePermissionsMode])

	const handlePermissionModeChange = useCallback(
		(mode: PermissionsModeNoBypass) => {
			updatePermissionsMode(mode)
		},
		[updatePermissionsMode],
	)

	const handleAutoAdvanceToggle = useCallback(() => {
		if (!currentTask || !autoAdvanceConfig.field) return
		const settingsKey = AUTO_ADVANCE_FIELD_TO_SETTINGS_KEY[autoAdvanceConfig.field]
		const nextValue = !taskSettings[settingsKey]
		const update: Parameters<typeof updateAutoAdvance>[0] = { taskId: currentTask.id, [settingsKey]: nextValue }
		const transaction = updateAutoAdvance(update)
		transaction.isPersisted.promise.catch(() => {
			toast.error('Failed to update auto-advance settings')
		})
	}, [autoAdvanceConfig.field, currentTask, taskSettings, updateAutoAdvance])

	const handleModelChange = useCallback(
		(nextModel: string) => {
			if (!session || isAgentSettingsLocked) return
			const transaction = sessionActions.updateSessionModel({ sessionId: session.id, model: nextModel })
			transaction.isPersisted.promise.catch(() => {
				toast.error('Failed to update session model')
			})
			// Changing model can invalidate the current effort/fastMode — reset those
			// in the same event when the new model no longer supports them (mirrors desktop).
			const nextResolved = resolveMobileModelValue(nextModel, models, codingAgent, sessionProvider)
			const nextCapabilities = models.capabilitiesOf({
				agent: codingAgent,
				provider: sessionProvider,
				model: nextResolved,
			})
			if (!nextCapabilities.effort.supported && session.effort != null) {
				sessionActions
					.updateSessionEffort({ sessionId: session.id, effort: null })
					.isPersisted.promise.catch(() => {})
			}
			if (!nextCapabilities.fastMode.supported && session.fast_mode) {
				sessionActions
					.updateSessionFastMode({ sessionId: session.id, fastMode: false })
					.isPersisted.promise.catch(() => {})
			}
		},
		[session, isAgentSettingsLocked, sessionActions, models, codingAgent, sessionProvider],
	)

	// Effort + Fast Mode capability gating (mirrors desktop ContinueSessionInput).
	const effortCapability = selectedModelCapabilities.effort
	const fastModeCapability = selectedModelCapabilities.fastMode
	const isEffortDisabled = isAgentSettingsLocked || session?.status === 'interrupt_requested'
	const isFastModeDisabled = isAgentSettingsLocked || session?.status === 'interrupt_requested'
	const selectedEffort = session?.effort ?? null
	const effortLevels = effortCapability.supported ? effortCapability.levels : EMPTY_EFFORT_LEVELS
	const effortLabel = (selectedEffort ?? 'effort').toUpperCase()
	const fastModeEnabled = session?.fast_mode ?? false

	const handleEffortChange = useCallback(
		(next: string) => {
			if (!session) return
			const transaction = sessionActions.updateSessionEffort({ sessionId: session.id, effort: next })
			transaction.isPersisted.promise.catch(() => {
				toast.error('Failed to update reasoning effort')
			})
		},
		[session, sessionActions],
	)

	const handleFastModeCommit = useCallback(
		(next: boolean) => {
			if (!session) return
			const transaction = sessionActions.updateSessionFastMode({ sessionId: session.id, fastMode: next })
			transaction.isPersisted.promise.catch(() => {
				toast.error('Failed to update Fast Mode')
			})
		},
		[session, sessionActions],
	)

	const {
		onToggle: handleFastModeToggle,
		pendingEnable: fastModePendingEnable,
		setPendingEnable: setFastModePendingEnable,
		confirm: confirmFastMode,
	} = useFastModeToggleGuard(handleFastModeCommit)

	// Model-aware context-window warning threshold (200k for 1M/codex, else 100k).
	const contextWarningThreshold = getContextWarningThreshold(session?.provider, session?.model)
	const contextWindowTokens = session?.context_window_tokens
	const showContextWarning =
		contextWarningShown && contextWindowTokens != null && contextWindowTokens >= contextWarningThreshold

	// Codex missing-auth remediation label (reuses shared matcher; only for codelayer sessions).
	const codelayerAuthRemediationLabel =
		session?.coding_agent === 'codelayer' ? matchCodelayerAuthError(session?.error_message) : null
	const codelayerSetupTarget = getCodingAgentSetupTarget({
		agent: session?.coding_agent,
		provider: session?.provider,
		host: setupHost,
	})
	const claudeSignInTarget =
		setupHost && session?.error_reason === 'auth_required'
			? { variant: CLAUDE_SIGN_IN_VARIANT, host: setupHost }
			: null
	const isClaudeCodeSessionIdFailure =
		resolveSessionErrorReason(session?.error_reason, session?.error_message) === 'start_failed'
	const displayErrorMessage = getSessionErrorDisplayMessage(session?.error_reason, session?.error_message)

	// Context-window counter — moved onto the composer pill row (Phase 6). Rendered
	// inline with the model/effort pills instead of on the separate info row.
	const contextCounter = useMemo<ReactNode>(() => {
		if (!session || contextWindowTokens == null) return null
		return (
			<TokenUsageBadge
				contextWindowTokens={contextWindowTokens}
				contextWindowLimit={session.context_window_limit}
				provider={session.provider}
				model={session.model}
				condensed
			/>
		)
	}, [session, contextWindowTokens])

	// No useMemo: the React Compiler memoizes this (react-doctor
	// react-compiler-no-manual-memoization); a manual wrapper blocks its
	// optimization of the surrounding hook.
	const inputInfoRow: ReactNode = (() => {
		if (!session) return null
		const hasError = session.status === 'failed' && !!displayErrorMessage
		const hasLostWarning = session.status === 'lost' && !!displayErrorMessage
		const hasCost = showSessionCosts && session.total_cost_usd != null
		if (!hasCost && !isHostOffline && !showContextWarning && !hasError && !hasLostWarning) return null
		const renderError = (): ReactNode => {
			if (!hasError) return null
			if (claudeSignInTarget) {
				return (
					<Button
						variant="link"
						onClick={() => useCodingAgentSetupStore.getState().open({ target: claudeSignInTarget })}
						className="h-auto p-0 font-mono text-xs text-[var(--terminal-error)] hover:underline"
					>
						Claude needs you to sign in. Sign in to Claude
					</Button>
				)
			}
			if (codelayerAuthRemediationLabel && codelayerSetupTarget) {
				return (
					<Button
						variant="link"
						onClick={() => {
							if (codelayerSetupTarget)
								useCodingAgentSetupStore.getState().open({ target: codelayerSetupTarget })
						}}
						className="h-auto p-0 font-mono text-xs text-[var(--terminal-error)] hover:underline"
					>
						Codex needs {codelayerAuthRemediationLabel} auth. Set up Codex
					</Button>
				)
			}
			if (isClaudeCodeSessionIdFailure) {
				return (
					<span className="max-w-full break-words font-mono text-xs text-[var(--terminal-error)]">
						{displayErrorMessage}
					</span>
				)
			}
			if (displayErrorMessage?.toLowerCase().includes('could not locate the claude code binary')) {
				return (
					<Button
						variant="link"
						onClick={() => navigateToSettings(navigate, 'diagnostics')}
						className="h-auto p-0 font-mono text-xs uppercase tracking-wider text-[var(--terminal-error)] hover:underline"
					>
						{displayErrorMessage}: Show Diagnostics
					</Button>
				)
			}
			return (
				<span className="max-w-full break-words font-mono text-xs uppercase tracking-wider text-[var(--terminal-error)]">
					{displayErrorMessage}
				</span>
			)
		}

		return (
			<>
				{hasCost && (
					<SessionCostBadge
						totalCostUsd={session.total_cost_usd}
						modelUsage={session.model_usage as Parameters<typeof SessionCostBadge>[0]['modelUsage']}
					/>
				)}
				{isHostOffline && (
					// Mobile has no in-composer daemon relaunch entry point (desktop-only),
					// so no action is offered — the badge is informational here.
					<HostOfflineBadge
						hostName={session.host_id ? session.host_id.substring(0, 6) : null}
						action={null}
					/>
				)}
				{showContextWarning && <ContextWarningBanner onDismiss={hideContextWarning} />}
				{hasLostWarning && (
					<span className="max-w-full break-words font-mono text-xs uppercase tracking-wider text-[var(--terminal-warning)]">
						{displayErrorMessage}
					</span>
				)}
				{renderError()}
			</>
		)
	})()

	const isReadyForInput =
		session?.status === 'ready_for_input' ||
		session?.status === 'needs_approval' ||
		session?.status === 'interrupted' ||
		session?.status === 'failed' ||
		session?.status === 'lost'

	// Transitional statuses where nothing may be dispatched (matches desktop's
	// isTransitional in ContinueSessionInput, which also covers waiting_for_agent).
	const isTransitionalStatus =
		session?.status === 'launching' ||
		session?.status === 'resuming' ||
		session?.status === 'interrupt_requested' ||
		session?.status === 'waiting_for_agent'

	// Statuses where the server enqueues send/queue intents instead of continuing
	// (isSessionActive server-side — launching/resuming are excluded here because
	// the composer is disabled during those). Drives the clock icon + queue intent
	// so the optimistic write matches what the server will actually do.
	const isQueueStatus =
		session?.status === 'running' ||
		session?.status === 'needs_approval' ||
		session?.status === 'waiting_for_usage_limit'

	const hasContent = inputValue.trim().length > 0 || attachments.length > 0

	const submitMode: MobileInputSubmitMode = isQueueStatus ? 'queue' : 'send'

	const isSubmitDisabled = useMemo(() => {
		if (!session) return true
		if (!canSendPrompt) return true
		if (isClaudeCodeSessionIdFailure) return true
		if (isSubmittingContinue) return true
		if (isHostOffline) return true
		if (pendingUploadCount > 0) return true
		if (isTransitionalStatus) return true
		if (!isQueueStatus && !isReadyForInput) return true
		return !hasContent
	}, [
		canSendPrompt,
		hasContent,
		isHostOffline,
		isClaudeCodeSessionIdFailure,
		isQueueStatus,
		isReadyForInput,
		isSubmittingContinue,
		isTransitionalStatus,
		pendingUploadCount,
		session,
	])

	// The stop button is only rendered while isQueueStatus (running/needs_approval),
	// so permission is the only extra gate. Interrupt stays available when the host
	// is offline (the interrupt_requested status is picked up when the daemon returns).
	const isInterruptDisabled = !session || !canSendPrompt || isClaudeCodeSessionIdFailure

	// Same "active" statuses SessionActionButtons uses to color the archive
	// button as a warning (archiving a busy session deserves a second look).
	const isActiveSessionStatus =
		session?.status === 'running' ||
		session?.status === 'needs_approval' ||
		session?.status === 'launching' ||
		session?.status === 'resuming'

	const keybindingDisplays = useKeybindingDisplays()
	const archiveShortcutKeys = shortcutKeycaps(keybindingDisplays.archive)

	const inputActionButtons = useMemo<ReactNode>(() => {
		if (!session) return null
		return (
			<>
				<BypassButton
					enabled={normalizePermissionsMode(session.permissions_mode) === 'bypass'}
					onToggle={handleToggleBypass}
				/>
				<PermissionModeButton
					value={normalizePermissionsMode(session.permissions_mode)}
					onValueChange={handlePermissionModeChange}
					disabled={session.coding_agent !== 'claude'}
					disabledTooltip="Auto-Accept only available for claude code sessions"
				/>
				{autoAdvanceConfig.show && (
					<AutoAdvanceButton
						enabled={isAutoAdvanceEnabled}
						onToggle={handleAutoAdvanceToggle}
						nextStepName={autoAdvanceConfig.nextStepName ?? 'next step'}
					/>
				)}
				{onToggleArchive && (
					<ArchiveButton
						isArchived={session.archived ?? false}
						isActiveSession={isActiveSessionStatus}
						onToggle={onToggleArchive}
						shortcutKeys={archiveShortcutKeys}
					/>
				)}
				{canAttach && !isHostOffline && <AttachFileButton onFiles={uploadFiles} />}
			</>
		)
	}, [
		archiveShortcutKeys,
		autoAdvanceConfig.nextStepName,
		autoAdvanceConfig.show,
		canAttach,
		handleAutoAdvanceToggle,
		handlePermissionModeChange,
		handleToggleBypass,
		isActiveSessionStatus,
		isAutoAdvanceEnabled,
		isHostOffline,
		onToggleArchive,
		session,
		uploadFiles,
	])

	const handleContinueSubmit = useCallback(
		(params: { text: string; model: ModelType; permissionsMode: PermissionsMode }) => {
			if (!session) return
			setIsSubmittingContinue(true)
			const transaction = sessionActions.continueV2({
				sessionId: session.id,
				messageId: uuidv7(),
				eventId: uuidv7(),
				text: params.text,
				intent: 'send',
			})
			void transaction.isPersisted.promise.finally(() => {
				setIsSubmittingContinue(false)
			})
		},
		[session, sessionActions],
	)

	const handleSend = useCallback(() => {
		if (!session) return
		const text = mergeAttachments(inputValue.trim())
		if (!text) return
		// running / needs_approval: the server enqueues either way — use the queue
		// intent so the optimistic write is a queued-message row, not a stream event.
		if (isQueueStatus) {
			const transaction = sessionActions.continueV2({
				sessionId,
				messageId: uuidv7(),
				eventId: uuidv7(),
				text,
				intent: 'queue',
			})
			transaction.isPersisted.promise.catch(() => {
				// toast is fired by the action factory on failure
			})
			setInputValue('')
			setAttachments([])
			return
		}
		if (!isReadyForInput) return
		handleContinueSubmit({
			text,
			model: selectedModel,
			permissionsMode: normalizePermissionsMode(session.permissions_mode),
		})
		setInputValue('')
		setAttachments([])
	}, [
		handleContinueSubmit,
		inputValue,
		isQueueStatus,
		isReadyForInput,
		mergeAttachments,
		selectedModel,
		session,
		sessionActions,
		sessionId,
		setInputValue,
	])

	// Interrupt the session without sending; keeps the draft + attachments
	// (the stop button next to the clock while running / awaiting approval).
	const handleInterruptOnly = useCallback(() => {
		if (!session) return
		const transaction = sessionActions.interruptSession({ sessionId })
		transaction.isPersisted.promise.catch(() => {
			toast.error('Failed to interrupt session')
		})
	}, [session, sessionActions, sessionId])

	// Send text directly to the session, bypassing the draft: queues while the
	// session is running, sends immediately otherwise. Applies the same
	// permission/status guards as the composer (this path is reachable from the
	// artifact comment drawer, which has no disabled-state of its own) and
	// returns how the message was dispatched so callers can report honestly.
	const sendMessageToSession = useCallback(
		(text: string): 'queued' | 'sent' | false => {
			if (!session || !text.trim()) return false
			if (isClaudeCodeSessionIdFailure) {
				toast.error('Create a new session to continue')
				return false
			}
			if (!canSendPrompt) {
				toast.error('You do not have permission to send messages in this session')
				return false
			}
			if (isHostOffline) {
				toast.error('Cannot send while the session host is offline')
				return false
			}
			if (isTransitionalStatus) {
				toast.error(`Cannot send while the session is ${statusLabel?.toLowerCase() ?? 'busy'}`)
				return false
			}
			// Queue while busy (running / needs_approval) so the optimistic write
			// matches the server, which enqueues send intents in those states too.
			const intent = isQueueStatus ? 'queue' : 'send'
			const transaction = sessionActions.continueV2({
				sessionId,
				messageId: uuidv7(),
				eventId: uuidv7(),
				text,
				intent,
			})
			transaction.isPersisted.promise.catch(() => {
				// toast is fired by the action factory on failure
			})
			return intent === 'queue' ? 'queued' : 'sent'
		},
		[
			canSendPrompt,
			isClaudeCodeSessionIdFailure,
			isHostOffline,
			isQueueStatus,
			isTransitionalStatus,
			session,
			sessionActions,
			sessionId,
			statusLabel,
		],
	)

	// Send every unresolved comment across the task's artifacts and resolve them,
	// prepending any drafted text (mirrors desktop's Send & Resolve).
	const handleSendCommentsAndResolve = useCallback(() => {
		const formatted = taskComments.getFormattedCommentsWithResolvedNote()
		if (!formatted) return
		const editorText = inputValue.trim()
		const text = mergeAttachments(editorText ? `${editorText}\n\n${formatted}` : formatted)
		// Only resolve (and clear the draft) if the send actually dispatched —
		// a blocked send must not mark the comments as handled.
		if (!sendMessageToSession(text)) return
		taskComments.resolveAll()
		setInputValue('')
		setAttachments([])
	}, [taskComments, inputValue, mergeAttachments, sendMessageToSession, setInputValue])

	const isSendCommentsDisabled = useMemo(() => {
		if (!session || !canSendPrompt) return true
		if (isClaudeCodeSessionIdFailure) return true
		if (isHostOffline) return true
		return isTransitionalStatus
	}, [canSendPrompt, isClaudeCodeSessionIdFailure, isHostOffline, isTransitionalStatus, session])

	return {
		inputValue,
		setInputValue,
		isModelSelectorOpen,
		isAgentSettingsLocked,
		setIsModelSelectorOpen,
		modelOptions,
		selectedModel,
		submitMode,
		isSubmitDisabled,
		inputActionButtons,
		handleSend,
		handleInterruptOnly,
		isInterruptDisabled,
		pendingUploadCount,
		sendMessageToSession,
		commentsUnresolvedCount: taskComments.unresolvedCount,
		handleSendCommentsAndResolve,
		isSendCommentsDisabled,
		commentsUnreadCount: taskComments.unreadCount,
		commentsUnreadArtifactIds: taskComments.unreadArtifactIds,
		attachments,
		handleRemoveAttachment,
		handleModelChange,
		effortSupported: effortCapability.supported,
		effortLevels,
		effortLabel,
		selectedEffort,
		isEffortSelectorOpen,
		setIsEffortSelectorOpen,
		handleEffortChange,
		isEffortDisabled,
		fastModeSupported: fastModeCapability.supported,
		fastModeEnabled,
		handleFastModeToggle,
		isFastModeDisabled,
		fastModePendingEnable,
		setFastModePendingEnable,
		confirmFastMode,
		contextCounter,
		inputInfoRow,
		isResponseEditorDisabled: isClaudeCodeSessionIdFailure || isHostOffline,
		statusLabel,
	}
}
