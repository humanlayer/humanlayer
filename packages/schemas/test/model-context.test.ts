import { describe, expect, test } from 'vitest'

import { getContextWindowUsagePercentage, resolveEffectiveContextWindow } from '../src/effect/model-context'

describe('resolveEffectiveContextWindow', () => {
	test('provider-specific Codex overrides win over runtime and catalog values', () => {
		expect(
			resolveEffectiveContextWindow({
				provider: 'codex',
				model: 'gpt-5.6-sol',
				runtimeContextWindow: 900_000,
				catalogContextWindow: 1_050_000,
			}),
		).toBe(258_400)
	})

	test.each([
		'gpt-6.1-sol',
		'gpt-6-astra',
		'gpt-6-sol',
		'gpt-6-luna',
		'gpt-5.6-sol',
		'gpt-5.6-terra',
		'gpt-5.6-luna',
	])('%s uses the current Codex usable limit', (model) => {
		expect(resolveEffectiveContextWindow({ provider: 'codex', model })).toBe(258_400)
	})

	test('preserves the private Codex fallback for unknown and missing models', () => {
		expect(resolveEffectiveContextWindow({ provider: 'codex', model: 'unknown' })).toBe(258_400)
		expect(resolveEffectiveContextWindow({ provider: 'codex' })).toBe(258_400)
	})

	test.each(['grok-4.5', 'grok-4.6'])('%s uses the verified Grok context limit', (model) => {
		expect(resolveEffectiveContextWindow({ provider: 'xai', model })).toBe(500_000)
	})

	test('uses runtime, catalog, family, then general fallback order', () => {
		expect(
			resolveEffectiveContextWindow({
				provider: 'openai',
				model: 'gpt-5.5',
				runtimeContextWindow: 800_000,
				catalogContextWindow: 1_050_000,
			}),
		).toBe(800_000)
		expect(resolveEffectiveContextWindow({ model: 'custom', catalogContextWindow: 700_000 })).toBe(700_000)
		expect(resolveEffectiveContextWindow({ model: 'claude-opus-4-8[1m]' })).toBe(968_000)
		expect(resolveEffectiveContextWindow({ model: 'claude-opus-5-5' })).toBe(968_000)
		expect(resolveEffectiveContextWindow({ model: 'claude-sonnet-5-5' })).toBe(968_000)
		expect(resolveEffectiveContextWindow({ model: 'haiku' })).toBe(168_000)
		expect(resolveEffectiveContextWindow({ provider: 'anthropic', model: 'claude-unknown-9' })).toBe(968_000)
		expect(resolveEffectiveContextWindow({})).toBe(968_000)
	})

	test('ignores invalid runtime and catalog values', () => {
		expect(
			resolveEffectiveContextWindow({
				model: 'haiku',
				runtimeContextWindow: 0,
				catalogContextWindow: Number.NaN,
			}),
		).toBe(168_000)
	})
})

describe('getContextWindowUsagePercentage', () => {
	test('matches the Codex gauge after excluding its fixed baseline', () => {
		expect(getContextWindowUsagePercentage('codex', 12_000, 258_400)).toBe(0)
		expect(getContextWindowUsagePercentage('codex', 240_000, 258_400)).toBe(93)
		expect(getContextWindowUsagePercentage('codex', 300_000, 258_400)).toBe(100)
	})

	test('preserves the direct percentage calculation for other providers', () => {
		expect(getContextWindowUsagePercentage('anthropic', 84_000, 168_000)).toBe(50)
	})
})
