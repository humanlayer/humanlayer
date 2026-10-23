import { DEFAULT_CLAUDE_EFFORT, DEFAULT_CODEX_REASONING } from '@humanlayer/ai/config'
import { describe, expect, test } from 'vitest'

import {
	LEGACY_CODING_AGENT_SETUP_HOST_ID,
	isCodingAgentSetupAcknowledged,
	CODING_AGENT_SETUP_VARIANTS,
} from '@/lib/coding-agent-setup'

import {
	mapEditorEnvToDefaultEditor,
	migrateSettingsState,
	resolveInitialClaudeCodeModel,
	useSettingsStore,
} from '../settingsStore'

describe('resolveInitialClaudeCodeModel', () => {
	test('uses a valid devstack override for the first default', () => {
		expect(resolveInitialClaudeCodeModel('haiku')).toBe('haiku')
	})

	test('falls back to Opus when the override is absent or invalid', () => {
		expect(resolveInitialClaudeCodeModel(undefined)).toBe('opus')
		expect(resolveInitialClaudeCodeModel('gpt-5.6-sol')).toBe('opus')
		expect(resolveInitialClaudeCodeModel('not-a-model')).toBe('opus')
	})
})

describe('settingsStore fresh defaults', () => {
	test('enables both local rollout preferences for a fresh store', () => {
		// A fresh store has no persisted record, so getState reflects the declared
		// defaults. Both rollout experiments start enabled at v29.
		const state = useSettingsStore.getState()
		expect(state.diffViewerEnabled).toBe(true)
		expect(state.daemonDrivenWorkspaceSetupEnabled).toBe(true)
		expect(state.useFoldCodingAgent).toBe(false)
		expect(state.projectsV2Enabled).toBe(false)
		expect(state.defaultCodelayerCodexModel).toBe('gpt-6.1-sol')
	})

	test('defaults both keybindings to the modifier variants for a fresh store', () => {
		const state = useSettingsStore.getState()
		expect(state.archiveKeybinding).toBe('mod+e')
		expect(state.sendMessageKeybinding).toBe('mod+enter')
	})
})

describe('settingsStore keybinding setters', () => {
	test('setArchiveKeybinding updates the archive binding', () => {
		useSettingsStore.getState().setArchiveKeybinding('e')
		expect(useSettingsStore.getState().archiveKeybinding).toBe('e')
		useSettingsStore.getState().setArchiveKeybinding('mod+e')
		expect(useSettingsStore.getState().archiveKeybinding).toBe('mod+e')
	})

	test('setSendMessageKeybinding updates the send binding', () => {
		useSettingsStore.getState().setSendMessageKeybinding('enter')
		expect(useSettingsStore.getState().sendMessageKeybinding).toBe('enter')
		useSettingsStore.getState().setSendMessageKeybinding('mod+enter')
		expect(useSettingsStore.getState().sendMessageKeybinding).toBe('mod+enter')
	})

	test('both keybindings appear in the persisted subset', () => {
		const partialize = useSettingsStore.persist.getOptions().partialize
		const persisted = partialize?.(useSettingsStore.getState()) as Record<string, unknown>
		expect(persisted.archiveKeybinding).toBe('mod+e')
		expect(persisted.sendMessageKeybinding).toBe('mod+enter')
	})
})

describe('settingsStore migration', () => {
	test('defaults the Fold Coding Agent experiment off at v30', () => {
		expect(migrateSettingsState({}, 29).useFoldCodingAgent).toBe(false)
		expect(migrateSettingsState({ useFoldCodingAgent: true }, 29).useFoldCodingAgent).toBe(true)
	})

	test('defaults Projects V2 off at v35 and preserves an existing opt-in', () => {
		expect(migrateSettingsState({}, 34).projectsV2Enabled).toBe(false)
		expect(migrateSettingsState({ projectsV2Enabled: true }, 34).projectsV2Enabled).toBe(true)
	})

	test('hydrates v9 fast mode and effort defaults into v10 state', () => {
		const state = migrateSettingsState(
			{
				defaultClaudeCodeModel: 'claude-opus-4-7',
				defaultCodelayerProvider: 'codex',
				defaultCodelayerCodexModel: 'gpt-5.4',
			},
			9,
		)

		expect(state.fastModeWarningAcknowledged).toBe(false)
		expect(state.defaultClaudeCodeEffort).toBe(DEFAULT_CLAUDE_EFFORT)
		expect(state.defaultCodelayerCodexEffort).toBe(DEFAULT_CODEX_REASONING)
		expect(state.defaultClaudeCodeFastMode).toBe(false)
		expect(state.defaultCodelayerCodexFastMode).toBe(false)
		expect(state.defaultCodelayerCodexModel).toBe('gpt-6.1-sol')
	})

	test('preserves existing v10 default values when already set', () => {
		const state = migrateSettingsState(
			{
				fastModeWarningAcknowledged: true,
				defaultClaudeCodeEffort: 'xhigh',
				defaultCodelayerCodexEffort: 'high',
				defaultClaudeCodeFastMode: true,
				defaultCodelayerCodexFastMode: true,
			},
			10,
		)

		expect(state.fastModeWarningAcknowledged).toBe(true)
		expect(state.defaultClaudeCodeEffort).toBe('xhigh')
		expect(state.defaultCodelayerCodexEffort).toBe('high')
		expect(state.defaultClaudeCodeFastMode).toBe(true)
		expect(state.defaultCodelayerCodexFastMode).toBe(true)
	})

	test('migrates old default Codex models through to GPT-6.1 Sol', () => {
		const state = migrateSettingsState(
			{
				defaultCodelayerCodexModel: 'gpt-5.4',
			},
			10,
		)

		expect(state.defaultCodelayerCodexModel).toBe('gpt-6.1-sol')
	})

	test('migrates the previous default Codex model through to GPT-6.1 Sol', () => {
		const state = migrateSettingsState(
			{
				defaultCodelayerCodexModel: 'gpt-5.5',
			},
			15,
		)

		expect(state.defaultCodelayerCodexModel).toBe('gpt-6.1-sol')
	})

	test('migrates the previous GPT-5.6 Sol default through to GPT-6.1 Sol', () => {
		expect(migrateSettingsState({ defaultCodelayerCodexModel: 'gpt-5.6-sol' }, 37).defaultCodelayerCodexModel).toBe(
			'gpt-6.1-sol',
		)
	})

	test('migrates the previous GPT-6 Astra default to GPT-6.1 Sol at v40', () => {
		expect(migrateSettingsState({ defaultCodelayerCodexModel: 'gpt-6-astra' }, 39).defaultCodelayerCodexModel).toBe(
			'gpt-6.1-sol',
		)
	})

	test('preserves explicitly selected GPT-6 Codex variants at v40', () => {
		expect(migrateSettingsState({ defaultCodelayerCodexModel: 'gpt-6-sol' }, 39).defaultCodelayerCodexModel).toBe(
			'gpt-6-sol',
		)
	})

	test('preserves explicitly selected Codex variants at v38', () => {
		expect(
			migrateSettingsState({ defaultCodelayerCodexModel: 'gpt-5.6-terra' }, 37).defaultCodelayerCodexModel,
		).toBe('gpt-5.6-terra')
	})

	test('preserves explicitly selected older Codex models at v16', () => {
		const state = migrateSettingsState(
			{
				defaultCodelayerCodexModel: 'gpt-5.4',
			},
			15,
		)

		expect(state.defaultCodelayerCodexModel).toBe('gpt-5.4')
	})

	test('migrates removed Opus 1M slugs to opus at v13', () => {
		const state = migrateSettingsState(
			{
				defaultClaudeCodeModel: 'opus-1m',
				defaultCodelayerAnthropicModel: 'claude-opus-4-8-1m',
				defaultModel: 'claude-opus-4-7-1m',
			},
			12,
		)

		expect(state.defaultClaudeCodeModel).toBe('opus')
		expect(state.defaultCodelayerAnthropicModel).toBe('opus')
		expect(state.defaultModel).toBe('opus')
	})

	test('migrates removed Opus 1M bracket slugs to opus at v13', () => {
		const state = migrateSettingsState(
			{
				defaultClaudeCodeModel: 'claude-opus-4-8[1m]',
				defaultCodelayerAnthropicModel: 'claude-opus-4-7[1m]',
			},
			12,
		)

		expect(state.defaultClaudeCodeModel).toBe('opus')
		expect(state.defaultCodelayerAnthropicModel).toBe('opus')
	})

	test('leaves surviving claude-opus-4-6-1m untouched at v13', () => {
		const state = migrateSettingsState(
			{
				defaultClaudeCodeModel: 'claude-opus-4-6-1m',
				defaultCodelayerAnthropicModel: 'claude-opus-4-6-1m',
			},
			12,
		)

		expect(state.defaultClaudeCodeModel).toBe('claude-opus-4-6-1m')
		expect(state.defaultCodelayerAnthropicModel).toBe('claude-opus-4-6-1m')
	})

	test('removes stale alternative agent flag at v14', () => {
		const state = migrateSettingsState(
			{
				alternativeAgentsEnabled: true,
			},
			13,
		)

		expect('alternativeAgentsEnabled' in state).toBe(false)
	})

	test('remaps Firepass default provider to Codex at v14', () => {
		const state = migrateSettingsState(
			{
				defaultCodelayerProvider: 'firepass',
				defaultCodelayerFirepassModel: 'accounts/fireworks/routers/kimi-k2p6-turbo',
			},
			13,
		)

		expect(state.defaultCodelayerProvider).toBe('codex')
		expect(state.defaultCodelayerFirepassModel).toBe('accounts/fireworks/routers/kimi-k2p6-turbo')
	})

	test('migrates the legacy CodeLayer acknowledgement only to CodeLayer Codex', () => {
		const state = migrateSettingsState({ codelayerSetupAcknowledged: true }, 32)
		const host = { id: 'host-1', name: 'Test host', isColocated: true }

		expect(state.codingAgentSetupAcknowledgements).toEqual({
			[LEGACY_CODING_AGENT_SETUP_HOST_ID]: { 'codelayer:codex': true },
		})
		expect(
			isCodingAgentSetupAcknowledged(state.codingAgentSetupAcknowledgements ?? {}, {
				variant: CODING_AGENT_SETUP_VARIANTS['codelayer:codex'],
				host,
			}),
		).toBe(true)
		expect(
			isCodingAgentSetupAcknowledged(state.codingAgentSetupAcknowledgements ?? {}, {
				variant: CODING_AGENT_SETUP_VARIANTS['fold:codex'],
				host,
			}),
		).toBe(false)
		expect(
			isCodingAgentSetupAcknowledged(state.codingAgentSetupAcknowledgements ?? {}, {
				variant: CODING_AGENT_SETUP_VARIANTS['fold:xai'],
				host,
			}),
		).toBe(false)
	})

	test('remaps Copilot default provider to Codex at v15', () => {
		const state = migrateSettingsState(
			{
				defaultCodelayerProvider: 'copilot',
			},
			14,
		)

		expect(state.defaultCodelayerProvider).toBe('codex')
	})

	test('seeds the force-archive acknowledgement as false at v16', () => {
		const state = migrateSettingsState({}, 15)
		expect(state.forceArchiveAcknowledged).toBe(false)
	})

	test('preserves an already-acknowledged force-archive warning at v16', () => {
		const state = migrateSettingsState({ forceArchiveAcknowledged: true }, 15)
		expect(state.forceArchiveAcknowledged).toBe(true)
	})

	test('force-enables daemon-driven workspace setup when migrating from before v29', () => {
		const state = migrateSettingsState({}, 19)
		expect(state.daemonDrivenWorkspaceSetupEnabled).toBe(true)
	})

	test('force-enables daemon-driven workspace setup even if a user had turned it off pre-v29', () => {
		const state = migrateSettingsState({ daemonDrivenWorkspaceSetupEnabled: false }, 28)
		expect(state.daemonDrivenWorkspaceSetupEnabled).toBe(true)
	})

	test('leaves daemon-driven workspace setup alone once migrated to v29', () => {
		const state = migrateSettingsState({ daemonDrivenWorkspaceSetupEnabled: false }, 29)
		expect(state.daemonDrivenWorkspaceSetupEnabled).toBe(false)
	})

	test('graduates the diff viewer to enabled when migrating from before v29', () => {
		const state = migrateSettingsState({}, 17)
		expect(state.diffViewerEnabled).toBe(true)
	})

	test('force-enables the diff viewer even if a user had turned it off pre-v29', () => {
		const state = migrateSettingsState({ diffViewerEnabled: false }, 28)
		expect(state.diffViewerEnabled).toBe(true)
	})

	test('leaves the diff viewer toggle alone once migrated to v29', () => {
		const state = migrateSettingsState({ diffViewerEnabled: false }, 29)
		expect(state.diffViewerEnabled).toBe(false)
	})

	test('defaults the rounded corners experiment off at v29', () => {
		expect(migrateSettingsState({}, 28).roundedCornersEnabled).toBe(false)
	})

	test('preserves the rounded corners experiment once enabled', () => {
		expect(migrateSettingsState({ roundedCornersEnabled: true }, 28).roundedCornersEnabled).toBe(true)
	})

	test('seeds v18 diff settings without dropping effective defaults', () => {
		const state = migrateSettingsState({}, 17)

		expect(state.effectiveSettings).toEqual({
			experimentalSubagentsEnabled: true,
			haikuResearchSubagentsEnabled: false,
		})
	})

	test('removes stale Effect runtime keys at v21 while preserving other settings', () => {
		const state = migrateSettingsState(
			{
				claudeCodeEffectRuntimeEnabled: true,
				defaultEditor: 'zed',
				effectiveSettings: {
					experimentalSubagentsEnabled: false,
					claudeCodeEffectRuntimeEnabled: true,
					haikuResearchSubagentsEnabled: true,
				},
			},
			20,
		)

		expect(state).toEqual({
			agentCommandDiscoveryEnabled: true,
			archiveKeybinding: 'mod+e',
			daemonDrivenWorkspaceSetupEnabled: true,
			defaultCodelayerXaiModel: 'grok-4.6',
			defaultEditor: 'zed',
			diffViewerEnabled: true,
			sendMessageKeybinding: 'mod+enter',
			effectiveSettings: {
				experimentalSubagentsEnabled: false,
				haikuResearchSubagentsEnabled: true,
			},
			multiplayerPromptingLastDuration: '15m',
			githubPrPanelEnabled: false,
			projectsV2Enabled: false,
			roundedCornersEnabled: false,
			scratchPadEnabled: false,
			thinkingVerbsDisabled: false,
			useFoldCodingAgent: false,
			launcherV3PermissionsMode: 'auto',
			launcherV3WorkflowType: 'outline_only',
			launcherV3AutoAdvance: true,
		})
	})

	test('composes the pre-v29 rollout with the v21 stale key cleanup', () => {
		const state = migrateSettingsState(
			{
				claudeCodeEffectRuntimeEnabled: true,
				effectiveSettings: {
					experimentalSubagentsEnabled: false,
					claudeCodeEffectRuntimeEnabled: true,
					haikuResearchSubagentsEnabled: true,
				},
			},
			19,
		)

		expect(state).toEqual({
			agentCommandDiscoveryEnabled: true,
			archiveKeybinding: 'mod+e',
			daemonDrivenWorkspaceSetupEnabled: true,
			defaultCodelayerXaiModel: 'grok-4.6',
			diffViewerEnabled: true,
			sendMessageKeybinding: 'mod+enter',
			effectiveSettings: {
				experimentalSubagentsEnabled: false,
				haikuResearchSubagentsEnabled: true,
			},
			multiplayerPromptingLastDuration: '15m',
			githubPrPanelEnabled: false,
			projectsV2Enabled: false,
			roundedCornersEnabled: false,
			scratchPadEnabled: false,
			thinkingVerbsDisabled: false,
			useFoldCodingAgent: false,
			launcherV3PermissionsMode: 'auto',
			launcherV3WorkflowType: 'outline_only',
			launcherV3AutoAdvance: true,
		})
	})

	test('keeps the rotating loader verbs at v22', () => {
		const state = migrateSettingsState({}, 21)
		expect(state.thinkingVerbsDisabled).toBe(false)
	})

	test('preserves disabled thinking verbs at v22', () => {
		const state = migrateSettingsState({ thinkingVerbsDisabled: true }, 21)
		expect(state.thinkingVerbsDisabled).toBe(true)
	})

	test('removes graduated task creation and workflow selector experiment state', () => {
		const assignment = { variant: 'v3_composer' as const, assignedAt: 42 }
		const state = migrateSettingsState(
			{
				promptFirstTaskCreationAssignments: { user: assignment },
				workflowSelectorOverride: 'force-on',
				workflowSelectorAssignments: { user: assignment },
			},
			23,
		)

		expect('promptFirstTaskCreationAssignments' in state).toBe(false)
		expect('promptFirstTaskCreationOverride' in state).toBe(false)
		expect('workflowSelectorOverride' in state).toBe(false)
		expect('workflowSelectorAssignments' in state).toBe(false)
	})

	test('removes saved task creation assignments and opt-outs', () => {
		const state = migrateSettingsState(
			{
				promptFirstTaskCreationAssignments: {
					control: { variant: 'v2_form', assignedAt: 42 },
					treatment: { variant: 'v3_composer', assignedAt: 84 },
				},
				promptFirstTaskCreationOverride: 'force-off',
			},
			33,
		)

		expect('promptFirstTaskCreationAssignments' in state).toBe(false)
		expect('promptFirstTaskCreationOverride' in state).toBe(false)
	})

	test('seeds and preserves the launcher permission mode at v26', () => {
		expect(migrateSettingsState({}, 25).launcherV3PermissionsMode).toBe('auto')
		expect(migrateSettingsState({ launcherV3PermissionsMode: 'accept_edits' }, 25).launcherV3PermissionsMode).toBe(
			'accept_edits',
		)
	})

	test('replaces the unreleased v26 bypass default with auto', () => {
		expect(migrateSettingsState({ launcherV3PermissionsMode: 'bypass' }, 26).launcherV3PermissionsMode).toBe('auto')
		expect(migrateSettingsState({ launcherV3PermissionsMode: 'accept_edits' }, 26).launcherV3PermissionsMode).toBe(
			'accept_edits',
		)
	})

	test('seeds and preserves the launcher workflow at v31', () => {
		expect(migrateSettingsState({}, 30)).toMatchObject({
			launcherV3WorkflowType: 'outline_only',
			launcherV3AutoAdvance: true,
		})
		expect(
			migrateSettingsState({ launcherV3WorkflowType: 'prd_tdd', launcherV3AutoAdvance: false }, 30),
		).toMatchObject({
			launcherV3WorkflowType: 'prd_tdd',
			launcherV3AutoAdvance: false,
		})
	})

	test('seeds keybinding defaults when migrating v31 state at v32', () => {
		expect(migrateSettingsState({}, 31)).toMatchObject({
			archiveKeybinding: 'mod+e',
			sendMessageKeybinding: 'mod+enter',
		})
	})

	test('preserves chosen keybindings when migrating at v32', () => {
		expect(migrateSettingsState({ archiveKeybinding: 'e', sendMessageKeybinding: 'enter' }, 31)).toMatchObject({
			archiveKeybinding: 'e',
			sendMessageKeybinding: 'enter',
		})
	})

	test('runs both the v32 keybinding and v33 coding agent acknowledgement migrations', () => {
		const state = migrateSettingsState({ codelayerSetupAcknowledged: true }, 31)

		expect(state).toMatchObject({
			archiveKeybinding: 'mod+e',
			sendMessageKeybinding: 'mod+enter',
			codingAgentSetupAcknowledgements: {
				[LEGACY_CODING_AGENT_SETUP_HOST_ID]: { 'codelayer:codex': true },
			},
		})
		expect('codelayerSetupAcknowledged' in state).toBe(false)
	})

	test('defaults the local scratch pad experiment off at v27', () => {
		expect(migrateSettingsState({}, 26).scratchPadEnabled).toBe(false)
	})

	test('preserves an enabled local scratch pad experiment at v27', () => {
		expect(migrateSettingsState({ scratchPadEnabled: true }, 26).scratchPadEnabled).toBe(true)
	})

	test('removes the retired Artifact Viewer V2 setting at v27', () => {
		const state = migrateSettingsState({ artifactViewerV2Enabled: false }, 26)

		expect('artifactViewerV2Enabled' in state).toBe(false)
	})

	test.each([
		{ name: 'Codex', provider: 'codex', defaultAgent: 'codelayer' },
		{ name: 'Anthropic', provider: 'anthropic', defaultAgent: 'claude' },
		{ name: 'Copilot', provider: 'copilot', defaultAgent: 'codelayer' },
		{ name: 'Firepass', provider: 'firepass', defaultAgent: 'claude' },
		{ name: 'missing', provider: undefined, defaultAgent: 'codelayer' },
		{ name: 'invalid', provider: 'unknown-provider', defaultAgent: 'claude' },
	])('normalizes a v18 $name provider while preserving Codex settings', ({ provider, defaultAgent }) => {
		const state = migrateSettingsState(
			{
				...(provider === undefined ? {} : { defaultCodelayerProvider: provider }),
				defaultAgent,
				defaultCodelayerCodexModel: 'gpt-5.4',
				defaultCodelayerCodexEffort: 'high',
				defaultCodelayerCodexFastMode: true,
			},
			18,
		)

		expect(state).toMatchObject({
			defaultCodelayerProvider: 'codex',
			defaultAgent,
			defaultCodelayerCodexModel: 'gpt-5.4',
			defaultCodelayerCodexEffort: 'high',
			defaultCodelayerCodexFastMode: true,
		})
	})
})

describe('mapEditorEnvToDefaultEditor', () => {
	test('maps supported EDITOR commands to default editor values', () => {
		expect(mapEditorEnvToDefaultEditor('zed')).toBe('zed')
		expect(mapEditorEnvToDefaultEditor('/usr/local/bin/cursor --wait')).toBe('cursor')
		expect(mapEditorEnvToDefaultEditor('/opt/homebrew/bin/code -w')).toBe('code')
		expect(mapEditorEnvToDefaultEditor('"/Applications/Zed.app/Contents/MacOS/zed" --wait')).toBe('zed')
		expect(mapEditorEnvToDefaultEditor("'cursor' --reuse-window")).toBe('cursor')
		expect(
			mapEditorEnvToDefaultEditor('/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code -w'),
		).toBe('code')
	})

	test('ignores unsupported or empty EDITOR values', () => {
		expect(mapEditorEnvToDefaultEditor('vim')).toBeNull()
		expect(mapEditorEnvToDefaultEditor('vim code')).toBeNull()
		expect(mapEditorEnvToDefaultEditor('')).toBeNull()
		expect(mapEditorEnvToDefaultEditor(undefined)).toBeNull()
	})
})
