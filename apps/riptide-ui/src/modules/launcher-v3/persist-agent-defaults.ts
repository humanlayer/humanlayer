import { type ClaudeEffortLevel, isEffortSupported } from '@humanlayer/ai/config'
import { findModelOption, findXaiModelOption } from '@humanlayer/ui/constants/models'

import { useSettingsStore } from '@/hooks/stores/settingsStore'

import type { LauncherV3FormValues } from './launcher-v3-form'

export interface LauncherAgentDefaults {
	agent: LauncherV3FormValues['agent']
	provider: LauncherV3FormValues['provider']
	model: string
	effort: string | null
	fastMode: boolean
}

const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const
type LauncherEffortLevel = (typeof EFFORT_LEVELS)[number]

const isEffortLevel = (value: string): value is LauncherEffortLevel =>
	(EFFORT_LEVELS as readonly string[]).includes(value)

/**
 * The bundled capability table only knows bundled models; a model that came from the host's
 * runtime catalog was already validated by the picker, so its effort is trusted as chosen.
 */
function supportedEffortLevel({ agent, provider, model, effort }: LauncherAgentDefaults): LauncherEffortLevel | null {
	if (effort === null || !isEffortLevel(effort)) return null
	if (findModelOption(model) === undefined) return effort
	return isEffortSupported(agent, provider, model, effort) ? effort : null
}

function isClaudeEffortLevel(effort: LauncherEffortLevel): effort is ClaudeEffortLevel {
	return effort !== 'ultra'
}

export function persistLauncherAgentDefaults(defaults: LauncherAgentDefaults): void {
	const { agent, provider, model, fastMode } = defaults
	const settings = useSettingsStore.getState()
	const selectedModel = findModelOption(model)
	const effort = supportedEffortLevel(defaults)
	settings.setDefaultAgent(agent === 'fold' ? 'codelayer' : agent)
	if (agent === 'claude') {
		if (selectedModel === undefined || selectedModel.provider === 'anthropic')
			settings.setDefaultClaudeCodeModel(model)
		if (effort && isClaudeEffortLevel(effort)) settings.setDefaultClaudeCodeEffort(effort)
		settings.setDefaultClaudeCodeFastMode(fastMode)
		return
	}
	settings.setDefaultCodelayerProvider(provider)
	if (provider === 'xai') {
		const xaiModel = findXaiModelOption(model)
		if (xaiModel) settings.setDefaultCodelayerXaiModel(xaiModel)
	} else if (provider === 'codex') {
		settings.setDefaultCodelayerCodexModel(model)
	}
	if (effort) settings.setDefaultCodelayerCodexEffort(effort)
	settings.setDefaultCodelayerCodexFastMode(fastMode)
}
