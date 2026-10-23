import * as Schema from 'effect/Schema'

export const TokenCount = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

export const ModelTokenUsage = Schema.Struct({
	input_tokens: TokenCount,
	output_tokens: TokenCount,
	cache_read_input_tokens: Schema.optionalKey(TokenCount),
	cache_creation_input_tokens: Schema.optionalKey(TokenCount),
})
export interface ModelTokenUsage extends Schema.Schema.Type<typeof ModelTokenUsage> {}

export const SessionModelUsage = Schema.Record(Schema.String, ModelTokenUsage)
export type SessionModelUsage = Schema.Schema.Type<typeof SessionModelUsage>

export function totalPromptTokens(usage: ModelTokenUsage): number {
	return usage.input_tokens + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0)
}

export function contextOccupancyTokens(usage: ModelTokenUsage): number {
	return totalPromptTokens(usage) + usage.output_tokens
}
