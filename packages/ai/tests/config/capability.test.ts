import { describe, expect, test } from 'vitest'

import {
	getDefaultEffort,
	getEffortCapability,
	getFastModeCapability,
	isEffortSupported,
	isFastModeSupported,
} from '../../src/config/index'

describe('getEffortCapability', () => {
	test('Fable models support all five effort levels', () => {
		for (const model of ['fable', 'claude-fable-5-1', 'anthropic.claude-fable-5-1', 'claude-fable-5']) {
			const cap = getEffortCapability('claude', 'anthropic', model)
			expect(cap.supported).toBe(true)
			if (cap.supported) expect(cap.levels).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
		}

		// CodeLayer's existing alias behavior remains unchanged; Fable 5.1 is a Claude Code-only picker option.
		for (const agent of ['claude', 'codelayer'] as const) {
			const cap = getEffortCapability(agent, 'anthropic', 'fable')
			expect(cap.supported).toBe(true)
			if (cap.supported) expect(cap.levels).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
		}
	})
	test('opus 5 and 5.5 support all five levels for Claude and CodeLayer Anthropic', () => {
		for (const agent of ['claude', 'codelayer'] as const) {
			for (const model of [
				'claude-opus-5-5',
				'anthropic.claude-opus-5-5',
				'anthropic_claude_opus_5_5',
				'claude-opus-5',
				'anthropic.claude-opus-5',
				'anthropic_claude_opus_5',
			]) {
				const cap = getEffortCapability(agent, 'anthropic', model)
				expect(cap.supported).toBe(true)
				if (cap.supported) expect(cap.levels).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
			}
		}
	})
	test('opus 4.8 family supports all five levels (incl. removed 1M strings folding to base)', () => {
		for (const model of ['claude-opus-4-8', 'claude-opus-4-8-1m', 'claude-opus-4-8[1m]']) {
			const cap = getEffortCapability('claude', 'anthropic', model)
			expect(cap.supported).toBe(true)
			if (cap.supported) expect(cap.levels).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
		}
	})
	test('opus 4.7 family supports all five levels (incl. removed 1M strings folding to base)', () => {
		for (const model of ['opus', 'opus-1m', 'claude-opus-4-7', 'claude-opus-4-7-1m', 'claude-opus-4-7[1m]']) {
			const cap = getEffortCapability('claude', 'anthropic', model)
			expect(cap.supported).toBe(true)
			if (cap.supported) expect(cap.levels).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
		}
	})
	test('opus 4.6 family supports four levels (no xhigh); 1M sibling preserved', () => {
		for (const model of ['claude-opus-4-6', 'claude-opus-4-6-1m', 'claude-opus-4-6[1m]']) {
			const cap = getEffortCapability('claude', 'anthropic', model)
			expect(cap.supported).toBe(true)
			if (cap.supported) expect(cap.levels).toEqual(['low', 'medium', 'high', 'max'])
		}
	})
	test('sonnet 5 family supports all five levels and normalizes generic aliases', () => {
		for (const model of ['sonnet', 'sonnet-5', 'claude-sonnet-5']) {
			const cap = getEffortCapability('claude', 'anthropic', model)
			expect(cap.supported).toBe(true)
			if (cap.supported) expect(cap.levels).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
		}
	})
	test('sonnet 5.5 supports all five levels for Claude and CodeLayer Anthropic without folding into Sonnet 5', () => {
		for (const agent of ['claude', 'codelayer'] as const) {
			for (const model of ['claude-sonnet-5-5', 'anthropic.claude-sonnet-5-5', 'anthropic_claude_sonnet_5_5']) {
				const cap = getEffortCapability(agent, 'anthropic', model)
				expect(cap).toEqual({ supported: true, levels: ['low', 'medium', 'high', 'xhigh', 'max'] })
			}
			expect(getDefaultEffort(agent, 'anthropic', 'claude-sonnet-5-5')).toBe('high')
			expect(getFastModeCapability(agent, 'anthropic', 'claude-sonnet-5-5')).toEqual({ supported: false })
		}
	})
	test('sonnet 4.6 keeps four levels when explicitly selected', () => {
		const cap = getEffortCapability('claude', 'anthropic', 'claude-sonnet-4-6')
		expect(cap).toEqual({ supported: true, levels: ['low', 'medium', 'high', 'max'] })
	})
	test('opus 4.5 only supports base levels', () => {
		const cap = getEffortCapability('claude', 'anthropic', 'claude-opus-4-5')
		expect(cap).toEqual({ supported: true, levels: ['low', 'medium', 'high'] })
	})
	test('haiku is non-eligible', () => {
		expect(getEffortCapability('claude', 'anthropic', 'claude-haiku-4-5-20251001')).toEqual({
			supported: false,
		})
	})
	test('codex gpt-5.4/gpt-5.5 family supports the standard reasoning levels', () => {
		for (const model of ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini']) {
			const cap = getEffortCapability('codelayer', 'codex', model)
			expect(cap).toEqual({
				supported: true,
				levels: ['low', 'medium', 'high', 'xhigh'],
			})
		}
	})
	test('CodeLayer GPT-6 and GPT-5.6 models support all five HumanLayer effort levels', () => {
		for (const model of [
			'gpt-6.1-sol',
			'gpt-6-astra',
			'gpt-6-sol',
			'gpt-6-luna',
			'gpt-5.6-sol',
			'gpt-5.6-terra',
			'gpt-5.6-luna',
		]) {
			const cap = getEffortCapability('codelayer', 'codex', model)
			expect(cap).toEqual({
				supported: true,
				levels: ['low', 'medium', 'high', 'xhigh', 'max'],
			})
		}
	})
	test('fold applies its explicit Riptide Codex reasoning policy', () => {
		for (const model of ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna']) {
			expect(getEffortCapability('fold', 'codex', model)).toEqual({
				supported: true,
				levels: ['low', 'medium', 'high', 'xhigh', 'max'],
			})
			expect(getDefaultEffort('fold', 'codex', model)).toBe('medium')
		}
		expect(getEffortCapability('fold', 'codex', 'gpt-5.6-sol')).toEqual({
			supported: true,
			levels: ['low', 'medium', 'high', 'xhigh', 'max'],
		})
		expect(getEffortCapability('fold', 'codex', 'gpt-5.5')).toEqual({
			supported: true,
			levels: ['low', 'medium', 'high', 'xhigh'],
		})
		expect(getDefaultEffort('fold', 'codex', 'gpt-5.6-sol')).toBe('medium')
		expect(getEffortCapability('fold', 'codex', 'gpt-5.3-codex')).toEqual({ supported: false })
		expect(getEffortCapability('fold', 'anthropic', 'gpt-5.6-sol')).toEqual({ supported: false })
	})
	test('fold supports reasoning for frontier Grok models', () => {
		for (const model of ['grok-4.5', 'grok-4.6']) {
			expect(getEffortCapability('fold', 'xai', model)).toEqual({
				supported: true,
				levels: ['low', 'medium', 'high', 'xhigh'],
			})
			expect(getDefaultEffort('fold', 'xai', model)).toBe('medium')
		}
		expect(getEffortCapability('fold', 'xai', 'grok-unverified')).toEqual({ supported: false })
	})
	test('removed codex gpt-5.3 models are not selectable for reasoning', () => {
		expect(getEffortCapability('codelayer', 'codex', 'gpt-5.3-codex')).toEqual({ supported: false })
		expect(getEffortCapability('codelayer', 'codex', 'gpt-5.3-codex-spark')).toEqual({ supported: false })
	})
	test('codelayer anthropic supports aliases and versioned Sonnet efforts', () => {
		for (const model of ['opus', 'claude-opus-5', 'claude-opus-4-8', 'sonnet', 'sonnet-5', 'claude-sonnet-5']) {
			const cap = getEffortCapability('codelayer', 'anthropic', model)
			expect(cap.supported).toBe(true)
			if (cap.supported) expect(cap.levels).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
		}

		expect(getEffortCapability('codelayer', 'anthropic', 'claude-sonnet-4-6')).toEqual({
			supported: true,
			levels: ['low', 'medium', 'high', 'max'],
		})
	})
})

describe('getFastModeCapability', () => {
	test('Fast Mode is disabled for all Claude models', () => {
		for (const model of [
			'opus',
			'opus-1m',
			'claude-opus-5',
			'claude-opus-4-8',
			'claude-opus-4-8-1m',
			'claude-opus-4-8[1m]',
			'claude-opus-4-7',
			'claude-opus-4-7-1m',
			'claude-opus-4-6',
			'claude-opus-4-6-1m',
			'sonnet',
			'claude-sonnet-5',
			'claude-sonnet-4-6',
			'claude-opus-4-5',
		]) {
			expect(getFastModeCapability('claude', 'anthropic', model)).toEqual({ supported: false })
		}
		expect(getFastModeCapability('codelayer', 'anthropic', 'claude-opus-5-5')).toEqual({ supported: false })
		expect(getFastModeCapability('fold', 'codex', 'claude-opus-5-5')).toEqual({ supported: false })
	})
	test('CodeLayer Codex frontier models are fast-mode-eligible; unsupported tuples are not', () => {
		expect(getFastModeCapability('codelayer', 'codex', 'gpt-6-astra')).toEqual({ supported: true })
		expect(getFastModeCapability('codelayer', 'codex', 'gpt-6-sol')).toEqual({ supported: true })
		expect(getFastModeCapability('codelayer', 'codex', 'gpt-6-luna')).toEqual({ supported: true })
		expect(getFastModeCapability('codelayer', 'codex', 'gpt-5.6-sol')).toEqual({ supported: true })
		expect(getFastModeCapability('codelayer', 'codex', 'gpt-5.6-terra')).toEqual({ supported: true })
		expect(getFastModeCapability('codelayer', 'codex', 'gpt-5.6-luna')).toEqual({ supported: true })
		expect(getFastModeCapability('codelayer', 'codex', 'gpt-5.5')).toEqual({ supported: true })
		expect(getFastModeCapability('codelayer', 'codex', 'gpt-5.4')).toEqual({ supported: true })
		expect(getFastModeCapability('codelayer', 'codex', 'gpt-5.4-mini')).toEqual({
			supported: false,
		})
		expect(getFastModeCapability('claude', 'anthropic', 'gpt-6-sol')).toEqual({ supported: false })
		expect(getFastModeCapability('codelayer', 'anthropic', 'gpt-6-sol')).toEqual({ supported: false })
		expect(getFastModeCapability('fold', 'codex', 'gpt-6-sol')).toEqual({ supported: false })
		expect(getFastModeCapability('codelayer', 'codex', 'gpt-6.1-sol')).toEqual({ supported: false })
		expect(getFastModeCapability('fold', 'codex', 'gpt-6.1-sol')).toEqual({ supported: false })
	})
})

describe('boundary guards', () => {
	test('isEffortSupported returns true for null effort', () => {
		expect(isEffortSupported('claude', 'anthropic', 'claude-opus-4-5', null)).toBe(true)
	})
	test('isEffortSupported rejects xhigh on opus 4.5', () => {
		expect(isEffortSupported('claude', 'anthropic', 'claude-opus-4-5', 'xhigh')).toBe(false)
	})
	test('isEffortSupported enforces the Fold model policy', () => {
		expect(isEffortSupported('fold', 'codex', 'gpt-6-sol', 'max')).toBe(true)
		expect(isEffortSupported('codelayer', 'codex', 'gpt-6.1-sol', 'max')).toBe(true)
		expect(isEffortSupported('fold', 'codex', 'gpt-6.1-sol', 'max')).toBe(true)
		expect(isEffortSupported('fold', 'codex', 'gpt-6-luna', 'max')).toBe(true)
		expect(isEffortSupported('fold', 'codex', 'gpt-5.6-sol', 'max')).toBe(true)
		expect(isEffortSupported('fold', 'codex', 'gpt-5.5', 'max')).toBe(false)
		expect(isEffortSupported('fold', 'codex', 'gpt-5.3-codex', 'medium')).toBe(false)
		expect(isEffortSupported('fold', 'xai', 'grok-4.6', 'medium')).toBe(true)
		expect(isEffortSupported('fold', 'xai', 'grok-4.6', 'max')).toBe(false)
	})
	test('isFastModeSupported allows false on any model', () => {
		expect(isFastModeSupported('claude', 'anthropic', 'claude-sonnet-4-6', false)).toBe(true)
	})
	test('isFastModeSupported rejects true on claude (disabled)', () => {
		expect(isFastModeSupported('claude', 'anthropic', 'claude-opus-4-8', true)).toBe(false)
		expect(isFastModeSupported('claude', 'anthropic', 'claude-opus-4-8-1m', true)).toBe(false)
		expect(isFastModeSupported('claude', 'anthropic', 'claude-opus-4-7', true)).toBe(false)
		expect(isFastModeSupported('claude', 'anthropic', 'claude-sonnet-4-6', true)).toBe(false)
	})
	test('isFastModeSupported rejects true for Fold', () => {
		expect(isFastModeSupported('fold', 'codex', 'gpt-6-sol', true)).toBe(false)
		expect(isFastModeSupported('codelayer', 'codex', 'gpt-6.1-sol', true)).toBe(false)
		expect(isFastModeSupported('fold', 'codex', 'gpt-6-luna', true)).toBe(false)
		expect(isFastModeSupported('fold', 'codex', 'gpt-5.6-sol', true)).toBe(false)
	})
})

describe('getDefaultEffort', () => {
	test("claude defaults to 'high' when supported", () => {
		expect(getDefaultEffort('claude', 'anthropic', 'claude-opus-5-5')).toBe('high')
		expect(getDefaultEffort('claude', 'anthropic', 'claude-opus-5')).toBe('high')
		expect(getDefaultEffort('claude', 'anthropic', 'claude-opus-4-8')).toBe('high')
		expect(getDefaultEffort('claude', 'anthropic', 'claude-opus-4-8[1m]')).toBe('high')
		expect(getDefaultEffort('claude', 'anthropic', 'claude-opus-4-7')).toBe('high')
		expect(getDefaultEffort('claude', 'anthropic', 'sonnet')).toBe('high')
		expect(getDefaultEffort('claude', 'anthropic', 'claude-sonnet-5')).toBe('high')
		expect(getDefaultEffort('claude', 'anthropic', 'claude-opus-4-5')).toBe('high')
	})
	test("codelayer anthropic defaults to 'high' for Sonnet 5", () => {
		expect(getDefaultEffort('codelayer', 'anthropic', 'claude-opus-5-5')).toBe('high')
		expect(getDefaultEffort('codelayer', 'anthropic', 'sonnet')).toBe('high')
		expect(getDefaultEffort('codelayer', 'anthropic', 'claude-sonnet-5')).toBe('high')
	})
	test("codex defaults to 'medium' when supported", () => {
		expect(getDefaultEffort('codelayer', 'codex', 'gpt-6-astra')).toBe('medium')
		expect(getDefaultEffort('codelayer', 'codex', 'gpt-6-sol')).toBe('medium')
		expect(getDefaultEffort('codelayer', 'codex', 'gpt-6.1-sol')).toBe('medium')
		expect(getDefaultEffort('codelayer', 'codex', 'gpt-6-luna')).toBe('medium')
		expect(getDefaultEffort('codelayer', 'codex', 'gpt-5.6-sol')).toBe('medium')
		expect(getDefaultEffort('codelayer', 'codex', 'gpt-5.5')).toBe('medium')
	})
	test('returns undefined when capability is not supported', () => {
		expect(getDefaultEffort('claude', 'anthropic', 'claude-haiku-4-5-20251001')).toBeUndefined()
		expect(getDefaultEffort(null, null, null)).toBeUndefined()
	})
})

describe('capabilities from a host catalog entry', () => {
	const codexEntry = {
		provider: 'codex' as const,
		value: 'gpt-7-nova',
		label: 'GPT-7-Nova',
		isDefault: false,
		hidden: false,
		effortLevels: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
		defaultEffort: 'medium',
		supportsFastMode: true,
		supportsAutoMode: false,
		contextWindow: 258_400,
	}

	test('a model the bundled table does not know is fully described by the probe', () => {
		expect(getEffortCapability('codelayer', 'codex', 'gpt-7-nova')).toEqual({ supported: false })
		expect(getEffortCapability('codelayer', 'codex', 'gpt-7-nova', codexEntry)).toEqual({
			supported: true,
			levels: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
		})
		expect(getDefaultEffort('codelayer', 'codex', 'gpt-7-nova', codexEntry)).toBe('medium')
		expect(getFastModeCapability('codelayer', 'codex', 'gpt-7-nova', codexEntry)).toEqual({ supported: true })
		expect(isEffortSupported('codelayer', 'codex', 'gpt-7-nova', 'ultra', codexEntry)).toBe(true)
		expect(isFastModeSupported('codelayer', 'codex', 'gpt-7-nova', true, codexEntry)).toBe(true)
	})

	test('an entry without effort levels turns the selector off even for a bundled model', () => {
		const noEffort = { ...codexEntry, value: 'gpt-5.5', effortLevels: [], defaultEffort: undefined }
		expect(getEffortCapability('codelayer', 'codex', 'gpt-5.5', noEffort)).toEqual({ supported: false })
		expect(getDefaultEffort('codelayer', 'codex', 'gpt-5.5', noEffort)).toBeUndefined()
	})

	test('GPT-6.1 Sol fast mode stays off even when the probe offers a priority tier', () => {
		const solEntry = { ...codexEntry, value: 'gpt-6.1-sol' }
		expect(getFastModeCapability('codelayer', 'codex', 'gpt-6.1-sol', solEntry)).toEqual({ supported: false })
		expect(isFastModeSupported('codelayer', 'codex', 'gpt-6.1-sol', true, solEntry)).toBe(false)
	})

	test('Claude fast mode stays off regardless of the probe', () => {
		const claudeEntry = { ...codexEntry, provider: 'anthropic' as const, value: 'opus', supportsFastMode: true }
		expect(getFastModeCapability('claude', 'anthropic', 'opus', claudeEntry)).toEqual({ supported: false })
	})
})
