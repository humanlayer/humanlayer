import { anthropic } from '@ai-sdk/anthropic'
import { openai } from '@ai-sdk/openai'
import type { LanguageModelV3 } from '@ai-sdk/provider'
import * as Sentry from '@sentry/core'

import { logger } from '../logger'
import { createReliableLanguageModel } from '../reliable-language-model'

export type ModelAlias = 'sonnet' | 'haiku'

const PRIMARY: Record<ModelAlias, LanguageModelV3> = {
	sonnet: anthropic('claude-sonnet-5'),
	haiku: anthropic('claude-haiku-4-5'),
}

const isFallbackEnabled = Boolean(process.env.OPENAI_API_KEY?.trim())

if (!isFallbackEnabled) {
	logger.warn({ event: 'ai_fallback_disabled' }, 'OPENAI_API_KEY not set — AI fallback disabled; primary-only mode')
}

// Construct the OpenAI fallback models lazily so `openai('gpt-5')` is never invoked
// when the key is missing (which would otherwise fail at first inference call).
const FALLBACK: Record<ModelAlias, LanguageModelV3> | null = isFallbackEnabled
	? {
			sonnet: openai('gpt-5'),
			haiku: openai('gpt-5-mini'),
		}
	: null

/**
 * Resolve a logical model alias to a Vercel-AI-SDK `LanguageModelV3` wrapped with
 * Anthropic→OpenAI reliable-model middleware. Suppress the SDK-level retry at the call site:
 *
 *     generateText({ model: resolveModel('haiku'), maxRetries: 0, ... })
 *
 * When `OPENAI_API_KEY` is unset, returns the bare Anthropic primary model
 * (no middleware), preserving today's behavior.
 *
 * Schema convention: agents pass `providerOptions: { openai: { strictJsonSchema: false } }`
 * at the call site so existing Zod schemas with `.optional()` keep working on the fallback path.
 */
export function resolveModel(alias: ModelAlias): LanguageModelV3 {
	if (!FALLBACK) return PRIMARY[alias]
	return createReliableLanguageModel({
		primary: PRIMARY[alias],
		secondary: FALLBACK[alias],
		onAnyError: (error) => {
			Sentry.addBreadcrumb({
				category: 'ai-inference',
				level: 'warning',
				message: 'AI language model call failed; retrying reliable model path',
				data: {
					alias,
					error_message: error instanceof Error ? error.message : String(error),
				},
			})
			logger.warn(
				{
					alias,
					error_message: error instanceof Error ? error.message : String(error),
				},
				'AI language model call failed; retrying reliable model path',
			)
		},
		onFailure: (error) => {
			Sentry.captureException(error, {
				tags: {
					error_type: 'ai_fallback_exhausted',
					model_alias: alias,
				},
				extra: {
					fallback_provider: 'openai',
					primary_provider: 'anthropic',
				},
			})
		},
	})
}
