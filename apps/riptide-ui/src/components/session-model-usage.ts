import type { SessionModelUsage } from '@humanlayer/schemas/effect/model-usage'

export interface NormalizedTokenUsage {
	totalTokens: number
	totalInput: number
	uncachedInput: number
	cacheRead: number
	cacheWrite: number
	output: number
}

export interface NormalizedSessionUsage {
	totals: NormalizedTokenUsage
	byModel: Record<string, NormalizedTokenUsage>
}

const EMPTY_USAGE: NormalizedTokenUsage = {
	totalTokens: 0,
	totalInput: 0,
	uncachedInput: 0,
	cacheRead: 0,
	cacheWrite: 0,
	output: 0,
}

export function parseSessionModelUsage(
	modelUsage: SessionModelUsage | string | null | undefined,
): SessionModelUsage | null {
	if (!modelUsage) return null
	if (typeof modelUsage !== 'string') return modelUsage

	try {
		return JSON.parse(modelUsage)
	} catch {
		return null
	}
}

function normalizeTokenCount(value: number | undefined): number {
	return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0
}

/**
 * Every producer stores cache-EXCLUSIVE `input_tokens`, so the cache counters
 * are always additive and there is no per-agent branch here.
 *
 * There used to be one: the codelayer daemon forwarded AgentLayer's
 * cache-INCLUSIVE `inputTokens` raw, and this function compensated by
 * subtracting. The daemon now normalizes at the write site (see the codelayer
 * `token-usage.ts`), so compensating here would subtract the cache a SECOND
 * time — on a cache-heavy session that reads as ~97% of the prompt vanishing
 * and `uncachedInput` clamping to 0.
 *
 * Caveat for the rollout window: rows written BEFORE the daemon fix (and by
 * not-yet-upgraded daemons after it) store cache-INCLUSIVE input, so summing
 * the cache on top here renders them HIGH — up to ~2x on cache-heavy codelayer
 * sessions, since the cache is counted once inside `input_tokens` and again
 * via the additive counters. `model_usage` also accumulates across runs
 * (`merge-model-usage.ts`), so a session spanning the deploy holds both
 * conventions summed. Nothing here can separate them; only a backfill of the
 * old rows (input - cache_read - cache_creation recovers the true value) fixes
 * the display for historical sessions.
 */
export function normalizeSessionModelUsage(modelUsage: SessionModelUsage): NormalizedSessionUsage {
	const byModel = Object.fromEntries(
		Object.entries(modelUsage).map(([model, usage]) => {
			const input = normalizeTokenCount(usage.input_tokens)
			const output = normalizeTokenCount(usage.output_tokens)
			const cacheRead = normalizeTokenCount(usage.cache_read_input_tokens)
			const cacheWrite = normalizeTokenCount(usage.cache_creation_input_tokens)
			const totalInput = input + cacheRead + cacheWrite
			const uncachedInput = input

			return [
				model,
				{
					totalTokens: totalInput + output,
					totalInput,
					uncachedInput,
					cacheRead,
					cacheWrite,
					output,
				},
			]
		}),
	)

	const totals = Object.values(byModel).reduce<NormalizedTokenUsage>(
		(total, usage) => ({
			totalTokens: total.totalTokens + usage.totalTokens,
			totalInput: total.totalInput + usage.totalInput,
			uncachedInput: total.uncachedInput + usage.uncachedInput,
			cacheRead: total.cacheRead + usage.cacheRead,
			cacheWrite: total.cacheWrite + usage.cacheWrite,
			output: total.output + usage.output,
		}),
		EMPTY_USAGE,
	)

	return { totals, byModel }
}
