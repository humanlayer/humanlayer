import { describe, expect, test } from 'vitest'

import { catalogProviderFor, getModelOptionsForAgentProvider, modelLabel } from './models'

describe('catalogProviderFor', () => {
	test('maps agent and provider onto the runtime that can enumerate models', () => {
		expect(catalogProviderFor({ agent: 'claude', provider: 'anthropic' })).toBe('anthropic')
		expect(catalogProviderFor({ agent: 'codelayer', provider: 'anthropic' })).toBeNull()
		expect(catalogProviderFor({ agent: 'codelayer', provider: 'codex' })).toBe('codex')
		expect(catalogProviderFor({ agent: 'fold', provider: 'codex' })).toBe('codex')
		expect(catalogProviderFor({ agent: 'fold', provider: 'xai' })).toBeNull()
		expect(catalogProviderFor({ agent: 'codelayer', provider: 'copilot' })).toBeNull()
	})
})

describe('modelLabel', () => {
	test('prefers the picker rows, then the bundled label, then the raw id', () => {
		const options = [{ value: 'opus[1m]', label: 'Opus (1M context)' }]
		expect(modelLabel('opus[1m]', options)).toBe('Opus (1M context)')
		expect(modelLabel('claude-opus-4-8', options)).toBe('OPUS 4.8')
		expect(modelLabel('claude-opus-9', options)).toBe('claude-opus-9')
		expect(modelLabel('claude-opus-9')).toBe('claude-opus-9')
	})

	test('bundled rows keep their labels', () => {
		const options = getModelOptionsForAgentProvider({ agent: 'claude', provider: 'anthropic' })
		expect(modelLabel('opus', options)).toBe('OPUS')
	})
})
