import type { HostModelCatalog, HostModelCatalogEntry } from '@humanlayer/schemas/zod/model-catalog'
import { describe, expect, it } from 'vitest'

import { BUNDLED_MODEL_REGISTRY, createModelRegistry } from '@/lib/model-registry'

import {
	AGENT_PROVIDERS,
	type ComposerSettings,
	fitSettings,
	modelCatalog,
	type ModelOption,
	pickModel,
	splitModels,
	titleCase,
} from './models'

const entry = (overrides: Partial<HostModelCatalogEntry>): HostModelCatalogEntry => ({
	provider: 'anthropic',
	value: 'opus',
	label: 'Opus',
	isDefault: false,
	hidden: false,
	effortLevels: ['low', 'medium', 'high'],
	supportsFastMode: false,
	supportsAutoMode: false,
	...overrides,
})

const catalog = (codex: HostModelCatalog['codex']): HostModelCatalog => ({
	probedAt: 1,
	anthropic: {
		status: 'ok',
		models: [
			entry({ value: 'claude-opus-5-5', label: 'Opus 5.5', supportsAutoMode: true, supportsFastMode: true }),
			entry({ value: 'old', label: 'Old', hidden: true }),
		],
	},
	codex,
})

const sol = entry({
	provider: 'codex',
	value: 'gpt-5.6-sol',
	label: 'GPT-5.6 Sol',
	description: 'GPT-5.6 Sol · Best for complex tasks · $4/$20 per Mtok',
	effortLevels: ['low', 'medium', 'high', 'xhigh'],
	defaultEffort: 'medium',
	supportsFastMode: true,
})

describe('modelCatalog', () => {
	it('uses the shared model order, merging host models with bundled models for both agents', () => {
		const supported_models = catalog({ status: 'ok', models: [sol] })
		const registry = createModelRegistry(supported_models)
		const { models, codexSignedOut } = modelCatalog({ supported_models })
		expect(models.filter((model) => model.agent === 'claude').map((model) => model.value)).toEqual(
			registry.optionsFor({ agent: 'claude', provider: 'anthropic' }).map((model) => model.value),
		)
		expect(models.filter((model) => model.agent === 'codelayer').map((model) => model.value)).toEqual(
			registry.optionsFor({ agent: 'codelayer', provider: 'codex' }).map((model) => model.value),
		)
		expect(models.some((model) => model.value === 'old')).toBe(false)
		expect(codexSignedOut).toBe(false)
		// HumanLayer never runs Claude on the fast tier, even when the catalog says it could.
		expect(models.find((model) => model.value === 'claude-opus-5-5')).toMatchObject({
			fastMode: false,
			autoMode: true,
		})
		expect(models.find((model) => model.value === sol.value)).toMatchObject({
			label: sol.label,
			efforts: sol.effortLevels,
			defaultEffort: 'medium',
			fastMode: true,
			autoMode: false,
		})
	})

	it.each(['not_logged_in', 'unauthorized'])('keeps bundled Codex with sign-in help for %s', (reason) => {
		const result = modelCatalog({
			supported_models: catalog({ status: 'unavailable', reason, models: [] }),
		})
		expect(result.models.filter((model) => model.agent === 'codelayer').map((model) => model.value)).toEqual(
			BUNDLED_MODEL_REGISTRY.optionsFor({ agent: 'codelayer', provider: 'codex' }).map((model) => model.value),
		)
		expect(result.codexSignedOut).toBe(true)
	})

	it.each([
		'transport',
		'timeout',
		'status',
		'malformed_response',
		'custom_backend',
		'malformed_catalog',
		'unknown',
		'',
	])('does not claim the host is signed out for %s', (reason) => {
		const result = modelCatalog({ supported_models: catalog({ status: 'unavailable', reason, models: [] }) })
		expect(result.codexSignedOut).toBe(false)
		expect(result.models.filter((model) => model.agent === 'codelayer').map((model) => model.value)).toEqual(
			BUNDLED_MODEL_REGISTRY.optionsFor({ agent: 'codelayer', provider: 'codex' }).map((model) => model.value),
		)
	})

	it.each([null, undefined, {}, { supported_models: null }])(
		'keeps both bundled agents before a report: %j',
		(host) => {
			const result = modelCatalog(host)
			for (const agent of ['claude', 'codelayer'] as const) {
				expect(result.models.filter((model) => model.agent === agent).map((model) => model.value)).toEqual(
					BUNDLED_MODEL_REGISTRY.optionsFor({ agent, provider: AGENT_PROVIDERS[agent] }).map(
						(model) => model.value,
					),
				)
			}
			expect(result.codexSignedOut).toBe(false)
		},
	)

	it.each([{ models: [] }, { models: [{ ...sol, hidden: true }] }])(
		'keeps bundled Codex when no visible models are reported: %j',
		({ models }) => {
			const result = modelCatalog({ supported_models: catalog({ status: 'ok', models }) })
			expect(result.models.filter((model) => model.agent === 'codelayer').map((model) => model.value)).toEqual(
				BUNDLED_MODEL_REGISTRY.optionsFor({ agent: 'codelayer', provider: 'codex' }).map(
					(model) => model.value,
				),
			)
			expect(result.codexSignedOut).toBe(false)
		},
	)

	it('uses shared capabilities for bundled models and host overrides', () => {
		const supported_models = catalog({
			status: 'ok',
			models: [
				{ ...sol, effortLevels: ['low', 'xhigh'], defaultEffort: 'max' },
				{ ...sol, value: 'gpt-6.1-sol' },
			],
		})
		const registry = createModelRegistry(supported_models)
		const result = modelCatalog({ supported_models })
		for (const model of result.models) {
			const capabilities = registry.capabilitiesOf({
				agent: model.agent,
				provider: AGENT_PROVIDERS[model.agent],
				model: model.value,
			})
			expect(model.efforts).toEqual(capabilities.effort.supported ? capabilities.effort.levels : [])
			expect(model.defaultEffort).toBe(capabilities.defaultEffort ?? null)
			expect(model.fastMode).toBe(capabilities.fastMode.supported)
			expect(model.autoMode).toBe(model.agent === 'claude' && capabilities.autoMode.supported)
		}
		expect(result.models.find((model) => model.value === sol.value)?.defaultEffort).toBe('xhigh')
		expect(result.models.find((model) => model.value === 'gpt-6.1-sol')?.fastMode).toBe(false)
	})
})

describe('pickModel', () => {
	const opus: ModelOption = {
		agent: 'claude',
		value: 'opus',
		label: 'Opus',
		efforts: ['low', 'medium', 'high', 'max'],
		defaultEffort: 'high',
		fastMode: false,
		autoMode: true,
	}
	const haiku: ModelOption = {
		...opus,
		value: 'haiku',
		label: 'Haiku',
		efforts: [],
		defaultEffort: null,
		autoMode: false,
	}
	const codex: ModelOption = {
		...opus,
		agent: 'codelayer',
		value: 'gpt-5.6-sol',
		efforts: ['low', 'medium', 'high'],
		defaultEffort: 'medium',
		fastMode: true,
		autoMode: false,
	}
	const claude: ComposerSettings = {
		agent: 'claude',
		model: 'opus',
		effort: 'max',
		fastMode: false,
		permissionsMode: 'accept_edits',
	}

	it('moves to Codex with its own effort and full access', () => {
		expect(pickModel(claude, codex)).toEqual({
			agent: 'codelayer',
			model: 'gpt-5.6-sol',
			effort: 'medium',
			fastMode: false,
			permissionsMode: 'bypass',
		})
	})

	it('comes back from Codex to Auto rather than keeping full access', () => {
		const onCodex = { ...pickModel(claude, codex), fastMode: true }
		expect(pickModel(onCodex, opus)).toMatchObject({ agent: 'claude', permissionsMode: 'auto', fastMode: false })
		expect(pickModel(onCodex, haiku).permissionsMode).toBe('default')
	})

	it('fits saved settings to the host', () => {
		const signedIn = { models: [opus, haiku, codex], codexSignedOut: false }
		const signedOut = { models: [opus, haiku], codexSignedOut: true }
		const onCodex = pickModel(claude, codex)
		expect(fitSettings(onCodex, signedIn)).toEqual(onCodex)
		expect(fitSettings({ ...onCodex, model: 'retired' }, signedIn).model).toBe('gpt-5.6-sol')
		expect(fitSettings(onCodex, signedOut)).toEqual(onCodex)
		expect(fitSettings(onCodex, { models: [], codexSignedOut: false })).toEqual(onCodex)
		expect(fitSettings(claude, signedIn)).toEqual(claude)
	})

	it('keeps a bundled Codex selection as catalog reports arrive or fail', () => {
		const onCodex: ComposerSettings = {
			agent: 'codelayer',
			model: 'gpt-5.4',
			effort: 'medium',
			fastMode: true,
			permissionsMode: 'bypass',
		}
		const reports = [
			null,
			catalog({ status: 'unavailable', reason: 'transport', models: [] }),
			catalog({ status: 'ok', models: [] }),
			catalog({ status: 'ok', models: [sol] }),
			catalog({ status: 'unavailable', reason: 'not_logged_in', models: [] }),
		]
		let settings = onCodex
		for (const supported_models of reports) {
			settings = fitSettings(settings, modelCatalog({ supported_models }))
			expect(settings).toEqual(onCodex)
		}
	})

	it('keeps a chosen bypass within Claude but drops Auto for models without it', () => {
		expect(pickModel({ ...claude, permissionsMode: 'bypass' }, haiku).permissionsMode).toBe('bypass')
		expect(pickModel({ ...claude, permissionsMode: 'auto' }, haiku)).toMatchObject({
			permissionsMode: 'default',
			effort: null,
		})
	})
})

describe('titleCase', () => {
	it.each([
		['OPUS 4.8', 'Opus 4.8'],
		['OPUS 4.6 1M', 'Opus 4.6 1M'],
		['SONNET 5', 'Sonnet 5'],
		['Opus 5.5', 'Opus 5.5'],
		['GPT-5.4 Mini', 'GPT-5.4 Mini'],
	])('reads %s as %s', (label, expected) => {
		expect(titleCase(label)).toBe(expected)
	})
})

describe('splitModels', () => {
	const option = (value: string, label: string, agent: ModelOption['agent'] = 'claude'): ModelOption => ({
		agent,
		value,
		label,
		efforts: [],
		defaultEffort: null,
		fastMode: false,
		autoMode: false,
	})
	const claude = [
		option('claude-fable-5-1', 'Fable 5.1'),
		option('claude-fable-5-1[1m]', 'Fable 5.1 1M'),
		option('claude-opus-5-5', 'Opus 5.5'),
		option('claude-opus-4-8', 'Opus 4.8'),
		option('claude-sonnet-5-5', 'Sonnet 5.5'),
		option('claude-haiku-5-5', 'Haiku 5.5'),
		option('haiku', 'Haiku'),
	]

	it('keeps the latest Claude models and folds the rest', () => {
		const { featured, more } = splitModels(claude, 'claude-opus-5-5')
		expect(featured.map((model) => model.label)).toEqual(['Fable 5.1', 'Opus 5.5', 'Sonnet 5.5', 'Haiku 5.5'])
		expect(more.map((model) => model.label)).toEqual(['Fable 5.1 1M', 'Opus 4.8', 'Haiku'])
	})

	it('matches Codex models by id or by a host label like GPT-6.1-Sol', () => {
		const codex = [
			option('gpt-6.1-sol', 'GPT-6.1-Sol', 'codelayer'),
			option('gpt-6.1-luna', 'GPT-6.1 Luna', 'codelayer'),
			option('host-astra', 'GPT-6-Astra', 'codelayer'),
			option('gpt-6-sol', 'GPT-6-Sol', 'codelayer'),
			option('gpt-5.5', 'GPT-5.5', 'codelayer'),
		]
		const { featured, more } = splitModels(codex, null)
		expect(featured.map((model) => model.value)).toEqual(['gpt-6.1-sol', 'gpt-6.1-luna', 'host-astra'])
		expect(more.map((model) => model.value)).toEqual(['gpt-6-sol', 'gpt-5.5'])
	})

	it('keeps an older selected model in view', () => {
		const { featured, more } = splitModels(claude, 'claude-opus-4-8')
		expect(featured.map((model) => model.value)).toContain('claude-opus-4-8')
		expect(more.map((model) => model.value)).not.toContain('claude-opus-4-8')
	})

	it('shows everything when none of the latest models are offered', () => {
		const old = [option('claude-opus-4-8', 'Opus 4.8'), option('haiku', 'Haiku')]
		expect(splitModels(old, null)).toEqual({ featured: old, more: [] })
	})
})
