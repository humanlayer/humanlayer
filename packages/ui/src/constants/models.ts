import type { CodingAgent } from '@humanlayer/schemas/coding-agent'
import type { XaiFrontierModelId } from '@humanlayer/fold-xai'
import type { HostModelCatalogProvider } from '@humanlayer/schemas/zod/model-catalog'

import type { ProviderOption } from './providers'

// fold-xai's root export includes Node-only auth modules, so renderer code keeps a type-checked catalog copy.
export const XAI_FRONTIER_MODELS = [
	{ modelId: 'grok-4.5', label: 'Grok 4.5' },
	{ modelId: 'grok-4.6', label: 'Grok 4.6' },
] as const satisfies ReadonlyArray<{ readonly modelId: XaiFrontierModelId; readonly label: string }>

export const DEFAULT_XAI_MODEL_ID: XaiFrontierModelId = 'grok-4.6'

export const MODEL_OPTIONS = [
	// Anthropic models - latest
	{ value: 'fable' as const, label: 'FABLE', provider: 'anthropic' as ProviderOption },
	{ value: 'claude-fable-5-1' as const, label: 'FABLE 5.1', provider: 'anthropic' as ProviderOption },
	{ value: 'claude-fable-5' as const, label: 'FABLE 5', provider: 'anthropic' as ProviderOption },
	// Anthropic models - shorthand aliases (always latest)
	{ value: 'opus' as const, label: 'OPUS', provider: 'anthropic' as ProviderOption },
	// Anthropic models - specific versions
	{ value: 'claude-opus-5-5' as const, label: 'Opus 5.5', provider: 'anthropic' as ProviderOption },
	{ value: 'claude-opus-5' as const, label: 'OPUS 5', provider: 'anthropic' as ProviderOption },
	{ value: 'claude-opus-4-8' as const, label: 'OPUS 4.8', provider: 'anthropic' as ProviderOption },
	{ value: 'claude-opus-4-7' as const, label: 'OPUS 4.7', provider: 'anthropic' as ProviderOption },
	{ value: 'claude-opus-4-6' as const, label: 'OPUS 4.6', provider: 'anthropic' as ProviderOption },
	{ value: 'claude-opus-4-6-1m' as const, label: 'OPUS 4.6 1M', provider: 'anthropic' as ProviderOption },
	{ value: 'claude-opus-4-5' as const, label: 'OPUS 4.5', provider: 'anthropic' as ProviderOption },
	{ value: 'sonnet' as const, label: 'SONNET', provider: 'anthropic' as ProviderOption },
	{ value: 'claude-sonnet-5-5' as const, label: 'Sonnet 5.5', provider: 'anthropic' as ProviderOption },
	{ value: 'claude-sonnet-5' as const, label: 'SONNET 5', provider: 'anthropic' as ProviderOption },
	{ value: 'claude-sonnet-4-6' as const, label: 'SONNET 4.6', provider: 'anthropic' as ProviderOption },
	{ value: 'haiku' as const, label: 'HAIKU', provider: 'anthropic' as ProviderOption },
	{ value: 'claude-haiku-4-5-20251001' as const, label: 'HAIKU 4.5', provider: 'anthropic' as ProviderOption },
	// Copilot models - OpenAI (from api.githubcopilot.com/models)
	{ value: 'gpt-4.1' as const, label: 'GPT-4.1', provider: 'copilot' as ProviderOption },
	{ value: 'gpt-4o' as const, label: 'GPT-4o', provider: 'copilot' as ProviderOption },
	{ value: 'gpt-5-mini' as const, label: 'GPT-5 Mini', provider: 'copilot' as ProviderOption },
	{ value: 'gpt-5.1' as const, label: 'GPT-5.1', provider: 'copilot' as ProviderOption },
	{ value: 'gpt-5.2' as const, label: 'GPT-5.2', provider: 'copilot' as ProviderOption },
	{ value: 'gpt-5.2-codex' as const, label: 'GPT-5.2 Codex', provider: 'copilot' as ProviderOption },
	{ value: 'gpt-5.3-codex' as const, label: 'GPT-5.3 Codex', provider: 'copilot' as ProviderOption },
	{ value: 'gpt-5.4' as const, label: 'GPT-5.4', provider: 'copilot' as ProviderOption },
	{ value: 'gpt-5.4-mini' as const, label: 'GPT-5.4 Mini', provider: 'copilot' as ProviderOption },
	// Copilot models - Anthropic
	{ value: 'claude-haiku-4.5' as const, label: 'Haiku 4.5 (Copilot)', provider: 'copilot' as ProviderOption },
	{ value: 'claude-opus-4.5' as const, label: 'Opus 4.5 (Copilot)', provider: 'copilot' as ProviderOption },
	{ value: 'claude-opus-4.6' as const, label: 'Opus 4.6 (Copilot)', provider: 'copilot' as ProviderOption },
	{ value: 'claude-opus-4.7' as const, label: 'Opus 4.7 (Copilot)', provider: 'copilot' as ProviderOption },
	{ value: 'claude-sonnet-4' as const, label: 'Sonnet 4 (Copilot)', provider: 'copilot' as ProviderOption },
	{ value: 'claude-sonnet-4.5' as const, label: 'Sonnet 4.5 (Copilot)', provider: 'copilot' as ProviderOption },
	{ value: 'claude-sonnet-4.6' as const, label: 'Sonnet 4.6 (Copilot)', provider: 'copilot' as ProviderOption },
	// Copilot models - Google
	{ value: 'gemini-2.5-pro' as const, label: 'Gemini 2.5 Pro', provider: 'copilot' as ProviderOption },
	{ value: 'gemini-3-flash-preview' as const, label: 'Gemini 3 Flash', provider: 'copilot' as ProviderOption },
	{ value: 'gemini-3.1-pro-preview' as const, label: 'Gemini 3.1 Pro', provider: 'copilot' as ProviderOption },
	// Copilot models - xAI
	{ value: 'grok-code-fast-1' as const, label: 'Grok Code Fast', provider: 'copilot' as ProviderOption },
	// Codex models
	{ value: 'gpt-6.1-sol' as const, label: 'GPT-6.1 Sol', provider: 'codex' as ProviderOption },
	{ value: 'gpt-6-astra' as const, label: 'GPT-6 Astra', provider: 'codex' as ProviderOption },
	{ value: 'gpt-6-sol' as const, label: 'GPT-6 Sol', provider: 'codex' as ProviderOption },
	{ value: 'gpt-6-luna' as const, label: 'GPT-6 Luna', provider: 'codex' as ProviderOption },
	{ value: 'gpt-5.6-sol' as const, label: 'GPT-5.6 Sol', provider: 'codex' as ProviderOption },
	{ value: 'gpt-5.6-terra' as const, label: 'GPT-5.6 Terra', provider: 'codex' as ProviderOption },
	{ value: 'gpt-5.6-luna' as const, label: 'GPT-5.6 Luna', provider: 'codex' as ProviderOption },
	{ value: 'gpt-5.5' as const, label: 'GPT-5.5', provider: 'codex' as ProviderOption },
	{ value: 'gpt-5.4' as const, label: 'GPT-5.4', provider: 'codex' as ProviderOption },
	{ value: 'gpt-5.4-mini' as const, label: 'GPT-5.4 Mini', provider: 'codex' as ProviderOption },
	...XAI_FRONTIER_MODELS.map(({ modelId, label }) => ({
		value: modelId,
		label,
		provider: 'xai' as const,
	})),
	// Firepass models
	{
		value: 'accounts/fireworks/routers/kimi-k2p6-turbo' as const,
		label: 'Kimi K2P6 Turbo',
		provider: 'firepass' as ProviderOption,
	},
] as const

export type KnownModelOption = (typeof MODEL_OPTIONS)[number]['value']
/** A model id the picker can hold: a bundled one, or any id a host's runtime catalog reports. */
export type ModelOption = KnownModelOption | (string & {})
export type XaiModelOption = (typeof XAI_FRONTIER_MODELS)[number]['modelId']

export interface ModelPickerOption {
	readonly value: ModelOption
	readonly label: string
	readonly provider: ProviderOption
}

export function findModelOption(model: string) {
	return MODEL_OPTIONS.find((option) => option.value === model)
}

export function findXaiModelOption(model: string): XaiModelOption | undefined {
	return XAI_FRONTIER_MODELS.find(({ modelId }) => modelId === model)?.modelId
}

export const CODELAYER_ANTHROPIC_MODEL_OPTIONS = [
	'claude-fable-5',
	'opus',
	'claude-opus-5-5',
	'claude-opus-5',
	'claude-opus-4-8',
	'claude-opus-4-7',
	'claude-opus-4-6',
	'claude-opus-4-5',
	'sonnet',
	'claude-sonnet-5-5',
	'claude-sonnet-5',
	'claude-sonnet-4-6',
] as const satisfies readonly ModelOption[]

const CODELAYER_ANTHROPIC_MODEL_OPTION_SET = new Set<ModelOption>(CODELAYER_ANTHROPIC_MODEL_OPTIONS)

export function catalogProviderFor({
	agent,
	provider,
}: {
	agent?: CodingAgent | null
	provider?: ProviderOption | null
}): HostModelCatalogProvider | null {
	// Claude Code runs the installed CLI, whose ids ('opus[1m]', 'sonnet') are CLI syntax. CodeLayer's
	// anthropic provider calls the Anthropic API directly and needs real API ids, so it keeps the
	// bundled list.
	if (agent === 'claude') return 'anthropic'
	if ((agent === 'codelayer' || agent === 'fold') && provider === 'codex') return 'codex'
	return null
}

export function getModelOptionsForAgentProvider({
	agent,
	provider,
}: {
	agent?: CodingAgent | null
	provider?: ProviderOption | null
}): ReadonlyArray<ModelPickerOption> {
	if (agent === 'codelayer' && provider === 'anthropic') {
		return MODEL_OPTIONS.filter(
			(option) => option.provider === 'anthropic' && CODELAYER_ANTHROPIC_MODEL_OPTION_SET.has(option.value),
		)
	}

	if (agent === 'claude') {
		return MODEL_OPTIONS.filter((option) => option.provider === 'anthropic')
	}

	if (provider) {
		return MODEL_OPTIONS.filter((option) => option.provider === provider)
	}

	return MODEL_OPTIONS.filter((option) => option.provider === 'anthropic')
}

export function modelLabel(model: string, options?: ReadonlyArray<{ readonly value: string; readonly label: string }>): string {
	return options?.find((option) => option.value === model)?.label ?? findModelOption(model)?.label ?? model
}
