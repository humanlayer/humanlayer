import { Schema } from 'effect'

import type { CreateEventInput } from '@/agents/shared/streaming-events'

const UnknownRecordSchema = Schema.Record(Schema.String, Schema.Unknown)

export const ClaudeFallbackContentBlockSchema = Schema.Struct({
	type: Schema.Literal('fallback'),
})
export type ClaudeFallbackContentBlock = typeof ClaudeFallbackContentBlockSchema.Type

export const ClaudeContentBlockSchema = Schema.Union([
	Schema.Struct({ type: Schema.Literal('text'), text: Schema.String }),
	Schema.Struct({ type: Schema.Literal('thinking'), thinking: Schema.String }),
	Schema.Struct({
		type: Schema.Literal('tool_use'),
		id: Schema.String,
		name: Schema.String,
		input: UnknownRecordSchema,
	}),
	Schema.Struct({
		type: Schema.Literal('tool_result'),
		tool_use_id: Schema.String,
		content: Schema.optionalKey(Schema.Union([Schema.String, Schema.Array(Schema.Unknown)])),
	}),
	Schema.Struct({
		type: Schema.Literals(['server_tool_use', 'redacted_thinking', 'image', 'document']),
	}),
	ClaudeFallbackContentBlockSchema,
])

export type ClaudeContentBlock = typeof ClaudeContentBlockSchema.Type

export const ClaudeContentBlockTypeSchema = Schema.Struct({ type: Schema.String })

const knownClaudeContentBlockTypes = new Set<string>([
	'text',
	'thinking',
	'tool_use',
	'tool_result',
	'server_tool_use',
	'redacted_thinking',
	'image',
	'document',
	'fallback',
])

export const isKnownClaudeContentBlockType = (type: string): type is ClaudeContentBlock['type'] =>
	knownClaudeContentBlockTypes.has(type)

export const ClaudeModelFallbackSchema = Schema.Struct({
	content: Schema.optionalKey(Schema.String),
	original_model: Schema.optionalKey(Schema.String),
	fallback_model: Schema.optionalKey(Schema.String),
})

export const ClaudeResultUsageSchema = Schema.Struct({
	total_cost_usd: Schema.optionalKey(Schema.Number),
	modelUsage: Schema.optionalKey(
		Schema.Record(
			Schema.String,
			Schema.Struct({
				inputTokens: Schema.Number,
				outputTokens: Schema.Number,
				cacheReadInputTokens: Schema.Number,
				cacheCreationInputTokens: Schema.Number,
				costUSD: Schema.optionalKey(Schema.Number),
			}),
		),
	),
})

export type ClaudeResultUsage = typeof ClaudeResultUsageSchema.Type

type ClaudeResultUsageDelta = {
	inputTokens: number
	outputTokens: number
	cacheReadInputTokens: number
	cacheCreationInputTokens: number
	costUSD?: number
}

export const subtractClaudeResultUsage = (
	current: ClaudeResultUsage,
	previous: ClaudeResultUsage | undefined,
): ClaudeResultUsage => ({
	total_cost_usd: Math.max(0, (current.total_cost_usd ?? 0) - (previous?.total_cost_usd ?? 0)),
	modelUsage: Object.fromEntries(
		Object.entries(current.modelUsage ?? {}).flatMap(([model, usage]) => {
			const prior = previous?.modelUsage?.[model]
			const delta: ClaudeResultUsageDelta = {
				inputTokens: Math.max(0, usage.inputTokens - (prior?.inputTokens ?? 0)),
				outputTokens: Math.max(0, usage.outputTokens - (prior?.outputTokens ?? 0)),
				cacheReadInputTokens: Math.max(0, usage.cacheReadInputTokens - (prior?.cacheReadInputTokens ?? 0)),
				cacheCreationInputTokens: Math.max(
					0,
					usage.cacheCreationInputTokens - (prior?.cacheCreationInputTokens ?? 0),
				),
			}
			if (usage.costUSD !== undefined) {
				delta.costUSD = Math.max(0, usage.costUSD - (prior?.costUSD ?? 0))
			}
			const costDelta = 'costUSD' in delta ? delta.costUSD : undefined
			const hasUsage =
				delta.inputTokens > 0 ||
				delta.outputTokens > 0 ||
				delta.cacheReadInputTokens > 0 ||
				delta.cacheCreationInputTokens > 0 ||
				(costDelta !== undefined && costDelta > 0)
			return hasUsage ? [[model, delta] as const] : []
		}),
	),
})

export type ClaudeStreamBlockType = 'text' | 'thinking' | 'tool_use'

export const getClaudeStreamBlockType = (content: string | ClaudeContentBlock): ClaudeStreamBlockType | null => {
	if (typeof content === 'string') return 'text'
	if (content.type === 'text') return 'text'
	if (content.type === 'thinking') return 'thinking'
	if (content.type === 'tool_use') return 'tool_use'
	return null
}

export interface TransformClaudeContentBlockInput {
	readonly sessionId: string
	readonly codingAgentSessionId: string
	readonly codingAgentEventId?: string
	readonly role: 'user' | 'assistant'
	readonly content: string | ClaudeContentBlock
	readonly parentToolUseId?: string | null
	readonly inputTokens?: number
	readonly outputTokens?: number
	readonly eventId?: string
}

/** Projects a parsed Claude content block into the daemon conversation-event contract. */
export const transformClaudeContentBlock = (input: TransformClaudeContentBlockInput): CreateEventInput | null => {
	const common = {
		eventId: input.eventId,
		sessionId: input.sessionId,
		codingAgentSessionId: input.codingAgentSessionId,
		codingAgentEventId: input.codingAgentEventId,
		role: input.role,
		parentToolUseId: input.parentToolUseId ?? null,
		inputTokens: input.inputTokens,
		outputTokens: input.outputTokens,
	}

	if (typeof input.content === 'string') {
		return { ...common, eventType: 'message', content: input.content }
	}

	switch (input.content.type) {
		case 'text':
			return { ...common, eventType: 'message', content: input.content.text }
		case 'thinking':
			return { ...common, eventType: 'thinking', content: input.content.thinking }
		case 'tool_use':
			return {
				...common,
				eventType: 'tool_call',
				toolCallId: input.content.id,
				toolName: input.content.name,
				toolInputJson: input.content.input,
			}
		case 'tool_result': {
			const result =
				typeof input.content.content === 'string'
					? input.content.content
					: (JSON.stringify(input.content.content) ?? '')
			return {
				...common,
				eventType: 'tool_result',
				toolResultForId: input.content.tool_use_id,
				toolResultContent: result.includes('\0') ? `[binary content, ${result.length} bytes]` : result,
			}
		}
		default:
			return null
	}
}

export interface ClaudeUsageEntry {
	readonly model: string
	readonly tokens: {
		readonly input_tokens: number
		readonly output_tokens: number
		readonly cache_read_input_tokens: number
		readonly cache_creation_input_tokens: number
	}
	readonly costUsd?: number
}

/**
 * Converts parsed SDK result usage into snapshot and append-only API payloads.
 *
 * The field-for-field copy below is correct ONLY because the Claude Agent SDK
 * reports genuine Anthropic semantics: `inputTokens` already EXCLUDES cached
 * tokens, and cache read/creation are separate additive counters — exactly the
 * contract `session_usage_events.tokens` documents.
 *
 * Do not copy this pattern into a provider that reports OpenAI-style cache-inclusive
 * semantics, where the equivalent `inputTokens` is the cache-INCLUSIVE prompt
 * total and a naive copy double-counts every cached token. Those paths must go
 * through `agents/codelayer/token-usage.ts`'s `toConventionalTokenMap`, which
 * subtracts the cache categories back out.
 */
export const transformClaudeResultUsage = (result: ClaudeResultUsage) => {
	const entries: readonly ClaudeUsageEntry[] = Object.entries(result.modelUsage ?? {}).map(([model, usage]) => {
		const entry: {
			model: string
			tokens: ClaudeUsageEntry['tokens']
			costUsd?: number
		} = {
			model,
			tokens: {
				input_tokens: usage.inputTokens,
				output_tokens: usage.outputTokens,
				cache_read_input_tokens: usage.cacheReadInputTokens,
				cache_creation_input_tokens: usage.cacheCreationInputTokens,
			},
		}
		if (usage.costUSD !== undefined) entry.costUsd = usage.costUSD
		return entry
	})

	return {
		entries,
		modelUsage:
			entries.length === 0 ? undefined : Object.fromEntries(entries.map(({ model, tokens }) => [model, tokens])),
		totalCostUsd: result.total_cost_usd,
	}
}
