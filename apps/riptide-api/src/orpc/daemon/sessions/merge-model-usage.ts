import type { ModelTokenUsage, SessionModelUsage } from '@humanlayer/schemas/effect/model-usage'

export type { SessionModelUsage }

function addOptionalTokens(a: number | undefined, b: number | undefined): number | undefined {
	if (a === undefined && b === undefined) return undefined
	return (a ?? 0) + (b ?? 0)
}

/**
 * Merge a per-run usage report into the session's accumulated per-model usage.
 *
 * Each coding-agent run reports usage totals for that run only (the SDK's cumulative counters
 * reset when a session is resumed with a fresh query), so multi-run sessions must sum the
 * reports field-wise per model rather than overwrite.
 */
export function mergeModelUsage(existing: SessionModelUsage, incoming: SessionModelUsage): SessionModelUsage {
	const merged: Record<string, ModelTokenUsage> = { ...existing }

	for (const [modelName, usage] of Object.entries(incoming)) {
		const previous = merged[modelName]
		if (!previous) {
			merged[modelName] = { ...usage }
			continue
		}

		const cacheRead = addOptionalTokens(previous.cache_read_input_tokens, usage.cache_read_input_tokens)
		const cacheCreation = addOptionalTokens(previous.cache_creation_input_tokens, usage.cache_creation_input_tokens)

		const mergedUsage: {
			input_tokens: number
			output_tokens: number
			cache_read_input_tokens?: number
			cache_creation_input_tokens?: number
		} = {
			input_tokens: previous.input_tokens + usage.input_tokens,
			output_tokens: previous.output_tokens + usage.output_tokens,
		}
		if (cacheRead !== undefined) mergedUsage.cache_read_input_tokens = cacheRead
		if (cacheCreation !== undefined) mergedUsage.cache_creation_input_tokens = cacheCreation
		merged[modelName] = mergedUsage
	}

	return merged
}
