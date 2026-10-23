import { anthropic } from '@ai-sdk/anthropic'
import { openai } from '@ai-sdk/openai'
import type { LanguageModelV3 } from '@ai-sdk/provider'
import { createReliableLanguageModel } from '@humanlayer/ai/reliable-language-model'

import { Sentry } from '../instrument'
import { logger } from '../logger'

type RiptideModelAlias = 'haiku' | 'sonnet'

const PRIMARY: Record<RiptideModelAlias, LanguageModelV3> = {
	haiku: anthropic('claude-haiku-4-5'),
	sonnet: anthropic('claude-sonnet-5'),
}

const SECONDARY: Record<RiptideModelAlias, LanguageModelV3> = {
	haiku: openai('gpt-5-mini'),
	sonnet: openai('gpt-5'),
}

export function createRiptideReliableLanguageModel(alias: RiptideModelAlias): LanguageModelV3 {
	return createReliableLanguageModel({
		primary: PRIMARY[alias],
		secondary: SECONDARY[alias],
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
