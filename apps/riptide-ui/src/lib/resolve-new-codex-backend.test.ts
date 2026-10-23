import { describe, expect, test } from 'vitest'

import { resolveNewCodexBackend, resolveNewSessionFastMode } from './resolve-new-codex-backend'

describe('resolveNewCodexBackend', () => {
	test('uses CodeLayer while the Fold experiment is disabled', () => {
		expect(resolveNewCodexBackend({ codingAgent: 'codelayer', useFoldCodingAgent: false })).toBe('codelayer')
	})

	test('uses Fold for a new visible Codex selection when enabled', () => {
		expect(resolveNewCodexBackend({ codingAgent: 'codelayer', useFoldCodingAgent: true })).toBe('fold')
	})

	test('leaves all other persisted backends unchanged', () => {
		expect(resolveNewCodexBackend({ codingAgent: 'claude', useFoldCodingAgent: true })).toBe('claude')
		expect(resolveNewCodexBackend({ codingAgent: 'fold', useFoldCodingAgent: false })).toBe('fold')
	})

	test('disables Fast Mode for new Fold sessions', () => {
		expect(resolveNewSessionFastMode({ codingAgent: 'codelayer', fastMode: true, useFoldCodingAgent: true })).toBe(
			false,
		)
		expect(resolveNewSessionFastMode({ codingAgent: 'codelayer', fastMode: true, useFoldCodingAgent: false })).toBe(
			true,
		)
	})
})
