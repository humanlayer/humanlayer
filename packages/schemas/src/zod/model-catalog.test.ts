import { describe, expect, test } from 'vitest'

import {
	findHostModelCatalogEntry,
	type HostModelCatalog,
	HostModelCatalogSchema,
	unavailableHostModelCatalogProvider,
	visibleHostModelCatalogEntries,
} from './model-catalog'

const catalog: HostModelCatalog = {
	probedAt: 1,
	anthropic: {
		status: 'ok',
		models: [
			{
				provider: 'anthropic',
				value: 'opus[1m]',
				resolvedModel: 'claude-opus-5[1m]',
				label: 'Opus (1M context)',
				isDefault: true,
				hidden: false,
				effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
				supportsFastMode: true,
				supportsAutoMode: true,
			},
		],
	},
	codex: {
		status: 'ok',
		models: [
			{
				provider: 'codex',
				value: 'gpt-6-sol',
				label: 'GPT-6-Sol',
				isDefault: false,
				hidden: false,
				effortLevels: ['low', 'medium', 'ultra'],
				defaultEffort: 'medium',
				supportsFastMode: true,
				supportsAutoMode: false,
				contextWindow: 258_400,
			},
			{
				provider: 'codex',
				value: 'gpt-reserve',
				label: 'GPT-Reserve',
				isDefault: false,
				hidden: true,
				effortLevels: [],
				supportsFastMode: false,
				supportsAutoMode: false,
			},
		],
	},
}

describe('HostModelCatalogSchema', () => {
	test('round-trips a probed catalog', () => {
		expect(HostModelCatalogSchema.parse(catalog)).toEqual(catalog)
	})

	test('accepts an unavailable provider with a reason', () => {
		const parsed = HostModelCatalogSchema.parse({
			probedAt: 1,
			anthropic: unavailableHostModelCatalogProvider('not_logged_in'),
			codex: catalog.codex,
		})
		expect(parsed.anthropic).toEqual({ status: 'unavailable', reason: 'not_logged_in', models: [] })
	})
})

describe('visibleHostModelCatalogEntries', () => {
	test('drops hidden rows and returns null when the provider did not probe', () => {
		expect(visibleHostModelCatalogEntries(catalog, 'codex')?.map((entry) => entry.value)).toEqual(['gpt-6-sol'])
		expect(
			visibleHostModelCatalogEntries({ ...catalog, codex: unavailableHostModelCatalogProvider('x') }, 'codex'),
		).toBeNull()
		expect(visibleHostModelCatalogEntries(null, 'anthropic')).toBeNull()
	})
})

describe('findHostModelCatalogEntry', () => {
	test('matches by picker value and by resolved wire id', () => {
		expect(findHostModelCatalogEntry(catalog, 'anthropic', 'opus[1m]')?.value).toBe('opus[1m]')
		expect(findHostModelCatalogEntry(catalog, 'anthropic', 'claude-opus-5[1m]')?.value).toBe('opus[1m]')
	})

	test('returns null without a provider, a model, or a probed catalog', () => {
		expect(findHostModelCatalogEntry(catalog, null, 'opus[1m]')).toBeNull()
		expect(findHostModelCatalogEntry(catalog, 'codex', null)).toBeNull()
		expect(findHostModelCatalogEntry(null, 'codex', 'gpt-6-sol')).toBeNull()
		expect(findHostModelCatalogEntry(catalog, 'codex', 'gpt-5.5')).toBeNull()
	})
})
