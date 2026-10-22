import { describe, expect, test } from 'vitest'

import {
	CONTEXT_WARNING_TOKEN_THRESHOLD,
	CONTEXT_WARNING_TOKEN_THRESHOLD_LARGE,
	getContextWarningThreshold,
} from '@/lib/context-warning'

describe('getContextWarningThreshold', () => {
	test('Haiku models warn at 100k', () => {
		expect(getContextWarningThreshold(null, 'haiku')).toBe(CONTEXT_WARNING_TOKEN_THRESHOLD)
		expect(getContextWarningThreshold('anthropic', 'claude-haiku-4-5-20251001')).toBe(
			CONTEXT_WARNING_TOKEN_THRESHOLD,
		)
	})

	test('claude-opus-4-6 warns at 100k', () => {
		expect(getContextWarningThreshold(null, 'claude-opus-4-6')).toBe(CONTEXT_WARNING_TOKEN_THRESHOLD)
	})

	test('unmatched Claude models fall back to the 1M window and warn at 200k', () => {
		expect(getContextWarningThreshold(null, 'claude-sonnet-4-6')).toBe(CONTEXT_WARNING_TOKEN_THRESHOLD_LARGE)
	})

	test('null and undefined fall back to the 1M window and warn at 200k', () => {
		expect(getContextWarningThreshold(null, null)).toBe(CONTEXT_WARNING_TOKEN_THRESHOLD_LARGE)
		expect(getContextWarningThreshold(undefined, undefined)).toBe(CONTEXT_WARNING_TOKEN_THRESHOLD_LARGE)
	})

	test('base 1M-context Claude models warn at 200k', () => {
		expect(getContextWarningThreshold(null, 'opus')).toBe(CONTEXT_WARNING_TOKEN_THRESHOLD_LARGE)
		expect(getContextWarningThreshold(null, 'sonnet')).toBe(CONTEXT_WARNING_TOKEN_THRESHOLD_LARGE)
		expect(getContextWarningThreshold(null, 'claude-opus-5')).toBe(CONTEXT_WARNING_TOKEN_THRESHOLD_LARGE)
		expect(getContextWarningThreshold(null, 'claude-opus-4-8')).toBe(CONTEXT_WARNING_TOKEN_THRESHOLD_LARGE)
		expect(getContextWarningThreshold(null, 'claude-opus-4-7')).toBe(CONTEXT_WARNING_TOKEN_THRESHOLD_LARGE)
		expect(getContextWarningThreshold(null, 'claude-sonnet-5')).toBe(CONTEXT_WARNING_TOKEN_THRESHOLD_LARGE)
	})

	test('back-compat removed 1M strings still warn at 200k', () => {
		expect(getContextWarningThreshold(null, 'opus[1m]')).toBe(CONTEXT_WARNING_TOKEN_THRESHOLD_LARGE)
		expect(getContextWarningThreshold(null, 'claude-opus-4-8[1m]')).toBe(CONTEXT_WARNING_TOKEN_THRESHOLD_LARGE)
		expect(getContextWarningThreshold(null, 'claude-opus-4-8-1m')).toBe(CONTEXT_WARNING_TOKEN_THRESHOLD_LARGE)
		expect(getContextWarningThreshold(null, 'claude-opus-4-6-1m')).toBe(CONTEXT_WARNING_TOKEN_THRESHOLD_LARGE)
	})

	test('codex / GPT-5 models warn at 200k', () => {
		expect(getContextWarningThreshold('codex', 'gpt-5-codex')).toBe(CONTEXT_WARNING_TOKEN_THRESHOLD_LARGE)
		expect(getContextWarningThreshold('codex', 'gpt-5.5')).toBe(CONTEXT_WARNING_TOKEN_THRESHOLD_LARGE)
		expect(getContextWarningThreshold('codex', 'gpt-5.1')).toBe(CONTEXT_WARNING_TOKEN_THRESHOLD_LARGE)
	})

	test('OpenAI GPT-5 models still warn at 200k', () => {
		expect(getContextWarningThreshold('openai', 'gpt-5.5')).toBe(CONTEXT_WARNING_TOKEN_THRESHOLD_LARGE)
	})
})
