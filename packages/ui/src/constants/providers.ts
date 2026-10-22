import {
	FOLD_MODEL_PROVIDER_VALUES,
	SELECTABLE_MODEL_PROVIDER_VALUES,
	type SelectableModelProvider,
} from '@humanlayer/schemas/model-provider'

export type ProviderOption = SelectableModelProvider
export const PROVIDER_LABELS = {
	anthropic: 'Anthropic (API)',
	copilot: 'GitHub Copilot',
	codex: 'OpenAI Codex',
	firepass: 'Firepass',
	xai: 'xAI',
} as const satisfies Record<ProviderOption, string>

export const PROVIDER_OPTIONS = SELECTABLE_MODEL_PROVIDER_VALUES.map((value) => ({
	value,
	label: PROVIDER_LABELS[value],
}))
export type VisibleProviderOption = (typeof PROVIDER_OPTIONS)[number]
const FOLD_PROVIDER_OPTIONS = FOLD_MODEL_PROVIDER_VALUES.map((value) => ({ value, label: PROVIDER_LABELS[value] }))

// Non-Codex providers remain for legacy session configuration and display only unless Fold enables xAI.
export const getVisibleProviderOptions = (useFoldCodingAgent = false): VisibleProviderOption[] =>
	useFoldCodingAgent ? [...FOLD_PROVIDER_OPTIONS] : FOLD_PROVIDER_OPTIONS.filter(({ value }) => value === 'codex')
