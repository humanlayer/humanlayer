import { bakedModelCatalog } from '@humanlayer/fold-agent'
import {
	type ModelCatalogEntry,
	UsageEncoded,
	usageCacheRead,
	usageCacheWrite,
	usageInputTotal,
	usageInputUncached,
	usageOutputTotal,
} from '@humanlayer/fold-core'
import { resolveEffectiveContextWindow } from '@humanlayer/schemas/effect/model-context'
import type { ModelTokenUsage } from '@humanlayer/schemas/effect/model-usage'
import { Effect, Schema } from 'effect'

export interface FoldUsageModel {
	readonly provider: string
	readonly model: string
}

export interface FoldUsageProjection {
	readonly contextInputTokens: number
	readonly outputTokens: number
	readonly contextWindowTokens: number
	readonly contextWindowLimit: number
	readonly billingUsage: ModelTokenUsage
	readonly costUsd?: number
}

const catalogProvider = (provider: string): string => (provider === 'codex' ? 'openai' : provider)

const findCatalogEntry = (selection: FoldUsageModel): ModelCatalogEntry | undefined =>
	bakedModelCatalog.find(
		(entry) => entry.providerId === catalogProvider(selection.provider) && entry.modelId === selection.model,
	)

const calculateCostUsd = (usage: ModelTokenUsage, pricing: ModelCatalogEntry['pricing']): number | undefined => {
	if (pricing === null) return undefined
	const cacheReadRate = pricing.cacheReadPerMTokens ?? pricing.inputPerMTokens
	const cacheWriteRate = pricing.cacheWritePerMTokens ?? pricing.inputPerMTokens
	return (
		(usage.input_tokens * pricing.inputPerMTokens +
			usage.output_tokens * pricing.outputPerMTokens +
			(usage.cache_read_input_tokens ?? 0) * cacheReadRate +
			(usage.cache_creation_input_tokens ?? 0) * cacheWriteRate) /
		1_000_000
	)
}

export const decodeFoldUsage: (
	input: unknown,
	selection: FoldUsageModel,
) => Effect.Effect<FoldUsageProjection | undefined, Schema.SchemaError> = Effect.fn('fold.decodeUsage')(function* (
	input: unknown,
	selection: FoldUsageModel,
) {
	const usage = yield* Schema.decodeUnknownEffect(UsageEncoded)(input)
	if (usage.inputTokens === undefined && usage.outputTokens === undefined) return undefined

	const contextInputTokens = usageInputTotal(usage)
	const outputTokens = usageOutputTotal(usage)
	const cacheRead = usageCacheRead(usage)
	const cacheWrite = usageCacheWrite(usage)
	const billingUsageFields: {
		input_tokens: number
		output_tokens: number
		cache_read_input_tokens?: number
		cache_creation_input_tokens?: number
	} = {
		input_tokens: usageInputUncached(usage),
		output_tokens: outputTokens,
	}
	if (cacheRead !== undefined) billingUsageFields.cache_read_input_tokens = cacheRead
	if (cacheWrite !== undefined) billingUsageFields.cache_creation_input_tokens = cacheWrite
	const billingUsage: ModelTokenUsage = billingUsageFields
	const catalogEntry = findCatalogEntry(selection)
	const costUsd = catalogEntry === undefined ? undefined : calculateCostUsd(billingUsage, catalogEntry.pricing)

	const projection = {
		contextInputTokens,
		outputTokens,
		contextWindowTokens: contextInputTokens + outputTokens,
		contextWindowLimit: resolveEffectiveContextWindow({
			provider: selection.provider,
			model: selection.model,
			catalogContextWindow: catalogEntry?.contextWindow,
		}),
		billingUsage,
	}
	if (costUsd === undefined) return projection
	return { ...projection, costUsd }
})
