import { describe, expect, it } from 'vitest'

import { toConventionalTokenMap, toUsageEventTokenMap } from './token-usage'

describe('toConventionalTokenMap', () => {
	it('subtracts cache read and cache write from the cache-inclusive input', () => {
		// AgentLayer reports OpenAI-style counts: inputTokens is the whole prompt, cache counters a subset of it.
		expect(
			toConventionalTokenMap({
				inputTokens: 1_000,
				outputTokens: 50,
				cacheReadTokens: 700,
				cacheWriteTokens: 200,
			}).input_tokens,
		).toBe(100)
	})

	it('leaves input unchanged when the provider already reports cache-exclusive input', () => {
		// Anthropic semantics: no cache counters at all, so nothing to subtract.
		expect(
			toConventionalTokenMap({
				inputTokens: 361_909,
				outputTokens: 12_000,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
			}).input_tokens,
		).toBe(361_909)
	})

	it('maps a real codex row to Anthropic semantics, passing cache counters through', () => {
		// Shape taken from an observed dev row for codex-sse-vendor/gpt-5.6-sol, which
		// was persisted with input_tokens = 66,404,954 (cache-inclusive) before this fix.
		expect(
			toConventionalTokenMap({
				inputTokens: 66_404_954,
				outputTokens: 191_155,
				cacheReadTokens: 64_644_608,
				cacheWriteTokens: 0,
			}),
		).toEqual({
			input_tokens: 1_760_346,
			output_tokens: 191_155,
			cache_read_input_tokens: 64_644_608,
			cache_creation_input_tokens: 0,
		})
	})

	it('keeps the documented additive invariant on the subtraction path', () => {
		const usage = {
			inputTokens: 1_234_567,
			outputTokens: 9_999,
			cacheReadTokens: 1_000_000,
			cacheWriteTokens: 200_000,
		}
		const tokens = toConventionalTokenMap(usage)

		expect(tokens.input_tokens + tokens.cache_read_input_tokens + tokens.cache_creation_input_tokens).toBe(
			usage.inputTokens,
		)
	})

	// Clamping only input_tokens would store more cache than the prompt held:
	// input floors at 0 while read/write pass through at full size, so the
	// stored triple would exceed the prompt total it is supposed to decompose.
	it('clamps the cache counters too, so the stored triple still sums to the prompt total', () => {
		const usage = { inputTokens: 100, outputTokens: 10, cacheReadTokens: 80, cacheWriteTokens: 50 }
		const tokens = toConventionalTokenMap(usage)

		expect(tokens).toMatchObject({
			input_tokens: 0,
			cache_read_input_tokens: 80,
			// 50 requested, but only 20 of the prompt is left after the cache reads.
			cache_creation_input_tokens: 20,
		})
		expect(tokens.input_tokens + tokens.cache_read_input_tokens + tokens.cache_creation_input_tokens).toBe(
			usage.inputTokens,
		)
	})

	it('prefers the provider-reported uncached figure and reconciles cache counters around it', () => {
		// AgentLayer >= the noCache passthrough bills on the provider's own
		// figure; storing anything else would make stored tokens x pricing
		// disagree with the persisted costUsd.
		expect(
			toConventionalTokenMap({
				inputTokens: 1_000,
				outputTokens: 10,
				cacheReadTokens: 800,
				cacheWriteTokens: 0,
				noCacheInputTokens: 250,
			}),
		).toEqual({
			input_tokens: 250,
			output_tokens: 10,
			// Reconciled: only 750 of the prompt remains after the provider's uncached claim.
			cache_read_input_tokens: 750,
			cache_creation_input_tokens: 0,
		})
	})

	it('sanitizes negative and fractional counters instead of letting one reject the whole payload', () => {
		// The contract is z.number().int().nonnegative() over a BATCHED payload:
		// one bad value would drop every model's usage for the run.
		expect(
			toConventionalTokenMap({
				inputTokens: 100.6,
				outputTokens: -3,
				cacheReadTokens: -500,
				cacheWriteTokens: 0.4,
			}),
		).toEqual({
			input_tokens: 101,
			output_tokens: 0,
			cache_read_input_tokens: 0,
			cache_creation_input_tokens: 0,
		})
	})
})

describe('toUsageEventTokenMap', () => {
	it('emits NO provenance keys on a well-formed row — the conversion is bijective there', () => {
		// The real dev row from codex-sse-vendor/gpt-5.6-sol: the raw total is
		// recoverable as input + read + creation, so extra keys carry nothing.
		expect(
			toUsageEventTokenMap({
				inputTokens: 66_404_954,
				outputTokens: 191_155,
				cacheReadTokens: 64_644_608,
				cacheWriteTokens: 0,
				reasoningTokens: 53_573,
			}),
		).toEqual({
			input_tokens: 1_760_346,
			output_tokens: 191_155,
			cache_read_input_tokens: 64_644_608,
			cache_creation_input_tokens: 0,
			reasoning_tokens: 53_573,
		})
	})

	it('keeps the raw reported triple exactly when reconciliation lost information', () => {
		// Subset violation: the stored triple sums to the total, but the raw
		// cacheWrite of 50 was cut to 20 — without the raw keys a repair job
		// could never distinguish this row from a genuine 20-write row.
		expect(
			toUsageEventTokenMap({
				inputTokens: 100,
				outputTokens: 10,
				cacheReadTokens: 80,
				cacheWriteTokens: 50,
			}),
		).toEqual({
			input_tokens: 0,
			output_tokens: 10,
			cache_read_input_tokens: 80,
			cache_creation_input_tokens: 20,
			raw_input_tokens_total: 100,
			raw_cache_read_tokens: 80,
			raw_cache_write_tokens: 50,
		})
	})

	it('keeps the raw triple when a provider noCache breakdown does not telescope', () => {
		const tokens = toUsageEventTokenMap({
			inputTokens: 1_000,
			outputTokens: 10,
			cacheReadTokens: 800,
			cacheWriteTokens: 0,
			noCacheInputTokens: 250,
		})
		// Current agentlayer-core snapshot() reconciles before emitting, so it can
		// no longer produce this shape (250 + 800 + 0 != 1000). The test defends
		// against OLDER agentlayer-core versions and non-snapshot producers, which
		// can still hand us a non-telescoping breakdown; the raw triple must survive:
		expect(tokens).toMatchObject({
			raw_input_tokens_total: 1_000,
			raw_cache_read_tokens: 800,
			raw_cache_write_tokens: 0,
		})
	})

	it('drops non-positive reasoning instead of emitting a value the contract rejects', () => {
		const tokens = toUsageEventTokenMap({
			inputTokens: 1000,
			outputTokens: 50,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			reasoningTokens: -7,
		})
		expect(tokens).not.toHaveProperty('reasoning_tokens')
		expect(tokens).not.toHaveProperty('raw_input_tokens_total')
		expect(tokens.input_tokens).toBe(1000)
	})
})
