import { describe, expect, test } from 'vitest'

import { CODEX_CONTEXT_WINDOWS, getEffectiveContextWindowSize } from './context-window'

describe('getEffectiveContextWindowSize', () => {
	test('returns 168000 for Haiku models', () => {
		expect(getEffectiveContextWindowSize(null, 'haiku', null)).toBe(168000)
		expect(getEffectiveContextWindowSize('anthropic', 'claude-haiku-4-5-20251001', null)).toBe(168000)
	})

	test('returns the private Codex API window for codex-provider models', () => {
		expect(getEffectiveContextWindowSize('codex', 'gpt-5.5', null)).toBe(CODEX_CONTEXT_WINDOWS['gpt-5.5'])
		expect(getEffectiveContextWindowSize('codex', 'gpt-5-codex', null)).toBe(CODEX_CONTEXT_WINDOWS['gpt-5.5'])
		expect(getEffectiveContextWindowSize('codex', 'unknown-codex-model', null)).toBe(
			CODEX_CONTEXT_WINDOWS['gpt-5.5'],
		)
		expect(getEffectiveContextWindowSize('codex', null, null)).toBe(CODEX_CONTEXT_WINDOWS['gpt-5.5'])
	})

	test('returns the larger private Codex API window for GPT-5.6 models', () => {
		expect(getEffectiveContextWindowSize('codex', 'gpt-5.6-sol', null)).toBe(CODEX_CONTEXT_WINDOWS['gpt-5.6-sol'])
		expect(getEffectiveContextWindowSize('codex', 'gpt-5.6-terra', null)).toBe(
			CODEX_CONTEXT_WINDOWS['gpt-5.6-terra'],
		)
		expect(getEffectiveContextWindowSize('codex', 'gpt-5.6-luna', null)).toBe(CODEX_CONTEXT_WINDOWS['gpt-5.6-luna'])
	})

	test('keeps openai-provider GPT-5.5 on the public API window', () => {
		expect(getEffectiveContextWindowSize('openai', 'gpt-5.5', null)).toBe(1050000)
	})

	test('returns 968000 for base opus / 5 / 4.7 / 4.8 (1M-window models)', () => {
		expect(getEffectiveContextWindowSize(null, 'opus', null)).toBe(968000)
		expect(getEffectiveContextWindowSize(null, 'claude-opus-5', null)).toBe(968000)
		expect(getEffectiveContextWindowSize(null, 'claude-opus-4-7', null)).toBe(968000)
		expect(getEffectiveContextWindowSize(null, 'claude-opus-4-8', null)).toBe(968000)
	})

	test('returns 968000 for Sonnet 5 and its alias', () => {
		expect(getEffectiveContextWindowSize(null, 'sonnet', null)).toBe(968000)
		expect(getEffectiveContextWindowSize(null, 'claude-sonnet-5', null)).toBe(968000)
	})

	test('returns 968000 for stale removed 1M strings (back-compat fold)', () => {
		expect(getEffectiveContextWindowSize(null, 'opus-1m', null)).toBe(968000)
		expect(getEffectiveContextWindowSize(null, 'opus[1m]', null)).toBe(968000)
		expect(getEffectiveContextWindowSize(null, 'claude-opus-4-8-1m', null)).toBe(968000)
		expect(getEffectiveContextWindowSize(null, 'claude-opus-4-8[1m]', null)).toBe(968000)
	})

	test('returns 968000 for surviving claude-opus-4-6 1M variant', () => {
		expect(getEffectiveContextWindowSize(null, 'claude-opus-4-6[1m]', null)).toBe(968000)
	})

	test('returns 968000 for Fable models', () => {
		expect(getEffectiveContextWindowSize(null, 'claude-fable-5', null)).toBe(968000)
	})

	test('returns 168000 for claude-opus-4-6 without [1m]', () => {
		expect(getEffectiveContextWindowSize(null, 'claude-opus-4-6', null)).toBe(168000)
	})

	test('returns 968000 for unmatched Claude model IDs', () => {
		expect(getEffectiveContextWindowSize(null, 'claude-sonnet-4-6', null)).toBe(968000)
		expect(getEffectiveContextWindowSize('anthropic', 'claude-unknown-9', null)).toBe(968000)
	})

	test('returns 968000 for null and undefined', () => {
		expect(getEffectiveContextWindowSize(null, null, null)).toBe(968000)
		expect(getEffectiveContextWindowSize(null, undefined, null)).toBe(968000)
	})
})
