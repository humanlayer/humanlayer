import type { ModelInfo } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, test } from 'vitest'

import {
	claudeModelInfosToCatalog,
	claudeModelLabel,
} from '../../../../../src/effects/services/host-model-catalog/probe-claude-models'
import {
	type CodexBackendModel,
	codexBackendModelsToCatalog,
} from '../../../../../src/effects/services/host-model-catalog/probe-codex-models'

const claudeInfos: ModelInfo[] = [
	{
		value: 'default',
		resolvedModel: 'claude-opus-5[1m]',
		displayName: 'Default (recommended)',
		description: 'Opus 5 with 1M context',
		supportsEffort: true,
		supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
		supportsFastMode: true,
		supportsAutoMode: true,
	},
	{
		value: 'opus[1m]',
		resolvedModel: 'claude-opus-5[1m]',
		displayName: 'Opus (1M context)',
		description: 'Opus 5 with 1M context',
		supportsEffort: true,
		supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
		supportsFastMode: true,
		supportsAutoMode: true,
	},
	{
		value: 'haiku',
		resolvedModel: 'claude-haiku-4-5-20251001',
		displayName: 'Haiku',
		description: 'Haiku 4.5',
	},
]

describe('claudeModelInfosToCatalog', () => {
	test('drops the default alias row and marks the model it resolves to as default', () => {
		const entries = claudeModelInfosToCatalog(claudeInfos)
		expect(entries.map((entry) => entry.value)).toEqual(['opus[1m]', 'haiku'])
		expect(entries[0]).toMatchObject({
			provider: 'anthropic',
			resolvedModel: 'claude-opus-5[1m]',
			label: 'Opus 5 [1m]',
			isDefault: true,
			hidden: false,
			effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
			supportsFastMode: true,
			supportsAutoMode: true,
		})
	})

	test('a model without effort support reports no effort levels', () => {
		const haiku = claudeModelInfosToCatalog(claudeInfos)[1]
		expect(haiku).toMatchObject({
			isDefault: false,
			effortLevels: [],
			supportsFastMode: false,
			supportsAutoMode: false,
		})
	})
})

const codexModels: CodexBackendModel[] = [
	{
		slug: 'gpt-reserve',
		display_name: 'GPT-Reserve',
		visibility: 'hide',
		priority: 3,
		context_window: 272_000,
		supported_reasoning_levels: [{ effort: 'low' }, { effort: 'medium' }],
		service_tiers: [{ id: 'priority' }],
	},
	{
		slug: 'gpt-6-sol',
		display_name: 'GPT-6-Sol',
		visibility: 'list',
		priority: 2,
		context_window: 272_000,
		default_reasoning_level: 'medium',
		supported_reasoning_levels: [{ effort: 'low' }, { effort: 'medium' }, { effort: 'ultra' }],
		service_tiers: [{ id: 'priority' }],
	},
	{
		slug: 'gpt-6-astra',
		display_name: 'GPT-6-Astra',
		visibility: 'list',
		priority: 1,
		context_window: 272_000,
		effective_context_window_percent: 90,
		supported_reasoning_levels: ['low', 'medium'],
		service_tiers: [],
	},
]

describe('codexBackendModelsToCatalog', () => {
	test('sorts by priority and marks the first visible model as default', () => {
		const entries = codexBackendModelsToCatalog(codexModels)
		expect(entries.map((entry) => entry.value)).toEqual(['gpt-6-astra', 'gpt-6-sol', 'gpt-reserve'])
		expect(entries.map((entry) => entry.isDefault)).toEqual([true, false, false])
	})

	test('derives capability flags from the backend row', () => {
		const [astra, sol, reserve] = codexBackendModelsToCatalog(codexModels)
		expect(sol).toMatchObject({
			provider: 'codex',
			label: 'GPT-6-Sol',
			hidden: false,
			effortLevels: ['low', 'medium', 'ultra'],
			defaultEffort: 'medium',
			supportsFastMode: true,
			supportsAutoMode: false,
			contextWindow: 258_400,
		})
		expect(astra).toMatchObject({ supportsFastMode: false, contextWindow: 244_800 })
		expect(reserve).toMatchObject({ hidden: true })
	})
})

describe('catalog rows are always publishable', () => {
	test('an empty Codex display name falls back to the slug and empty efforts are dropped', () => {
		const [entry] = codexBackendModelsToCatalog([
			{
				slug: 'gpt-blank',
				display_name: '',
				visibility: 'list',
				default_reasoning_level: '',
				supported_reasoning_levels: [{ effort: '' }, { effort: 'low' }],
			},
		])
		expect(entry).toMatchObject({ label: 'gpt-blank', effortLevels: ['low'], defaultEffort: undefined })
	})

	test('a Codex default effort the model does not list is dropped', () => {
		const [entry] = codexBackendModelsToCatalog([
			{
				slug: 'gpt-x',
				visibility: 'list',
				default_reasoning_level: 'ultra',
				supported_reasoning_levels: ['low'],
			},
		])
		expect(entry?.defaultEffort).toBeUndefined()
	})

	test('an empty Claude display name falls back to the value', () => {
		const [entry] = claudeModelInfosToCatalog([
			{
				value: 'opus',
				displayName: '   ',
				description: '',
				supportsEffort: true,
				supportedEffortLevels: ['low'],
			},
		])
		expect(entry).toMatchObject({ label: 'opus', effortLevels: ['low'] })
	})
})

describe('claudeModelLabel', () => {
	test('shows the version an alias runs today, taken from the description', () => {
		expect(
			claudeModelLabel({
				value: 'opus',
				displayName: 'Opus',
				description: 'Opus 5.5 · Best for everyday, complex tasks',
			}),
		).toBe('Opus 5.5')
		expect(
			claudeModelLabel({
				value: 'opus[1m]',
				displayName: 'Opus (1M context)',
				description: 'Opus 5.5 with 1M context · Best for everyday, complex tasks',
			}),
		).toBe('Opus 5.5 [1m]')
	})

	test('keeps a display name that already carries a version, and falls back to the value', () => {
		expect(claudeModelLabel({ value: 'x', displayName: 'Fable 5.1', description: 'anything' })).toBe('Fable 5.1')
		expect(claudeModelLabel({ value: 'sonnet', displayName: 'Sonnet', description: 'Fast' })).toBe('Sonnet')
		expect(claudeModelLabel({ value: 'haiku', displayName: '', description: '' })).toBe('haiku')
	})
})
