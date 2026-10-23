import type { HostModelCatalog } from '@humanlayer/schemas/zod/model-catalog'
import { getModelOptionsForAgentProvider } from '@humanlayer/ui/constants/models'
import { describe, expect, test } from 'vitest'

import { BUNDLED_MODEL_REGISTRY, createModelRegistry, mergeHostRowsIntoBundledOrder } from '@/lib/model-registry'

const catalog: HostModelCatalog = {
	probedAt: 1,
	anthropic: {
		status: 'ok',
		models: [
			{
				provider: 'anthropic',
				value: 'opus[1m]',
				resolvedModel: 'claude-opus-5-5[1m]',
				label: 'Opus 5.5 [1m]',
				isDefault: true,
				hidden: false,
				effortLevels: ['low', 'medium', 'high'],
				supportsFastMode: true,
				supportsAutoMode: true,
			},
			{
				provider: 'anthropic',
				value: 'claude-fable-5-1[1m]',
				resolvedModel: 'claude-fable-5-1',
				label: 'Fable 5.1',
				isDefault: false,
				hidden: false,
				effortLevels: ['low', 'medium', 'high'],
				supportsFastMode: false,
				supportsAutoMode: true,
			},
			{
				provider: 'anthropic',
				value: 'sonnet',
				resolvedModel: 'claude-sonnet-5',
				label: 'Sonnet 5',
				isDefault: false,
				hidden: false,
				effortLevels: ['low', 'medium', 'high'],
				supportsFastMode: false,
				supportsAutoMode: true,
			},
			{
				provider: 'anthropic',
				value: 'haiku',
				resolvedModel: 'claude-haiku-4-5-20251001',
				label: 'Haiku 4.5',
				isDefault: false,
				hidden: false,
				effortLevels: [],
				supportsFastMode: false,
				supportsAutoMode: false,
			},
			{
				provider: 'anthropic',
				value: 'opus',
				resolvedModel: 'claude-opus-5-5',
				label: 'Opus 5.5',
				isDefault: false,
				hidden: false,
				effortLevels: ['low', 'medium', 'high'],
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
				isDefault: true,
				hidden: false,
				effortLevels: ['low', 'medium', 'ultra'],
				defaultEffort: 'medium',
				supportsFastMode: true,
				supportsAutoMode: false,
			},
			{
				provider: 'codex',
				value: 'codex-auto-review',
				label: 'Codex Auto Review',
				isDefault: false,
				hidden: true,
				effortLevels: [],
				supportsFastMode: false,
				supportsAutoMode: false,
			},
		],
	},
}

const hostModels = createModelRegistry(catalog)
const values = (options: ReadonlyArray<{ value: string }>) => options.map((option) => option.value)

describe('createModelRegistry with a host catalog', () => {
	test('Claude Code stays grouped by family, newest first, with host rows slotted in', () => {
		const offered = values(hostModels.optionsFor({ agent: 'claude', provider: 'anthropic' }))
		expect(offered).toEqual([
			'claude-fable-5-1[1m]',
			'claude-fable-5',
			'opus[1m]',
			'opus',
			'claude-opus-5',
			'claude-opus-4-8',
			'claude-opus-4-7',
			'claude-opus-4-6',
			'claude-opus-4-6-1m',
			'claude-opus-4-5',
			'sonnet',
			'claude-sonnet-5-5',
			'claude-sonnet-4-6',
			'haiku',
		])
		expect(hostModels.offers({ agent: 'claude', provider: 'anthropic', model: 'claude-opus-4-5' })).toBe(true)
	})

	test('the bare fable shorthand steps aside once the host reports a versioned Fable', () => {
		const offered = hostModels.optionsFor({ agent: 'claude', provider: 'anthropic' })
		expect(values(offered)).not.toContain('fable')
		expect(offered.slice(0, 2).map((option) => option.label)).toEqual(['Fable 5.1', 'FABLE 5'])
	})

	test('a host row covers the bundled row it resolves to, and an older version keeps its seat', () => {
		const offered = values(hostModels.optionsFor({ agent: 'claude', provider: 'anthropic' }))
		expect(offered).not.toContain('claude-sonnet-5')
		expect(offered).not.toContain('claude-haiku-4-5-20251001')
		expect(offered).not.toContain('claude-fable-5-1')
		expect(offered).toContain('claude-opus-5')
	})

	test('Codex keeps the backend order and the bundled versions the backend dropped', () => {
		const offered = values(hostModels.optionsFor({ agent: 'codelayer', provider: 'codex' }))
		expect(offered.slice(0, 3)).toEqual(['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-sol'])
		expect(offered).not.toContain('codex-auto-review')
		expect(offered.slice(-2)).toEqual(['gpt-5.4', 'gpt-5.4-mini'])
	})

	test('new Codex rows follow the host row before them, so newest stays first', () => {
		const bundled = getModelOptionsForAgentProvider({ agent: 'codelayer', provider: 'codex' })
		const row = (value: string) => ({
			provider: 'codex' as const,
			value,
			label: value,
			isDefault: false,
			hidden: false,
			effortLevels: [],
			supportsFastMode: false,
			supportsAutoMode: false,
		})
		const merged = values(
			mergeHostRowsIntoBundledOrder(
				bundled,
				[row('gpt-6-astra'), row('gpt-6-sol'), row('gpt-6-luna'), row('gpt-5.6-sol'), row('gpt-5.5')],
				'codex',
			),
		)
		expect(merged.slice(0, 5)).toEqual(['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna', 'gpt-5.6-sol'])
		expect(merged).toContain('gpt-5.6-terra')
		expect(merged.slice(-2)).toEqual(['gpt-5.4', 'gpt-5.4-mini'])
	})

	test('providers without a runtime source keep the bundled list', () => {
		expect(hostModels.optionsFor({ agent: 'fold', provider: 'xai' })).toEqual(
			getModelOptionsForAgentProvider({ agent: 'fold', provider: 'xai' }),
		)
	})

	test('a stored wire id maps back to the picker value the host offers', () => {
		expect(hostModels.hostModelFor({ agent: 'claude', provider: 'anthropic', model: 'claude-opus-5-5[1m]' })).toBe(
			'opus[1m]',
		)
		expect(hostModels.hostModelFor({ agent: 'claude', provider: 'anthropic', model: 'claude-opus-4-8' })).toBeNull()
	})

	test('labels come from the host, then the bundled table, then the raw id', () => {
		expect(hostModels.labelOf({ agent: 'claude', provider: 'anthropic', model: 'opus[1m]' })).toBe('Opus 5.5 [1m]')
		expect(hostModels.labelOf({ agent: 'claude', provider: 'anthropic', model: 'claude-opus-4-8' })).toBe(
			'OPUS 4.8',
		)
		expect(hostModels.labelOf({ agent: 'claude', provider: 'anthropic', model: 'claude-opus-9' })).toBe(
			'claude-opus-9',
		)
	})

	test('capabilities come from the probe for a host model', () => {
		const sol = hostModels.capabilitiesOf({ agent: 'codelayer', provider: 'codex', model: 'gpt-6-sol' })
		expect(sol.effort).toEqual({ supported: true, levels: ['low', 'medium', 'ultra'] })
		expect(sol.defaultEffort).toBe('medium')
		expect(sol.fastMode).toEqual({ supported: true })
		expect(sol.autoMode).toEqual({ supported: false, defaultsToAuto: false })

		const opus = hostModels.capabilitiesOf({ agent: 'claude', provider: 'anthropic', model: 'opus[1m]' })
		expect(opus.autoMode).toEqual({ supported: true, defaultsToAuto: true })
		expect(opus.fastMode).toEqual({ supported: false })
	})

	test('a model the host did not report falls back to the bundled rules', () => {
		const opus48 = hostModels.capabilitiesOf({ agent: 'claude', provider: 'anthropic', model: 'claude-opus-4-8' })
		expect(opus48.autoMode).toEqual({ supported: true, defaultsToAuto: true })
		expect(opus48.effort.supported).toBe(true)
	})
})

describe('BUNDLED_MODEL_REGISTRY', () => {
	test('answers exactly like the bundled tables', () => {
		expect(BUNDLED_MODEL_REGISTRY.optionsFor({ agent: 'claude', provider: 'anthropic' })).toEqual(
			getModelOptionsForAgentProvider({ agent: 'claude', provider: 'anthropic' }),
		)
		expect(
			BUNDLED_MODEL_REGISTRY.hostModelFor({ agent: 'claude', provider: 'anthropic', model: 'opus' }),
		).toBeNull()
		expect(
			BUNDLED_MODEL_REGISTRY.capabilitiesOf({ agent: 'claude', provider: 'anthropic', model: 'claude-opus-4-8' })
				.autoMode,
		).toEqual({ supported: true, defaultsToAuto: true })
	})
})
