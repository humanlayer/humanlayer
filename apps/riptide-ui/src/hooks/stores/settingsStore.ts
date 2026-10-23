import {
	type ClaudeEffortLevel,
	type CodexReasoningLevel,
	DEFAULT_CLAUDE_EFFORT,
	DEFAULT_CODEX_REASONING,
} from '@humanlayer/ai/config'
import type { ExperimentFlags } from '@humanlayer/db/tables/user-settings'
import type { ResolvedTaskWorkflowType } from '@humanlayer/schemas/effect/taskconfiguration'
import type { SelectableModelProvider } from '@humanlayer/schemas/model-provider'
import type { DiffStyle } from '@humanlayer/ui/components/diff-style-provider'
import type { AgentOption } from '@humanlayer/ui/constants/agents'
import {
	DEFAULT_XAI_MODEL_ID,
	getModelOptionsForAgentProvider,
	type ModelOption,
	type XaiModelOption,
} from '@humanlayer/ui/constants/models'
import type { PermissionsMode } from '@humanlayer/ui/constants/permission-modes'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { getEditorEnvironment } from '@/integrations/desktop/workspace-config'
import {
	LEGACY_CODING_AGENT_SETUP_HOST_ID,
	type CodingAgentSetupAcknowledgements,
	type CodingAgentSetupVariantKey,
} from '@/lib/coding-agent-setup'
import { CONTEXT_WARNING_HIDE_MS } from '@/lib/context-warning'

type SyncForceMode = 'auto' | 'electric' | 'query'
export type EditorType = 'cursor' | 'code' | 'zed' | 'system'
export type ModelType = ModelOption
export type AgentType = AgentOption
export type ProviderType = SelectableModelProvider
export type MultiplayerPromptingDuration = '15m' | '30m' | '1h' | '2h' | '1d' | 'unlimited'
export type ArchiveKeybinding = 'e' | 'mod+e'
export type SendMessageKeybinding = 'enter' | 'mod+enter'
export interface MinimalistBannersDismissed {
	beta: boolean
	tryIt: boolean
}
interface SettingsState {
	// Guard: timestamp of the last local settings mutation (NOT persisted)
	// Used to prevent background polling from overwriting optimistic updates
	_lastMutationAt: number
	/** Auth scope currently expected by the settings poll (NOT persisted). */
	_serverSettingsRequestedScope: string | null
	/** Auth scope that supplied the currently stored milestone timestamps (NOT persisted). */
	_serverSettingsAppliedScope: string | null

	// User preferences (persisted to localStorage)
	defaultEditor: EditorType
	showSessionCosts: boolean
	autoUpdateEnabled: boolean
	notificationSoundsEnabled: boolean
	notificationVolume: number
	diffStyle: DiffStyle
	/** Fullscreen diff review keeps its own style; wide surfaces read best split. */
	diffStyleFullscreen: DiffStyle
	zoomLevel: number
	zoomScrollLockEnabled: boolean
	streamingRenderingEnabled: boolean
	contextWarningEnabled: boolean
	contextWarningHiddenUntil: number | null

	// Linear integration state (server-synced, like jiraEnabled)
	linearEnabled: boolean
	linearNeedsReauth: boolean

	// Jira integration state (server-synced)
	jiraEnabled: boolean
	jiraNeedsReauth: boolean
	jiraSiteUrl: string | null

	// Server-synced settings (persisted to localStorage AND server)
	theme: string
	experimentalSubagentsEnabled: boolean
	haikuResearchSubagentsEnabled: boolean
	defaultModel: ModelType // Legacy - kept for server sync
	defaultAgent: AgentType
	preferBatchQueueDelivery: boolean
	showTaskPhaseLabels: boolean
	projectsV2Enabled: boolean
	onboardingDismissedAt: number | null
	firstTaskCompletedAt: number | null
	firstStructuredWorkflowCompletedAt: number | null
	firstInboundCommentReceivedAt: number | null

	// Claude Code model default (persisted to localStorage only)
	defaultClaudeCodeModel: ModelType
	daemonDrivenWorkspaceSetupEnabled: boolean

	// Codelayer-specific defaults (persisted to localStorage only)
	defaultCodelayerProvider: ProviderType
	defaultCodelayerAnthropicModel: ModelType
	defaultCodelayerCopilotModel: ModelType
	defaultCodelayerCodexModel: ModelType
	defaultCodelayerXaiModel: XaiModelOption
	defaultCodelayerFirepassModel: ModelType

	// Client-only settings (persisted to localStorage only)
	minimalistUiEnabled: boolean
	// Whether this desktop app starts and keeps its own local daemon running.
	localDaemonEnabled: boolean
	defaultDirectory: string
	launcherV3PermissionsMode: PermissionsMode
	launcherV3WorkflowType: ResolvedTaskWorkflowType
	launcherV3AutoAdvance: boolean

	// Workflow graph settings (persisted)
	workflowGraphEnabled: boolean

	// Coding-agent setup-dialog acknowledgements, scoped to daemon host and auth variant (persisted).
	codingAgentSetupAcknowledgements: CodingAgentSetupAcknowledgements

	// Billing preview toggle - admin-only, local-only (persisted)
	billingPreviewEnabled: boolean

	// Collaborative diff viewer experiment - local-only (persisted)
	diffViewerEnabled: boolean

	// Local scratch pad experiment - local-only (persisted)
	scratchPadEnabled: boolean

	githubPrPanelEnabled: boolean

	// Rounded corners experiment - local-only (persisted)
	roundedCornersEnabled: boolean

	// Use Fold as the backend for newly created visible Codex sessions (persisted)
	useFoldCodingAgent: boolean

	// Replace the rotating loader verbs with a plain "Thinking" - local-only (persisted)
	thinkingVerbsDisabled: boolean

	// Show the agent's discovered slash commands and skills in the composer menu (persisted)
	agentCommandDiscoveryEnabled: boolean
	// Sign in to a coding agent on a daemon host from the app instead of the terminal (persisted)
	claudeInAppSignInEnabled: boolean
	codexInAppSignInEnabled: boolean
	// Host cpu, memory, disk and busiest processes wherever hosts are shown (persisted)
	hostStatsEnabled: boolean

	// Bypass permissions nudge preference (persisted)
	bypassNudgeSilenced: boolean

	// App version the outdated-daemon notice was last shown for (persisted, device-only)
	lastNoticedAppVersion: string | null

	// Which minimalist interface banners were dismissed (persisted, device-only)
	minimalistBannersDismissed: MinimalistBannersDismissed

	// Fast Mode warning dialog preference (persisted)
	fastModeWarningAcknowledged: boolean
	defaultClaudeCodeEffort: ClaudeEffortLevel
	defaultCodelayerAnthropicEffort: ClaudeEffortLevel
	defaultCodelayerCodexEffort: CodexReasoningLevel
	defaultClaudeCodeFastMode: boolean
	defaultCodelayerCodexFastMode: boolean

	// Interrupt confirmation preference (persisted)
	confirmBeforeInterruptingSubAgents: boolean

	// Delete artifact confirmation preference (persisted)
	confirmBeforeDeletingArtifacts: boolean
	multiplayerPromptingLastDuration: MultiplayerPromptingDuration

	// Force-archive acknowledgement preference (persisted) — once an admin confirms
	// the one-time "Force Archive" warning, future force-archives skip the modal.
	forceArchiveAcknowledged: boolean

	// Keybinding choices (persisted, device-only)
	archiveKeybinding: ArchiveKeybinding
	sendMessageKeybinding: SendMessageKeybinding

	// Sync force mode (persisted user preference)
	syncForceMode: SyncForceMode

	// Effective settings (server-computed merge of org + user, cached locally)
	effectiveSettings: {
		experimentalSubagentsEnabled: boolean
		haikuResearchSubagentsEnabled: boolean
	}

	// Organization settings (cached locally from server)
	orgSettings: {
		experimentalSubagentsEnabled: boolean
		haikuResearchSubagentsEnabled: boolean
		jiraIntegrationEnabled: boolean
		linearIntegrationEnabled: boolean
		enableCreatingPubliclyShareableLinks: boolean
		commitTrackingEnabled: boolean
		multiplayerPromptingEnabled: boolean
	}

	// Preference actions
	initializeDefaultEditorFromEnv: () => Promise<void>
	setDefaultEditor: (editor: EditorType) => void
	setShowSessionCosts: (show: boolean) => void
	setAutoUpdateEnabled: (enabled: boolean) => void
	setNotificationSoundsEnabled: (enabled: boolean) => void
	setNotificationVolume: (volume: number) => void
	setDiffStyle: (style: DiffStyle) => void
	setDiffStyleFullscreen: (style: DiffStyle) => void
	setZoomLevel: (level: number) => void
	setZoomScrollLockEnabled: (enabled: boolean) => void
	setStreamingRenderingEnabled: (enabled: boolean) => void
	setContextWarningEnabled: (enabled: boolean) => void
	hideContextWarning: () => void

	// Server-synced settings actions
	setTheme: (theme: string) => void
	setExperimentalSubagentsEnabled: (enabled: boolean) => void
	setHaikuResearchSubagentsEnabled: (enabled: boolean) => void
	setWorkflowGraphEnabled: (enabled: boolean) => void
	setBillingPreviewEnabled: (enabled: boolean) => void
	setDiffViewerEnabled: (enabled: boolean) => void
	setScratchPadEnabled: (enabled: boolean) => void
	setGithubPrPanelEnabled: (enabled: boolean) => void
	setRoundedCornersEnabled: (enabled: boolean) => void
	setUseFoldCodingAgent: (enabled: boolean) => void
	setThinkingVerbsDisabled: (disabled: boolean) => void
	setDefaultModel: (model: ModelType) => void
	setDefaultAgent: (agent: AgentType) => void
	setDefaultClaudeCodeModel: (model: ModelType) => void
	setDaemonDrivenWorkspaceSetupEnabled: (enabled: boolean) => void
	setPreferBatchQueueDelivery: (enabled: boolean) => void
	setShowTaskPhaseLabels: (show: boolean) => void
	setProjectsV2Enabled: (enabled: boolean) => void
	setOnboardingDismissedAt: (dismissedAt: number | null) => void
	setDefaultCodelayerProvider: (provider: ProviderType) => void
	setDefaultCodelayerAnthropicModel: (model: ModelType) => void
	setDefaultCodelayerCopilotModel: (model: ModelType) => void
	setDefaultCodelayerCodexModel: (model: ModelType) => void
	setDefaultCodelayerXaiModel: (model: XaiModelOption) => void
	setDefaultCodelayerFirepassModel: (model: ModelType) => void
	setCodingAgentSetupAcknowledged: (
		hostId: string,
		variant: CodingAgentSetupVariantKey,
		acknowledged: boolean,
	) => void
	// Client-only settings actions
	setMinimalistUiEnabled: (enabled: boolean) => void
	setLocalDaemonEnabled: (enabled: boolean) => void
	setDefaultDirectory: (dir: string) => void
	setLauncherV3PermissionsMode: (mode: PermissionsMode) => void
	setLauncherV3Workflow: (workflowType: ResolvedTaskWorkflowType, autoAdvance: boolean) => void

	// Bypass nudge actions
	setBypassNudgeSilenced: (silenced: boolean) => void

	// Outdated-daemon notice actions
	setLastNoticedAppVersion: (version: string) => void
	dismissMinimalistBanner: (banner: keyof MinimalistBannersDismissed) => void

	// Fast Mode warning actions
	acknowledgeFastModeWarning: () => void
	setFastModeWarningAcknowledged: (acknowledged: boolean) => void
	setDefaultClaudeCodeEffort: (value: ClaudeEffortLevel) => void
	setDefaultCodelayerAnthropicEffort: (value: ClaudeEffortLevel) => void
	setDefaultCodelayerCodexEffort: (value: CodexReasoningLevel) => void
	setDefaultClaudeCodeFastMode: (value: boolean) => void
	setDefaultCodelayerCodexFastMode: (value: boolean) => void

	// Interrupt confirmation actions
	setConfirmBeforeInterruptingSubAgents: (value: boolean) => void

	// Delete artifact confirmation actions
	setConfirmBeforeDeletingArtifacts: (value: boolean) => void
	setMultiplayerPromptingLastDuration: (value: MultiplayerPromptingDuration) => void

	// Force-archive acknowledgement actions
	acknowledgeForceArchive: () => void

	// Keybinding actions
	setArchiveKeybinding: (binding: ArchiveKeybinding) => void
	setSendMessageKeybinding: (binding: SendMessageKeybinding) => void

	// Sync force mode actions
	setSyncForceMode: (mode: SyncForceMode) => void

	markMutationInFlight: () => void
	setServerSettingsScope: (scope: string | null) => void

	applyServerSettings: (
		response: {
			effective: {
				experimentalSubagentsEnabled: boolean
				haikuResearchSubagentsEnabled: boolean
				jiraEnabled: boolean
				linearEnabled: boolean
			}
			userSettings: {
				theme: string
				experimentalSubagentsEnabled: boolean
				haikuResearchSubagentsEnabled: boolean
				defaultModel: string
				defaultAgent: AgentType
				preferBatchQueueDelivery: boolean
				showTaskPhaseLabels: boolean
				projectsV2Enabled: boolean
				experiments: ExperimentFlags
				firstTaskCompletedAt: number | null
				firstStructuredWorkflowCompletedAt: number | null
				firstInboundCommentReceivedAt: number | null
				onboardingDismissedAt: number | null
			}
			orgSettings: {
				experimentalSubagentsEnabled: boolean
				haikuResearchSubagentsEnabled: boolean
				jiraIntegrationEnabled: boolean
				linearIntegrationEnabled: boolean
				enableCreatingPubliclyShareableLinks: boolean
				commitTrackingEnabled: boolean
				multiplayerPromptingEnabled: boolean
			}
			jiraNeedsReauth: boolean
			jiraSiteUrl: string | null
			linearNeedsReauth?: boolean
		},
		scope?: string,
	) => void
}

type PersistedSettingsState = Omit<
	Partial<
		Pick<
			SettingsState,
			| 'defaultEditor'
			| 'showSessionCosts'
			| 'autoUpdateEnabled'
			| 'notificationSoundsEnabled'
			| 'notificationVolume'
			| 'diffStyle'
			| 'diffStyleFullscreen'
			| 'zoomLevel'
			| 'zoomScrollLockEnabled'
			| 'streamingRenderingEnabled'
			| 'contextWarningEnabled'
			| 'contextWarningHiddenUntil'
			| 'jiraEnabled'
			| 'linearEnabled'
			| 'linearNeedsReauth'
			| 'jiraNeedsReauth'
			| 'jiraSiteUrl'
			| 'theme'
			| 'experimentalSubagentsEnabled'
			| 'haikuResearchSubagentsEnabled'
			| 'defaultAgent'
			| 'preferBatchQueueDelivery'
			| 'showTaskPhaseLabels'
			| 'projectsV2Enabled'
			| 'onboardingDismissedAt'
			| 'firstTaskCompletedAt'
			| 'firstStructuredWorkflowCompletedAt'
			| 'firstInboundCommentReceivedAt'
			| 'defaultClaudeCodeModel'
			| 'daemonDrivenWorkspaceSetupEnabled'
			| 'defaultCodelayerProvider'
			| 'defaultCodelayerAnthropicModel'
			| 'defaultCodelayerCopilotModel'
			| 'defaultCodelayerCodexModel'
			| 'defaultCodelayerXaiModel'
			| 'defaultCodelayerFirepassModel'
			| 'defaultDirectory'
			| 'minimalistUiEnabled'
			| 'localDaemonEnabled'
			| 'launcherV3PermissionsMode'
			| 'launcherV3WorkflowType'
			| 'launcherV3AutoAdvance'
			| 'workflowGraphEnabled'
			| 'codingAgentSetupAcknowledgements'
			| 'billingPreviewEnabled'
			| 'diffViewerEnabled'
			| 'scratchPadEnabled'
			| 'githubPrPanelEnabled'
			| 'roundedCornersEnabled'
			| 'useFoldCodingAgent'
			| 'thinkingVerbsDisabled'
			| 'agentCommandDiscoveryEnabled'
			| 'claudeInAppSignInEnabled'
			| 'codexInAppSignInEnabled'
			| 'hostStatsEnabled'
			| 'bypassNudgeSilenced'
			| 'lastNoticedAppVersion'
			| 'minimalistBannersDismissed'
			| 'fastModeWarningAcknowledged'
			| 'defaultClaudeCodeEffort'
			| 'defaultCodelayerAnthropicEffort'
			| 'defaultCodelayerCodexEffort'
			| 'defaultClaudeCodeFastMode'
			| 'defaultCodelayerCodexFastMode'
			| 'confirmBeforeInterruptingSubAgents'
			| 'multiplayerPromptingLastDuration'
			| 'forceArchiveAcknowledged'
			| 'archiveKeybinding'
			| 'sendMessageKeybinding'
			| 'syncForceMode'
			| 'effectiveSettings'
			| 'orgSettings'
		>
	>,
	'defaultModel'
> & {
	defaultModel?: string
	defaultCodelayerModel?: ModelType
	codelayerSetupAcknowledged?: boolean
}

const SETTINGS_STORAGE_KEY = 'riptide-settings'
const CLAUDE_CODE_MODELS = new Set<string>(
	getModelOptionsForAgentProvider({ agent: 'claude', provider: 'anthropic' }).map((model) => model.value),
)

export function resolveInitialClaudeCodeModel(override: string | undefined): ModelType {
	return override && CLAUDE_CODE_MODELS.has(override) ? (override as ModelType) : 'opus'
}

const initialClaudeCodeModel = resolveInitialClaudeCodeModel(
	import.meta.env.VITE_PUBLIC_DEVSTACK_OVERRIDE_DEFAULT_CLAUDE_MODEL,
)

// Match editor command name at end of path, handling quoted paths
// Examples: code, /path/to/cursor, "/Applications/Zed.app/.../zed" --wait
const EDITOR_COMMAND_PATTERN = /(?:^|[\\/])['"]?(code|cursor|zed)['"]?(?:\s|$)/i

export function mapEditorEnvToDefaultEditor(editorEnv: unknown): EditorType | null {
	if (typeof editorEnv !== 'string') return null
	const match = editorEnv.match(EDITOR_COMMAND_PATTERN)
	const command = match?.[1]
	return command ? (command.toLowerCase() as EditorType) : null
}

export function migrateSettingsState(persistedState: unknown, version: number): PersistedSettingsState {
	const nextState = (persistedState as PersistedSettingsState | undefined) ?? {}

	if (version < 2) {
		// Legacy: 'opus' was migrated to 'claude-opus-4-6' - keep this for older clients
		if (nextState.defaultModel === 'opus') {
			nextState.defaultModel = 'claude-opus-4-6'
		}
	}
	if (version < 3) {
		const validSlugs = [
			// Shorthand aliases
			'opus',
			'opus-1m',
			// Versioned models
			'claude-opus-4-8',
			'claude-opus-4-8-1m',
			'claude-opus-4-7',
			'claude-opus-4-7-1m',
			'claude-opus-4-6',
			'claude-opus-4-6-1m',
			'claude-opus-4-5',
			'sonnet',
			'haiku',
		]
		if (!validSlugs.includes(nextState.defaultModel ?? '')) {
			nextState.defaultModel = 'claude-opus-4-5'
		}
	}
	if (version < 5) {
		const anthropicModel = (nextState.defaultModel || 'claude-opus-4-5') as ModelType
		nextState.defaultClaudeCodeModel = anthropicModel
		nextState.defaultCodelayerProvider = nextState.defaultCodelayerProvider || 'anthropic'
		nextState.defaultCodelayerAnthropicModel = nextState.defaultCodelayerModel || anthropicModel
		nextState.defaultCodelayerCopilotModel = 'gpt-5.4'
		nextState.defaultCodelayerCodexModel = 'gpt-5.5'
		nextState.defaultCodelayerFirepassModel = 'accounts/fireworks/routers/kimi-k2p6-turbo'
		delete nextState.defaultCodelayerModel
	}
	if (version < 32) {
		nextState.defaultCodelayerXaiModel = DEFAULT_XAI_MODEL_ID
	}
	if (version < 6) {
		nextState.syncForceMode = nextState.syncForceMode ?? 'auto'
	}
	if (version < 7) {
		if (nextState.syncForceMode === 'query' || (nextState.syncForceMode as string) === 'secondary') {
			nextState.syncForceMode = 'auto'
		}
	}
	if (version < 9) {
		nextState.workflowGraphEnabled = nextState.workflowGraphEnabled ?? true
	}
	if (version < 10) {
		const previousSilencedValue = (nextState as PersistedSettingsState & { fastModeWarningSilenced?: boolean })
			.fastModeWarningSilenced
		nextState.fastModeWarningAcknowledged = nextState.fastModeWarningAcknowledged ?? previousSilencedValue ?? false
		nextState.defaultClaudeCodeEffort ??= DEFAULT_CLAUDE_EFFORT
		nextState.defaultCodelayerCodexEffort ??= DEFAULT_CODEX_REASONING
		nextState.defaultClaudeCodeFastMode ??= false
		nextState.defaultCodelayerCodexFastMode ??= false
	}
	if (version < 11 && nextState.defaultCodelayerCodexModel === 'gpt-5.4') {
		nextState.defaultCodelayerCodexModel = 'gpt-5.5'
	}
	if (version < 13) {
		// The Opus 1M picker variants were removed (base 4.7/4.8 already behave as 1M
		// models). Fold any persisted removed slug onto the intent-preserving 'opus'
		// shorthand. 'claude-opus-4-6-1m' is intentionally NOT removed and is preserved.
		// Note: the v3 validSlugs array above is historical and won't re-run for already
		// migrated users, so this is the active safety net for the removed slugs.
		const REMOVED_1M = new Set([
			'opus-1m',
			'claude-opus-4-8-1m',
			'claude-opus-4-7-1m',
			'claude-opus-4-8[1m]',
			'claude-opus-4-7[1m]',
		])
		if (nextState.defaultClaudeCodeModel && REMOVED_1M.has(nextState.defaultClaudeCodeModel)) {
			nextState.defaultClaudeCodeModel = 'opus'
		}
		if (nextState.defaultCodelayerAnthropicModel && REMOVED_1M.has(nextState.defaultCodelayerAnthropicModel)) {
			nextState.defaultCodelayerAnthropicModel = 'opus'
		}
		if (nextState.defaultModel && REMOVED_1M.has(nextState.defaultModel)) {
			nextState.defaultModel = 'opus'
		}
	}
	if (version < 14) {
		delete (nextState as PersistedSettingsState & { alternativeAgentsEnabled?: boolean }).alternativeAgentsEnabled
		if (nextState.defaultCodelayerProvider === 'firepass') {
			nextState.defaultCodelayerProvider = 'codex'
		}
		nextState.codelayerSetupAcknowledged ??= false
		nextState.defaultCodelayerAnthropicEffort ??= DEFAULT_CLAUDE_EFFORT
	}
	if (version < 15) {
		if (nextState.defaultCodelayerProvider === 'copilot') {
			nextState.defaultCodelayerProvider = 'codex'
		}
	}
	if (version < 16) {
		// One-time admin force-archive warning has never been shown to migrated users.
		nextState.forceArchiveAcknowledged = nextState.forceArchiveAcknowledged ?? false
		// Migrate the previous default Codex model (gpt-5.5) onto the new default.
		if (nextState.defaultCodelayerCodexModel === 'gpt-5.5') {
			nextState.defaultCodelayerCodexModel = 'gpt-5.6-sol'
		}
	}
	if (version < 18) {
		nextState.diffViewerEnabled = nextState.diffViewerEnabled ?? false
		nextState.effectiveSettings = {
			experimentalSubagentsEnabled: nextState.effectiveSettings?.experimentalSubagentsEnabled ?? true,
			haikuResearchSubagentsEnabled: nextState.effectiveSettings?.haikuResearchSubagentsEnabled ?? false,
		}
	}
	if (version < 19) {
		nextState.defaultCodelayerProvider = 'codex'
	}
	if (version < 20) {
		// Daemon-driven workspace setup ships disabled for migrated users.
		nextState.daemonDrivenWorkspaceSetupEnabled ??= false
	}
	if (version < 21) {
		const legacyState = nextState as PersistedSettingsState & {
			claudeCodeEffectRuntimeEnabled?: boolean
			effectiveSettings?: PersistedSettingsState['effectiveSettings'] & {
				claudeCodeEffectRuntimeEnabled?: boolean
			}
		}
		delete legacyState.claudeCodeEffectRuntimeEnabled
		if (legacyState.effectiveSettings) delete legacyState.effectiveSettings.claudeCodeEffectRuntimeEnabled
	}
	if (version < 24) {
		nextState.thinkingVerbsDisabled ??= false
	}
	if (version < 27) {
		delete (nextState as PersistedSettingsState & { artifactViewerV2Enabled?: boolean }).artifactViewerV2Enabled
		nextState.scratchPadEnabled ??= false
	}
	if (version < 27) {
		nextState.multiplayerPromptingLastDuration ??= '15m'
	}
	delete (nextState as PersistedSettingsState & { workflowSelectorOverride?: unknown }).workflowSelectorOverride
	delete (nextState as PersistedSettingsState & { workflowSelectorAssignments?: unknown }).workflowSelectorAssignments
	if (version < 26) nextState.launcherV3PermissionsMode ??= 'auto'
	if (version === 26 && nextState.launcherV3PermissionsMode === 'bypass') {
		nextState.launcherV3PermissionsMode = 'auto'
	}
	if (version < 28) {
		// Graduate the diff viewer out of experiments: enable it for everyone,
		// even users who had toggled the old default off. Their choice persists
		// from here on, since migrate no longer re-runs at this version.
		nextState.diffViewerEnabled = true
	}
	if (version < 29) {
		nextState.diffViewerEnabled = true
		nextState.daemonDrivenWorkspaceSetupEnabled = true
		nextState.roundedCornersEnabled ??= false
	}
	if (version < 30) {
		nextState.useFoldCodingAgent ??= false
	}
	if (version < 31) {
		nextState.launcherV3WorkflowType ??= 'outline_only'
		nextState.launcherV3AutoAdvance ??= true
	}
	if (version < 39) {
		nextState.agentCommandDiscoveryEnabled ??= true
	}
	if (version < 32) {
		nextState.archiveKeybinding ??= 'mod+e'
		nextState.sendMessageKeybinding ??= 'mod+enter'
	}
	if (version < 33) {
		// The old acknowledgement did not record either a daemon host or a backend. Preserve it only
		// for CodeLayer's Codex setup recipe. Its sentinel host is a migration fallback; all new
		// acknowledgements are written to a concrete daemon host.
		const legacyAcknowledged = nextState.codelayerSetupAcknowledged === true
		if (legacyAcknowledged) {
			const acknowledgements = nextState.codingAgentSetupAcknowledgements ?? {}
			nextState.codingAgentSetupAcknowledgements = {
				...acknowledgements,
				[LEGACY_CODING_AGENT_SETUP_HOST_ID]: { 'codelayer:codex': true },
			}
		}
		delete (nextState as PersistedSettingsState & { codelayerSetupAcknowledged?: boolean })
			.codelayerSetupAcknowledged
	}
	if (version < 34) {
		if (nextState.githubPrPanelEnabled === undefined) {
			nextState.githubPrPanelEnabled = false
		}
	}
	if (version < 35) {
		if (nextState.projectsV2Enabled === undefined) {
			nextState.projectsV2Enabled = false
		}
	}
	if (version < 38 && nextState.defaultCodelayerCodexModel === 'gpt-5.6-sol') {
		nextState.defaultCodelayerCodexModel = 'gpt-6-astra'
	}
	if (version < 40 && nextState.defaultCodelayerCodexModel === 'gpt-6-astra') {
		nextState.defaultCodelayerCodexModel = 'gpt-6.1-sol'
	}
	const legacyPromptFirst = nextState as PersistedSettingsState & {
		promptFirstTaskCreationAssignment?: unknown
		promptFirstTaskCreationAssignments?: unknown
		promptFirstTaskCreationOverride?: unknown
	}
	delete legacyPromptFirst.promptFirstTaskCreationAssignment
	delete legacyPromptFirst.promptFirstTaskCreationAssignments
	delete legacyPromptFirst.promptFirstTaskCreationOverride

	return nextState
}

export const useSettingsStore = create<SettingsState>()(
	persist(
		(set, get) => ({
			_lastMutationAt: 0,
			_serverSettingsRequestedScope: null,
			_serverSettingsAppliedScope: null,

			// User preferences with defaults
			defaultEditor: 'code',
			showSessionCosts: false,
			autoUpdateEnabled: true,
			notificationSoundsEnabled: true,
			notificationVolume: 0.2,
			diffStyle: 'unified' as DiffStyle,
			diffStyleFullscreen: 'split' as DiffStyle,
			zoomLevel: 1,
			zoomScrollLockEnabled: true,
			streamingRenderingEnabled: true,
			contextWarningEnabled: true,
			contextWarningHiddenUntil: null,

			// Linear integration state (server-synced)
			linearEnabled: false,
			linearNeedsReauth: false,

			// Jira integration state
			jiraEnabled: false,
			jiraNeedsReauth: false,
			jiraSiteUrl: null,

			// Server-synced settings with defaults
			theme: 'rose-pine',
			experimentalSubagentsEnabled: true,
			haikuResearchSubagentsEnabled: false,
			defaultModel: initialClaudeCodeModel,
			defaultAgent: 'claude' as const,
			preferBatchQueueDelivery: true,
			showTaskPhaseLabels: false,
			projectsV2Enabled: false,
			onboardingDismissedAt: null,
			firstTaskCompletedAt: null,
			firstStructuredWorkflowCompletedAt: null,
			firstInboundCommentReceivedAt: null,
			// Claude Code model default
			defaultClaudeCodeModel: initialClaudeCodeModel,
			daemonDrivenWorkspaceSetupEnabled: true,
			// Codelayer-specific defaults (per-provider)
			defaultCodelayerProvider: 'codex' as const,
			defaultCodelayerAnthropicModel: 'claude-opus-4-5' as const,
			defaultCodelayerCopilotModel: 'gpt-5.4' as const,
			defaultCodelayerCodexModel: 'gpt-6.1-sol' as const,
			defaultCodelayerXaiModel: DEFAULT_XAI_MODEL_ID,
			defaultCodelayerFirepassModel: 'accounts/fireworks/routers/kimi-k2p6-turbo' as const,
			defaultDirectory: '~/',
			// On for new devices. Stored values keep existing users on the interface they had.
			minimalistUiEnabled: true,
			localDaemonEnabled: true,
			launcherV3PermissionsMode: 'auto',
			launcherV3WorkflowType: 'outline_only',
			launcherV3AutoAdvance: true,
			workflowGraphEnabled: true,
			codingAgentSetupAcknowledgements: {},
			billingPreviewEnabled: false,
			diffViewerEnabled: true,
			scratchPadEnabled: false,
			githubPrPanelEnabled: false,
			roundedCornersEnabled: false,
			useFoldCodingAgent: false,
			thinkingVerbsDisabled: false,
			agentCommandDiscoveryEnabled: true,
			claudeInAppSignInEnabled: false,
			codexInAppSignInEnabled: false,
			hostStatsEnabled: false,
			bypassNudgeSilenced: false,
			lastNoticedAppVersion: null,
			minimalistBannersDismissed: { beta: false, tryIt: false },
			fastModeWarningAcknowledged: false,
			defaultClaudeCodeEffort: DEFAULT_CLAUDE_EFFORT,
			defaultCodelayerAnthropicEffort: DEFAULT_CLAUDE_EFFORT,
			defaultCodelayerCodexEffort: DEFAULT_CODEX_REASONING,
			defaultClaudeCodeFastMode: false,
			defaultCodelayerCodexFastMode: false,
			confirmBeforeInterruptingSubAgents: true,
			confirmBeforeDeletingArtifacts: true,
			multiplayerPromptingLastDuration: '15m',
			forceArchiveAcknowledged: false,
			archiveKeybinding: 'mod+e',
			sendMessageKeybinding: 'mod+enter',
			syncForceMode: 'auto',
			effectiveSettings: {
				experimentalSubagentsEnabled: true,
				haikuResearchSubagentsEnabled: false,
			},
			orgSettings: {
				experimentalSubagentsEnabled: true,
				haikuResearchSubagentsEnabled: true,
				jiraIntegrationEnabled: false,
				linearIntegrationEnabled: false,
				enableCreatingPubliclyShareableLinks: true,
				commitTrackingEnabled: false,
				multiplayerPromptingEnabled: false,
			},

			// Preference actions
			initializeDefaultEditorFromEnv: async () => {
				if (localStorage.getItem(SETTINGS_STORAGE_KEY)) return
				const defaultEditor = mapEditorEnvToDefaultEditor(await getEditorEnvironment())
				if (defaultEditor) set({ defaultEditor })
			},
			setDefaultEditor: (editor) => set({ defaultEditor: editor }),
			setShowSessionCosts: (show) => set({ showSessionCosts: show }),
			setAutoUpdateEnabled: (enabled) => set({ autoUpdateEnabled: enabled }),
			setNotificationSoundsEnabled: (enabled) => set({ notificationSoundsEnabled: enabled }),
			setNotificationVolume: (volume) => set({ notificationVolume: volume }),
			setDiffStyle: (style) => set({ diffStyle: style }),
			setDiffStyleFullscreen: (style) => set({ diffStyleFullscreen: style }),
			setZoomLevel: (level) => set({ zoomLevel: level }),
			setZoomScrollLockEnabled: (enabled) => set({ zoomScrollLockEnabled: enabled }),
			setStreamingRenderingEnabled: (enabled) => set({ streamingRenderingEnabled: enabled }),
			setContextWarningEnabled: (enabled) =>
				set({ contextWarningEnabled: enabled, contextWarningHiddenUntil: null }),
			hideContextWarning: () => set({ contextWarningHiddenUntil: Date.now() + CONTEXT_WARNING_HIDE_MS }),

			// Server-synced settings actions
			setTheme: (theme) => set({ theme }),
			setExperimentalSubagentsEnabled: (enabled) => set({ experimentalSubagentsEnabled: enabled }),
			setHaikuResearchSubagentsEnabled: (enabled) => set({ haikuResearchSubagentsEnabled: enabled }),
			setWorkflowGraphEnabled: (enabled) => set({ workflowGraphEnabled: enabled }),
			setBillingPreviewEnabled: (enabled) => set({ billingPreviewEnabled: enabled }),
			setDiffViewerEnabled: (enabled) => set({ diffViewerEnabled: enabled }),
			setScratchPadEnabled: (enabled) => set({ scratchPadEnabled: enabled }),
			setGithubPrPanelEnabled: (enabled) => set({ githubPrPanelEnabled: enabled }),
			setRoundedCornersEnabled: (enabled) => set({ roundedCornersEnabled: enabled }),
			setUseFoldCodingAgent: (enabled) => set({ useFoldCodingAgent: enabled }),
			setThinkingVerbsDisabled: (disabled) => set({ thinkingVerbsDisabled: disabled }),
			setDefaultModel: (model) => set({ defaultModel: model }),
			setDefaultAgent: (agent) => set({ defaultAgent: agent }),
			setDefaultClaudeCodeModel: (model) => set({ defaultClaudeCodeModel: model }),
			setDaemonDrivenWorkspaceSetupEnabled: (enabled) => set({ daemonDrivenWorkspaceSetupEnabled: enabled }),
			setPreferBatchQueueDelivery: (enabled) => set({ preferBatchQueueDelivery: enabled }),
			setShowTaskPhaseLabels: (show) => set({ showTaskPhaseLabels: show }),
			setProjectsV2Enabled: (enabled) => set({ projectsV2Enabled: enabled }),
			setOnboardingDismissedAt: (dismissedAt) => set({ onboardingDismissedAt: dismissedAt }),
			setDefaultCodelayerProvider: (provider) => set({ defaultCodelayerProvider: provider }),
			setDefaultCodelayerAnthropicModel: (model) => set({ defaultCodelayerAnthropicModel: model }),
			setDefaultCodelayerCopilotModel: (model) => set({ defaultCodelayerCopilotModel: model }),
			setDefaultCodelayerCodexModel: (model) => set({ defaultCodelayerCodexModel: model }),
			setDefaultCodelayerXaiModel: (model) => set({ defaultCodelayerXaiModel: model }),
			setDefaultCodelayerFirepassModel: (model) => set({ defaultCodelayerFirepassModel: model }),
			setCodingAgentSetupAcknowledged: (hostId, variant, acknowledged) =>
				set((state) => ({
					codingAgentSetupAcknowledgements: {
						...state.codingAgentSetupAcknowledgements,
						[hostId]: {
							...state.codingAgentSetupAcknowledgements[hostId],
							[variant]: acknowledged,
						},
					},
				})),
			// Client-only settings actions
			setMinimalistUiEnabled: (enabled) => set({ minimalistUiEnabled: enabled }),
			setLocalDaemonEnabled: (enabled) => set({ localDaemonEnabled: enabled }),
			setDefaultDirectory: (dir) => set({ defaultDirectory: dir }),
			setLauncherV3PermissionsMode: (mode) => set({ launcherV3PermissionsMode: mode }),
			setLauncherV3Workflow: (workflowType, autoAdvance) =>
				set({ launcherV3WorkflowType: workflowType, launcherV3AutoAdvance: autoAdvance }),
			setBypassNudgeSilenced: (silenced) => set({ bypassNudgeSilenced: silenced }),
			setLastNoticedAppVersion: (version) => set({ lastNoticedAppVersion: version }),
			dismissMinimalistBanner: (banner) =>
				set((state) => ({
					minimalistBannersDismissed: { ...state.minimalistBannersDismissed, [banner]: true },
				})),
			acknowledgeFastModeWarning: () => set({ fastModeWarningAcknowledged: true }),
			setFastModeWarningAcknowledged: (acknowledged) => set({ fastModeWarningAcknowledged: acknowledged }),
			setDefaultClaudeCodeEffort: (value) => set({ defaultClaudeCodeEffort: value }),
			setDefaultCodelayerAnthropicEffort: (value) => set({ defaultCodelayerAnthropicEffort: value }),
			setDefaultCodelayerCodexEffort: (value) => set({ defaultCodelayerCodexEffort: value }),
			setDefaultClaudeCodeFastMode: (value) => set({ defaultClaudeCodeFastMode: value }),
			setDefaultCodelayerCodexFastMode: (value) => set({ defaultCodelayerCodexFastMode: value }),
			setConfirmBeforeInterruptingSubAgents: (value) => set({ confirmBeforeInterruptingSubAgents: value }),
			setConfirmBeforeDeletingArtifacts: (value) => set({ confirmBeforeDeletingArtifacts: value }),
			setMultiplayerPromptingLastDuration: (value) => set({ multiplayerPromptingLastDuration: value }),
			acknowledgeForceArchive: () => set({ forceArchiveAcknowledged: true }),
			setArchiveKeybinding: (binding) => set({ archiveKeybinding: binding }),
			setSendMessageKeybinding: (binding) => set({ sendMessageKeybinding: binding }),
			setSyncForceMode: (mode) => set({ syncForceMode: mode }),
			markMutationInFlight: () => set({ _lastMutationAt: Date.now() }),
			setServerSettingsScope: (scope) => {
				if (get()._serverSettingsRequestedScope === scope) return
				set({ _serverSettingsRequestedScope: scope, _serverSettingsAppliedScope: null })
			},
			applyServerSettings: (response, scope) => {
				if (scope !== undefined && scope !== get()._serverSettingsRequestedScope) return
				const MUTATION_GUARD_MS = 5_000
				const skipServerSyncedFields = Date.now() - get()._lastMutationAt < MUTATION_GUARD_MS
				const serverDefaultModel = (response.userSettings.defaultModel as ModelType) ?? 'opus'

				const settings: Partial<SettingsState> = {
					effectiveSettings: {
						experimentalSubagentsEnabled: response.effective.experimentalSubagentsEnabled,
						haikuResearchSubagentsEnabled: response.effective.haikuResearchSubagentsEnabled,
					},
					orgSettings: {
						experimentalSubagentsEnabled: response.orgSettings.experimentalSubagentsEnabled,
						haikuResearchSubagentsEnabled: response.orgSettings.haikuResearchSubagentsEnabled,
						jiraIntegrationEnabled: response.orgSettings.jiraIntegrationEnabled,
						linearIntegrationEnabled: response.orgSettings.linearIntegrationEnabled,
						enableCreatingPubliclyShareableLinks: response.orgSettings.enableCreatingPubliclyShareableLinks,
						commitTrackingEnabled: response.orgSettings.commitTrackingEnabled,
						multiplayerPromptingEnabled: response.orgSettings.multiplayerPromptingEnabled,
					},
					jiraEnabled: response.effective.jiraEnabled,
					linearEnabled: response.effective.linearEnabled,
					jiraNeedsReauth: response.jiraNeedsReauth,
					jiraSiteUrl: response.jiraSiteUrl,
				}
				if (scope !== undefined) {
					settings.firstTaskCompletedAt = response.userSettings.firstTaskCompletedAt
					settings.firstStructuredWorkflowCompletedAt =
						response.userSettings.firstStructuredWorkflowCompletedAt
					settings.firstInboundCommentReceivedAt = response.userSettings.firstInboundCommentReceivedAt
					settings._serverSettingsAppliedScope = scope
				}
				if (!skipServerSyncedFields) {
					settings.theme = response.userSettings.theme
					settings.experimentalSubagentsEnabled = response.userSettings.experimentalSubagentsEnabled
					settings.haikuResearchSubagentsEnabled = response.userSettings.haikuResearchSubagentsEnabled
					settings.defaultModel = serverDefaultModel
					settings.defaultClaudeCodeModel = serverDefaultModel
					settings.defaultAgent = (response.userSettings.defaultAgent as AgentType) ?? 'claude'
					settings.preferBatchQueueDelivery = response.userSettings.preferBatchQueueDelivery ?? true
					settings.showTaskPhaseLabels = response.userSettings.showTaskPhaseLabels ?? false
					settings.projectsV2Enabled = response.userSettings.projectsV2Enabled
					if (scope !== undefined)
						settings.onboardingDismissedAt = response.userSettings.onboardingDismissedAt
					Object.assign(settings, response.userSettings.experiments)
				}
				if (response.linearNeedsReauth !== undefined) {
					settings.linearNeedsReauth = response.linearNeedsReauth
				}
				set(settings)
			},
		}),
		{
			name: SETTINGS_STORAGE_KEY,
			version: 40,
			migrate: migrateSettingsState,
			// Persist user preferences
			partialize: (state) => ({
				defaultEditor: state.defaultEditor,
				showSessionCosts: state.showSessionCosts,
				autoUpdateEnabled: state.autoUpdateEnabled,
				notificationSoundsEnabled: state.notificationSoundsEnabled,
				notificationVolume: state.notificationVolume,
				diffStyle: state.diffStyle,
				diffStyleFullscreen: state.diffStyleFullscreen,
				zoomLevel: state.zoomLevel,
				zoomScrollLockEnabled: state.zoomScrollLockEnabled,
				streamingRenderingEnabled: state.streamingRenderingEnabled,
				contextWarningEnabled: state.contextWarningEnabled,
				contextWarningHiddenUntil: state.contextWarningHiddenUntil,
				jiraEnabled: state.jiraEnabled,
				linearEnabled: state.linearEnabled,
				linearNeedsReauth: state.linearNeedsReauth,
				jiraNeedsReauth: state.jiraNeedsReauth,
				jiraSiteUrl: state.jiraSiteUrl,
				theme: state.theme,
				experimentalSubagentsEnabled: state.experimentalSubagentsEnabled,
				haikuResearchSubagentsEnabled: state.haikuResearchSubagentsEnabled,
				defaultModel: state.defaultModel,
				defaultAgent: state.defaultAgent,
				preferBatchQueueDelivery: state.preferBatchQueueDelivery,
				showTaskPhaseLabels: state.showTaskPhaseLabels,
				projectsV2Enabled: state.projectsV2Enabled,
				onboardingDismissedAt: state.onboardingDismissedAt,
				firstTaskCompletedAt: state.firstTaskCompletedAt,
				firstStructuredWorkflowCompletedAt: state.firstStructuredWorkflowCompletedAt,
				firstInboundCommentReceivedAt: state.firstInboundCommentReceivedAt,
				defaultClaudeCodeModel: state.defaultClaudeCodeModel,
				daemonDrivenWorkspaceSetupEnabled: state.daemonDrivenWorkspaceSetupEnabled,
				defaultCodelayerProvider: state.defaultCodelayerProvider,
				defaultCodelayerAnthropicModel: state.defaultCodelayerAnthropicModel,
				defaultCodelayerCopilotModel: state.defaultCodelayerCopilotModel,
				defaultCodelayerCodexModel: state.defaultCodelayerCodexModel,
				defaultCodelayerXaiModel: state.defaultCodelayerXaiModel,
				defaultCodelayerFirepassModel: state.defaultCodelayerFirepassModel,
				defaultDirectory: state.defaultDirectory,
				minimalistUiEnabled: state.minimalistUiEnabled,
				localDaemonEnabled: state.localDaemonEnabled,
				launcherV3PermissionsMode: state.launcherV3PermissionsMode,
				launcherV3WorkflowType: state.launcherV3WorkflowType,
				launcherV3AutoAdvance: state.launcherV3AutoAdvance,
				workflowGraphEnabled: state.workflowGraphEnabled,
				codingAgentSetupAcknowledgements: state.codingAgentSetupAcknowledgements,
				billingPreviewEnabled: state.billingPreviewEnabled,
				diffViewerEnabled: state.diffViewerEnabled,
				scratchPadEnabled: state.scratchPadEnabled,
				githubPrPanelEnabled: state.githubPrPanelEnabled,
				roundedCornersEnabled: state.roundedCornersEnabled,
				useFoldCodingAgent: state.useFoldCodingAgent,
				thinkingVerbsDisabled: state.thinkingVerbsDisabled,
				agentCommandDiscoveryEnabled: state.agentCommandDiscoveryEnabled,
				claudeInAppSignInEnabled: state.claudeInAppSignInEnabled,
				codexInAppSignInEnabled: state.codexInAppSignInEnabled,
				hostStatsEnabled: state.hostStatsEnabled,
				bypassNudgeSilenced: state.bypassNudgeSilenced,
				lastNoticedAppVersion: state.lastNoticedAppVersion,
				minimalistBannersDismissed: state.minimalistBannersDismissed,
				fastModeWarningAcknowledged: state.fastModeWarningAcknowledged,
				defaultClaudeCodeEffort: state.defaultClaudeCodeEffort,
				defaultCodelayerAnthropicEffort: state.defaultCodelayerAnthropicEffort,
				defaultCodelayerCodexEffort: state.defaultCodelayerCodexEffort,
				defaultClaudeCodeFastMode: state.defaultClaudeCodeFastMode,
				defaultCodelayerCodexFastMode: state.defaultCodelayerCodexFastMode,
				confirmBeforeInterruptingSubAgents: state.confirmBeforeInterruptingSubAgents,
				confirmBeforeDeletingArtifacts: state.confirmBeforeDeletingArtifacts,
				multiplayerPromptingLastDuration: state.multiplayerPromptingLastDuration,
				forceArchiveAcknowledged: state.forceArchiveAcknowledged,
				archiveKeybinding: state.archiveKeybinding,
				sendMessageKeybinding: state.sendMessageKeybinding,
				syncForceMode: state.syncForceMode,
				effectiveSettings: state.effectiveSettings,
				orgSettings: state.orgSettings,
			}),
		},
	),
)
