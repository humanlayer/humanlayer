import { AGENT_OPTIONS, launcherProviderForAgent } from '@humanlayer/ui/constants/agents'
import { getAgentPermissionModeConstraint } from '@humanlayer/ui/constants/permission-modes'
import { useCallback } from 'react'
import type { Control } from 'react-hook-form'
import { useController, useWatch } from 'react-hook-form'

import { WiredFastModeWarningDialog } from '@/components/FastModeWarningDialog'
import { useHostModelRegistry } from '@/hooks/live-queries/use-model-registry'
import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { useCodingAgentSetupGuard } from '@/hooks/use-coding-agent-setup-guard'
import { useCodingAgentSetupHost } from '@/hooks/use-coding-agent-setup-host'
import { useFastModeToggleGuard } from '@/hooks/useFastModeToggleGuard'
import { resolvePermissionsModeForSelectedModel } from '@/lib/model-permissions'
import type { ModelRegistry } from '@/lib/model-registry'
import type { LauncherV3FormValues } from '@/modules/launcher-v3/launcher-v3-form'
import { persistLauncherAgentDefaults } from '@/modules/launcher-v3/persist-agent-defaults'

import {
	LauncherAgentControl,
	type LauncherAgentProviderOption,
	type LauncherAgentSelection,
} from './LauncherAgentControl'

export interface LauncherAgentControlWiredProps {
	control: Control<LauncherV3FormValues>
	disabled?: boolean
}

function launcherAgentOptions(
	useFoldCodingAgent: boolean,
	models: ModelRegistry,
): readonly LauncherAgentProviderOption[] {
	const options = useFoldCodingAgent
		? ([
				{ agent: 'claude', provider: 'anthropic', agentLabel: 'Claude Code' },
				{ agent: 'fold', provider: 'codex', agentLabel: 'Codex' },
				{ agent: 'fold', provider: 'xai', agentLabel: 'xAI' },
			] as const)
		: AGENT_OPTIONS.map((agentOption) => ({
				agent: agentOption.value,
				provider: launcherProviderForAgent(agentOption.value),
				agentLabel: agentOption.label,
			}))
	return options.map(({ agent, provider, agentLabel }) => ({
		agent,
		agentLabel,
		provider,
		models: models.optionsFor({ agent, provider }).map((modelOption) => {
			const { effort, defaultEffort } = models.capabilitiesOf({ agent, provider, model: modelOption.value })
			return {
				value: modelOption.value,
				label: modelOption.label,
				effortLevels: effort.supported ? effort.levels : [],
				defaultEffort: defaultEffort ?? null,
			}
		}),
	}))
}

export function LauncherAgentControlWired({ control, disabled }: LauncherAgentControlWiredProps) {
	const { field: agent } = useController({ control, name: 'agent' })
	const { field: provider } = useController({ control, name: 'provider' })
	const { field: model } = useController({ control, name: 'model' })
	const { field: effort } = useController({ control, name: 'effort' })
	const { field: fastMode } = useController({ control, name: 'fastMode' })
	const { field: permissionsMode } = useController({ control, name: 'permissionsMode' })
	const hostId = useWatch({ control, name: 'hostId' })
	const defaultClaudeCodeFastMode = useSettingsStore((state) => state.defaultClaudeCodeFastMode)
	const defaultCodelayerCodexFastMode = useSettingsStore((state) => state.defaultCodelayerCodexFastMode)
	const useFoldCodingAgent = useSettingsStore((state) => state.useFoldCodingAgent)
	const setupHost = useCodingAgentSetupHost(hostId)
	const { guardSetup } = useCodingAgentSetupGuard()
	const models = useHostModelRegistry(hostId)
	const options = launcherAgentOptions(useFoldCodingAgent, models)
	const fastModeCapability = models.capabilitiesOf({
		agent: agent.value,
		provider: provider.value,
		model: model.value,
	}).fastMode

	const commitAgentSettings = (selection: LauncherAgentSelection) => {
		const compatibilityChanged =
			selection.agent !== agent.value || selection.provider !== provider.value || selection.model !== model.value
		if (selection.agent !== agent.value) agent.onChange(selection.agent)
		if (selection.provider !== provider.value) provider.onChange(selection.provider)
		if (selection.model !== model.value) model.onChange(selection.model)
		if (selection.effort !== effort.value) effort.onChange(selection.effort)

		const selectionCapabilities = models.capabilitiesOf(selection)
		let resolvedFastMode = fastMode.value
		if (compatibilityChanged) {
			const supportsFastMode = selectionCapabilities.fastMode.supported
			const configuredFastMode =
				selection.agent === 'claude' ? defaultClaudeCodeFastMode : defaultCodelayerCodexFastMode
			resolvedFastMode = supportsFastMode && configuredFastMode
			if (resolvedFastMode !== fastMode.value) fastMode.onChange(resolvedFastMode)
		}

		persistLauncherAgentDefaults({
			agent: selection.agent,
			provider: selection.provider,
			model: selection.model,
			effort: selection.effort,
			fastMode: resolvedFastMode,
		})

		const constraint = getAgentPermissionModeConstraint(selection.agent)
		const modelRepair = resolvePermissionsModeForSelectedModel({
			model: selection.model,
			currentPermissionsMode: permissionsMode.value,
			autoMode: selectionCapabilities.autoMode,
		})
		const leavingCodelayerBypass =
			agent.value === 'codelayer' && selection.agent === 'claude' && permissionsMode.value === 'bypass'
		const nextPermissionsMode =
			constraint?.requiredMode ??
			(leavingCodelayerBypass
				? selectionCapabilities.autoMode.supported
					? 'auto'
					: 'default'
				: modelRepair.nextPermissionsMode)
		if (nextPermissionsMode !== permissionsMode.value) permissionsMode.onChange(nextPermissionsMode)
	}

	const selectAgentSettings = (selection: LauncherAgentSelection) => {
		const setupChanged = selection.agent !== agent.value || selection.provider !== provider.value
		if (!setupChanged || (selection.agent !== 'codelayer' && selection.agent !== 'fold')) {
			commitAgentSettings(selection)
			return
		}
		guardSetup({
			agent: selection.agent,
			provider: selection.provider,
			host: setupHost,
			onContinue: () => commitAgentSettings(selection),
		})
	}

	const commitFastMode = useCallback(
		(next: boolean) => {
			fastMode.onChange(next)
			persistLauncherAgentDefaults({
				agent: agent.value,
				provider: provider.value,
				model: model.value,
				effort: effort.value,
				fastMode: next,
			})
		},
		[fastMode, agent.value, provider.value, model.value, effort.value],
	)
	const fastModeGuard = useFastModeToggleGuard(commitFastMode)

	return (
		<>
			<LauncherAgentControl
				agent={agent.value}
				provider={provider.value}
				model={model.value}
				effort={effort.value}
				options={options}
				fastMode={fastMode.value}
				fastModeSupported={fastModeCapability.supported}
				disabled={disabled}
				onSelectAgentSettings={selectAgentSettings}
				onFastModeChange={fastModeGuard.onToggle}
				onBlur={agent.onBlur}
			/>
			{fastModeGuard.pendingEnable && (
				<WiredFastModeWarningDialog
					open
					onOpenChange={fastModeGuard.setPendingEnable}
					onConfirm={fastModeGuard.confirm}
				/>
			)}
		</>
	)
}
