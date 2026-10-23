import type { CodingAgent } from '../../coding-agent/coding-agent'

export const MODEL_CONTEXT_WINDOW_OVERRIDES = {
	codex: {
		'gpt-6.1-sol': 258_400,
		'gpt-6-astra': 258_400,
		'gpt-6-sol': 258_400,
		'gpt-6-luna': 258_400,
		'gpt-5.6-sol': 258_400,
		'gpt-5.6-terra': 258_400,
		'gpt-5.6-luna': 258_400,
		'gpt-5.5': 258_400,
		'gpt-5.4': 258_400,
		'gpt-5.4-mini': 258_400,
	},
	xai: {
		'grok-4.5': 500_000,
		'grok-4.6': 500_000,
	},
} as const

export const CODEX_CONTEXT_WINDOWS = MODEL_CONTEXT_WINDOW_OVERRIDES.codex
export type CodexModel = keyof typeof CODEX_CONTEXT_WINDOWS
export const XAI_CONTEXT_WINDOWS = MODEL_CONTEXT_WINDOW_OVERRIDES.xai
export type XaiModel = keyof typeof XAI_CONTEXT_WINDOWS

const CODEX_BASELINE_TOKENS = 12_000

export interface ModelContextLookup {
	readonly provider?: string | null
	readonly model?: string | null
	readonly runtimeContextWindow?: number | null
	readonly catalogContextWindow?: number | null
	readonly codingAgent?: CodingAgent | null
}

function validContextWindow(value: number | null | undefined): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

export function getCodexContextWindow(modelId: string): number {
	return CODEX_CONTEXT_WINDOWS[modelId as CodexModel] ?? CODEX_CONTEXT_WINDOWS['gpt-6-astra']
}

function getXaiContextWindow(modelId: string): number | undefined {
	return XAI_CONTEXT_WINDOWS[modelId as XaiModel]
}

export function resolveEffectiveContextWindow(input: ModelContextLookup): number {
	const { provider, model, runtimeContextWindow, catalogContextWindow } = input

	if (provider === 'codex') return model ? getCodexContextWindow(model) : CODEX_CONTEXT_WINDOWS['gpt-6-astra']
	if (provider === 'xai' && model) {
		const contextWindow = getXaiContextWindow(model)
		if (contextWindow !== undefined) return contextWindow
	}
	if (validContextWindow(runtimeContextWindow)) return runtimeContextWindow
	if (validContextWindow(catalogContextWindow)) return catalogContextWindow

	if (
		model &&
		(model.includes('[1m]') ||
			model === 'opus' ||
			model === 'sonnet' ||
			model === 'claude-opus-5-5' ||
			model === 'claude-opus-5' ||
			model === 'claude-opus-4-8' ||
			model === 'claude-opus-4-7' ||
			model === 'claude-sonnet-5-5' ||
			model === 'claude-sonnet-5' ||
			model.endsWith('-1m') ||
			model.includes('fable'))
	)
		return 968_000
	if (model && (model.includes('gpt-5.5') || model.includes('gpt-5-codex'))) return 1_050_000
	if (model?.startsWith('gpt-5')) return 1_050_000
	if (model && (model.includes('haiku') || model.includes('opus-4-6'))) return 168_000
	// Unknown models default to the 1M Claude window; Codex is handled above.
	return 968_000
}

export function getContextWindowUsagePercentage(
	provider: string | null | undefined,
	used: number,
	limit: number,
): number {
	if (provider !== 'codex') return Math.round((used / limit) * 100)
	if (limit <= CODEX_BASELINE_TOKENS) return 100

	const effectiveWindow = limit - CODEX_BASELINE_TOKENS
	const effectiveUsed = Math.max(0, used - CODEX_BASELINE_TOKENS)
	const remaining = Math.max(0, effectiveWindow - effectiveUsed)
	const remainingPercentage = Math.round((remaining / effectiveWindow) * 100)
	return 100 - remainingPercentage
}

export function getEffectiveContextWindowSize(
	provider?: string | null,
	model?: string | null,
	codingAgent?: CodingAgent | null,
): number {
	return resolveEffectiveContextWindow({ provider, model, codingAgent })
}
