import { resolveEffectiveContextWindow } from '@humanlayer/schemas/effect/model-context'

export const CONTEXT_WARNING_TOKEN_THRESHOLD = 100_000 // Haiku (~168k window)
export const CONTEXT_WARNING_TOKEN_THRESHOLD_LARGE = 200_000 // 1M / codex / GPT-5 models

/**
 * Model-aware context-window warning threshold.
 *
 * Derives the warning tier from the shared effective context-window resolver
 * classification so the warning and the percentage badge never disagree about
 * what counts as a "large" model. Large-context models (1M / codex / GPT-5,
 * effective window > 168k) warn at 200k; everything else warns at 100k.
 */
export function getContextWarningThreshold(provider?: string | null, model?: string | null): number {
	return resolveEffectiveContextWindow({ provider, model }) > 168_000
		? CONTEXT_WARNING_TOKEN_THRESHOLD_LARGE
		: CONTEXT_WARNING_TOKEN_THRESHOLD
}

export const CONTEXT_WARNING_HIDE_MS = 7 * 24 * 60 * 60 * 1000

export function isContextWarningShown(
	settings: { contextWarningEnabled: boolean; contextWarningHiddenUntil: number | null },
	now: number,
): boolean {
	if (!settings.contextWarningEnabled) return false
	return settings.contextWarningHiddenUntil === null || now >= settings.contextWarningHiddenUntil
}
