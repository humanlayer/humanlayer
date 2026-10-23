import { Effect } from 'effect'
import { describe, expect, test } from 'vitest'

import { decodeFoldUsage } from '@/effects/services/fold-sessions/fold-usage'

describe('Fold usage projection', () => {
	test.each([
		['gpt-6.1-sol', 0.14],
		['gpt-6-sol', 0.16],
		['gpt-6-luna', 0.008],
	] as const)('uses public pricing and the product context limit for %s', async (model, expectedCostUsd) => {
		const projection = await Effect.runPromise(
			decodeFoldUsage(
				{
					inputTokens: { total: 240_000, uncached: 40_000, cacheRead: 200_000 },
					outputTokens: { total: 4_000, text: 2_000, reasoning: 2_000 },
				},
				{ provider: 'codex', model },
			),
		)

		expect(projection).toMatchObject({
			contextInputTokens: 240_000,
			outputTokens: 4_000,
			contextWindowTokens: 244_000,
			contextWindowLimit: 258_400,
			costUsd: expectedCostUsd,
			billingUsage: {
				input_tokens: 40_000,
				output_tokens: 4_000,
				cache_read_input_tokens: 200_000,
			},
		})
	})

	test('uses the Codex Astra display limit instead of its public API catalog limit', async () => {
		const projection = await Effect.runPromise(
			decodeFoldUsage(
				{
					inputTokens: { total: 240_000, uncached: 40_000, cacheRead: 200_000 },
					outputTokens: { total: 4_000, text: 2_000, reasoning: 2_000 },
				},
				{ provider: 'codex', model: 'gpt-6-astra' },
			),
		)

		expect(projection).toMatchObject({
			contextInputTokens: 240_000,
			outputTokens: 4_000,
			contextWindowTokens: 244_000,
			contextWindowLimit: 258_400,
			costUsd: 0.8,
			billingUsage: {
				input_tokens: 40_000,
				output_tokens: 4_000,
				cache_read_input_tokens: 200_000,
			},
		})
	})

	test('uses the baked Grok context limit when reporting xAI usage', async () => {
		const projection = await Effect.runPromise(
			decodeFoldUsage(
				{
					inputTokens: { total: 120_000, uncached: 20_000, cacheRead: 100_000 },
					outputTokens: { total: 4_000, text: 2_000, reasoning: 2_000 },
				},
				{ provider: 'xai', model: 'grok-4.6' },
			),
		)

		expect(projection).toMatchObject({
			contextInputTokens: 120_000,
			outputTokens: 4_000,
			contextWindowTokens: 124_000,
			contextWindowLimit: 500_000,
			billingUsage: {
				input_tokens: 20_000,
				output_tokens: 4_000,
				cache_read_input_tokens: 100_000,
			},
		})
	})
})
