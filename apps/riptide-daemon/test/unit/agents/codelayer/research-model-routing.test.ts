import type { HostModelCatalog } from '@humanlayer/schemas/zod/model-catalog'
import { describe, expect, test } from 'vitest'

import { getResearchSubagentModelId } from '../../../../src/agents/codelayer/research-model-routing'

function catalogWithCodexModels(values: string[]): HostModelCatalog {
	return {
		probedAt: 1,
		anthropic: { status: 'unavailable', reason: 'test', models: [] },
		codex: {
			status: 'ok',
			models: values.map((value) => ({
				provider: 'codex',
				value,
				label: value,
				isDefault: false,
				hidden: false,
				effortLevels: [],
				supportsFastMode: false,
				supportsAutoMode: false,
			})),
		},
	}
}

describe('getResearchSubagentModelId', () => {
	test.each([
		'gpt-6.1-sol',
		'gpt-6-astra',
		'gpt-6-sol',
		'gpt-6-luna',
		'gpt-5.6-sol',
		'gpt-5.6-terra',
		'gpt-5.6-luna',
	])('routes Codex %s research to Terra', (modelId) => {
		expect(getResearchSubagentModelId('codex', modelId, undefined)).toBe('gpt-5.6-terra')
	})

	test.each([
		['codex', 'gpt-5.5'],
		['anthropic', 'claude-opus-4-5'],
		['firepass', 'accounts/fireworks/routers/kimi-k2p5-turbo'],
	] as const)('does not override %s/%s research', (provider, modelId) => {
		expect(getResearchSubagentModelId(provider, modelId, undefined)).toBeUndefined()
	})

	test('keeps routing while the probed catalog still offers Terra', () => {
		const catalog = catalogWithCodexModels(['gpt-6-astra', 'gpt-5.6-terra'])
		expect(getResearchSubagentModelId('codex', 'gpt-6-astra', catalog)).toBe('gpt-5.6-terra')
	})

	test('stops routing once the backend no longer offers Terra', () => {
		const catalog = catalogWithCodexModels(['gpt-6-astra', 'gpt-6-sol'])
		expect(getResearchSubagentModelId('codex', 'gpt-6-astra', catalog)).toBeUndefined()
	})
})
