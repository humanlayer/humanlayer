/**
 * Converts AgentLayer token counts to the storage shape that
 * `session_usage_events.tokens` documents.
 *
 * The two sides give "input tokens" different meanings:
 *
 * - Storage (Anthropic convention, see the table doc in
 *   `packages/db/src/tables/session-usage-events.ts`): `input_tokens`
 *   EXCLUDES cached tokens. The cache counters are separate and additive.
 *   Total prompt = input + cache_read + cache_creation.
 *
 * - AgentLayer (`TokenUsageAccumulator`, the source for every codelayer
 *   provider): `inputTokens` INCLUDES cached tokens. The cache counters
 *   are a subset of it. Total prompt = inputTokens.
 *   This is the OpenAI convention. The codex wire format uses it, the
 *   vendor transports keep it, and Vercel's `@ai-sdk/anthropic` adapter
 *   (a codelayer dependency) converts Anthropic wire counts into it.
 *
 * A direct field copy would store every cached token twice: once inside
 * `input_tokens` and once in its own counter. This module subtracts the
 * cache counters before storage. Cost needs no correction: AgentLayer
 * already applies the same subtraction before it prices a run.
 */

/**
 * The per-model shape that `TokenUsageAccumulator` exposes on
 * `tokenUsage.byModel`. The type is declared here, not imported, so the
 * tests do not need an agent run.
 */
export interface AgentLayerModelTokenUsage {
	readonly inputTokens: number
	readonly outputTokens: number
	readonly cacheReadTokens: number
	readonly cacheWriteTokens: number
	readonly reasoningTokens?: number
	/**
	 * The uncached-input count that the provider reported, if AgentLayer
	 * forwards it. When present, this value becomes the stored
	 * `input_tokens` directly. AgentLayer prices from the same value, so
	 * stored tokens and stored cost stay consistent. Older agentlayer-core
	 * versions do not send this field.
	 */
	readonly noCacheInputTokens?: number
}

/** The four keys that the API copies into integer columns. */
export interface ConventionalTokenMap {
	readonly input_tokens: number
	readonly output_tokens: number
	readonly cache_read_input_tokens: number
	readonly cache_creation_input_tokens: number
}

export type UsageEventTokenMap = {
	input_tokens: number
	output_tokens: number
	cache_read_input_tokens: number
	cache_creation_input_tokens: number
	reasoning_tokens?: number
	raw_input_tokens_total?: number
	raw_cache_read_tokens?: number
	raw_cache_write_tokens?: number
}

/**
 * Makes one counter valid for the contract, which requires a nonnegative
 * integer. Every emitted value goes through this. Without it, one bad
 * counter (negative, fractional, NaN, or Infinity) fails validation for
 * the whole batched report, and the run loses all of its usage data.
 */
const int = (n: number): number => (Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0)

/**
 * Splits the prompt into the three stored counters.
 *
 * If the provider reported `noCacheInputTokens`, that value wins, and the
 * cache counters are cut down to fit inside the prompt total. The value
 * is trusted without checks because the daemon only reads `snapshot()`
 * output, and AgentLayer's trust rule already cleared bad values there.
 * Raw accumulator values must not enter here: their price would differ
 * from the price AgentLayer charged.
 *
 * Otherwise the uncached count is the prompt total minus the cache
 * counters. The cache counters are clamped first, in AgentLayer's order,
 * so the three stored counters always sum to the prompt total. Without
 * that clamp, a provider whose cache counters exceed the prompt could
 * store more cache tokens than the prompt contained.
 */
const clampedParts = (
	usage: AgentLayerModelTokenUsage,
): { uncached: number; cacheRead: number; cacheWrite: number } => {
	const total = int(usage.inputTokens)
	if (usage.noCacheInputTokens !== undefined) {
		const uncached = Math.min(int(usage.noCacheInputTokens), total)
		const cacheRead = Math.min(int(usage.cacheReadTokens), total - uncached)
		const cacheWrite = Math.min(int(usage.cacheWriteTokens), total - uncached - cacheRead)
		return { uncached, cacheRead, cacheWrite }
	}
	const cacheRead = Math.min(int(usage.cacheReadTokens), total)
	const cacheWrite = Math.min(int(usage.cacheWriteTokens), total - cacheRead)
	return { uncached: total - cacheRead - cacheWrite, cacheRead, cacheWrite }
}

/**
 * Maps one AgentLayer usage record to the four stored keys. The
 * cache-inclusive `inputTokens` becomes the cache-exclusive
 * `input_tokens`. Every value goes through {@link int}.
 */
export const toConventionalTokenMap = (usage: AgentLayerModelTokenUsage): ConventionalTokenMap => {
	const { uncached, cacheRead, cacheWrite } = clampedParts(usage)
	return {
		input_tokens: uncached,
		output_tokens: int(usage.outputTokens),
		cache_read_input_tokens: cacheRead,
		cache_creation_input_tokens: cacheWrite,
	}
}

/** This key is present exactly when the conversion lost information. */
export const RAW_TOTAL_KEY = 'raw_input_tokens_total'

/**
 * Builds the jsonb map for the append-only usage event. It contains the
 * four stored keys, plus `reasoning_tokens` when present, plus the raw
 * counters (`raw_input_tokens_total`, `raw_cache_read_tokens`,
 * `raw_cache_write_tokens`) — but ONLY when the conversion lost
 * information.
 *
 * "Lost information" means: a stored counter differs from its raw input,
 * or the three stored counters do not sum to the raw total. On such a
 * row, the stored keys alone cannot reconstruct what the provider sent,
 * so the raw values ride along for a future repair job. On a normal row
 * the conversion is reversible, no extra keys appear, and the row is
 * byte-identical to the historical format.
 *
 * The `sessions.model_usage` snapshot never gets these extras. Its
 * contract is a closed four-key object, and zod strips unknown keys.
 */

export const toUsageEventTokenMap = (usage: AgentLayerModelTokenUsage): UsageEventTokenMap => {
	const tokens = toConventionalTokenMap(usage)
	const rawTotal = int(usage.inputTokens)
	const rawRead = int(usage.cacheReadTokens)
	const rawWrite = int(usage.cacheWriteTokens)
	const reasoning = int(usage.reasoningTokens ?? 0)
	const lossy =
		tokens.cache_read_input_tokens !== rawRead ||
		tokens.cache_creation_input_tokens !== rawWrite ||
		tokens.input_tokens + tokens.cache_read_input_tokens + tokens.cache_creation_input_tokens !== rawTotal
	const result: UsageEventTokenMap = {
		...tokens,
	}
	if (reasoning > 0) result.reasoning_tokens = reasoning
	if (lossy) {
		result[RAW_TOTAL_KEY] = rawTotal
		result.raw_cache_read_tokens = rawRead
		result.raw_cache_write_tokens = rawWrite
	}
	return result
}
