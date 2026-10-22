/**
 * Token Usage Tracking Utilities for Claude Agent SDK
 *
 * This module handles extraction and calculation of token usage from Claude Agent SDK messages.
 * All token counting logic is centralized here for clarity and maintainability.
 *
 * IMPORTANT: For the authoritative guide on SDK token tracking, see:
 * https://platform.claude.com/docs/en/agent-sdk/cost-tracking
 *
 * Key concepts from the guide:
 * - `input_tokens`: UNCACHED input tokens (does NOT include cached tokens)
 * - `cache_read_input_tokens`: Tokens read from prompt cache (ADDITIVE to input_tokens)
 * - `cache_creation_input_tokens`: Tokens used to create new cache entries
 * - `output_tokens`: Tokens generated in the response
 *
 * For context window calculation:
 *   Total Input = input_tokens + cache_read_input_tokens + cache_creation_input_tokens
 *   Context Window = Total Input + output_tokens
 *
 * For parallel tool calls: All messages with the same ID share identical usage.
 * Only count usage once per unique message ID.
 */

import logger from '@/logger'

/**
 * Raw token fields as they appear in SDK usage objects.
 * We extract these and combine them for simpler storage.
 */
export interface RawTokenUsage {
	input_tokens?: number
	output_tokens?: number
	cache_read_input_tokens?: number
	cache_creation_input_tokens?: number
}

/**
 * Simplified token usage for storage and display.
 * `inputTokens` here is the TOTAL input (uncached + cached).
 */
export interface TokenUsage {
	/** Total input tokens (uncached + cached) */
	inputTokens: number
	/** Output tokens generated */
	outputTokens: number
	/** Context window = inputTokens + outputTokens */
	contextWindowTokens: number
}

/**
 * Detailed token breakdown for logging/debugging.
 */
export interface DetailedTokenUsage extends TokenUsage {
	/** Original uncached input tokens from SDK */
	uncachedInputTokens: number
	/** Tokens read from cache */
	cacheReadInputTokens: number
	/** Tokens used to create cache */
	cacheCreationInputTokens: number
}

/**
 * Extracts raw token fields from an SDK usage object.
 * Handles the dynamic nature of SDK responses safely.
 */
export function extractRawTokens(usage: unknown): RawTokenUsage {
	if (!usage || typeof usage !== 'object') {
		return {}
	}

	const u = usage as Record<string, unknown>
	return {
		input_tokens: typeof u.input_tokens === 'number' ? u.input_tokens : undefined,
		output_tokens: typeof u.output_tokens === 'number' ? u.output_tokens : undefined,
		cache_read_input_tokens: typeof u.cache_read_input_tokens === 'number' ? u.cache_read_input_tokens : undefined,
		cache_creation_input_tokens:
			typeof u.cache_creation_input_tokens === 'number' ? u.cache_creation_input_tokens : undefined,
	}
}

/**
 * Calculates token usage from raw SDK fields.
 *
 * Per the SDK guide (https://platform.claude.com/docs/en/agent-sdk/cost-tracking):
 * - input_tokens is UNCACHED tokens
 * - cache_read_input_tokens is CACHED tokens (additive, not a subset!)
 * - Total input = input_tokens + cache_read_input_tokens
 * - Context window = Total input + output_tokens
 *
 * @param raw - Raw token fields from SDK
 * @returns Calculated token usage, or null if no valid data
 */
export function calculateTokenUsage(raw: RawTokenUsage): TokenUsage | null {
	// Need at least input and output to calculate
	if (raw.input_tokens === undefined || raw.output_tokens === undefined) {
		return null
	}

	const uncachedInput = raw.input_tokens
	const cachedInput = raw.cache_read_input_tokens ?? 0
	const cacheCreation = raw.cache_creation_input_tokens ?? 0
	// cache_creation_input_tokens are tokens being written TO cache - they ARE in the context window
	const totalInput = uncachedInput + cachedInput + cacheCreation
	const output = raw.output_tokens

	return {
		inputTokens: totalInput,
		outputTokens: output,
		contextWindowTokens: totalInput + output,
	}
}

/**
 * Calculates detailed token usage including cache breakdown for logging.
 *
 * @param raw - Raw token fields from SDK
 * @returns Detailed token usage, or null if no valid data
 */
export function calculateDetailedTokenUsage(raw: RawTokenUsage): DetailedTokenUsage | null {
	const basic = calculateTokenUsage(raw)
	if (!basic) {
		return null
	}

	return {
		...basic,
		uncachedInputTokens: raw.input_tokens ?? 0,
		cacheReadInputTokens: raw.cache_read_input_tokens ?? 0,
		cacheCreationInputTokens: raw.cache_creation_input_tokens ?? 0,
	}
}

/**
 * Extracts and calculates token usage from an SDK message's usage field.
 *
 * NOTE: This does NOT deduplicate parallel tool use messages that share the
 * same inner message id. When counting usage across a stream of SDK messages,
 * dedupe by getMessageIdFromMessage and mark an id as counted only after the
 * usage has been durably attached to a created event (see processClaudeEvents)
 * — marking at extraction time would drop the turn's
 * tokens whenever the first sibling persists no token-carrying event.
 *
 * @param message - SDK message object (assistant message or result)
 * @returns Token usage, or null if not available
 */
export function getTokenUsageFromMessage(message: unknown): TokenUsage | null {
	if (!message || typeof message !== 'object') {
		return null
	}

	// Try message.message.usage (for assistant messages)
	const msg = message as Record<string, unknown>
	const innerMessage = msg.message as Record<string, unknown> | undefined
	const usage = innerMessage?.usage ?? msg.usage

	if (!usage) {
		return null
	}

	const raw = extractRawTokens(usage)
	return calculateTokenUsage(raw)
}

/**
 * Extracts the inner API message id (`message.message.id`) from an SDK message.
 *
 * During parallel tool use the SDK emits multiple assistant messages whose
 * nested API message shares the same `id` (with identical usage), so this id
 * is the deduplication key for token counting.
 *
 * @param message - SDK message object (assistant message)
 * @returns The inner message id, or undefined if not present
 */
export function getMessageIdFromMessage(message: unknown): string | undefined {
	if (!message || typeof message !== 'object') {
		return undefined
	}

	const msg = message as Record<string, unknown>
	const innerMessage = msg.message as Record<string, unknown> | undefined
	const id = innerMessage?.id
	return typeof id === 'string' ? id : undefined
}

/**
 * Logs detailed token usage for debugging.
 * Includes all cache metrics to help diagnose token counting issues.
 *
 * @param sessionId - Session ID for log context
 * @param messageId - Optional message ID (for deduplication tracking)
 * @param usage - Raw SDK usage object
 * @param label - Log message label
 */
export function logTokenUsage(sessionId: string, messageId: string | undefined, usage: unknown, label: string): void {
	const raw = extractRawTokens(usage)
	const detailed = calculateDetailedTokenUsage(raw)

	if (!detailed) {
		logger.debug({ sessionId, messageId }, `${label}: No token usage data`)
		return
	}

	logger.info(
		{
			sessionId,
			messageId,
			// Raw SDK values
			sdkInputTokens: raw.input_tokens,
			sdkOutputTokens: raw.output_tokens,
			sdkCacheReadInputTokens: raw.cache_read_input_tokens,
			sdkCacheCreationInputTokens: raw.cache_creation_input_tokens,
			// Calculated values
			totalInputTokens: detailed.inputTokens,
			outputTokens: detailed.outputTokens,
			contextWindowTokens: detailed.contextWindowTokens,
		},
		label,
	)
}

/**
 * Calculates context window tokens directly from raw SDK usage.
 * Convenience function for simple cases.
 *
 * @param usage - Raw SDK usage object
 * @returns Context window token count, or undefined if not calculable
 */
export function calculateContextWindowTokens(usage: unknown): number | undefined {
	const raw = extractRawTokens(usage)
	const calculated = calculateTokenUsage(raw)
	return calculated?.contextWindowTokens
}
