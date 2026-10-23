import { describe, expect, test } from 'vitest'

import {
	resolvePermissionsModeForSelectedModel,
	shouldDefaultToAutoMode,
	supportsAutoMode,
} from '@/lib/model-permissions'

describe('shouldDefaultToAutoMode', () => {
	test('defaults only Claude Opus 4.8 to auto mode', () => {
		expect(shouldDefaultToAutoMode('claude-opus-4-8')).toBe(true)
	})

	test('does not default Opus 5 or other Opus models to auto mode', () => {
		expect(shouldDefaultToAutoMode('opus')).toBe(false)
		expect(shouldDefaultToAutoMode('claude-opus-5-5')).toBe(false)
		expect(shouldDefaultToAutoMode('claude-opus-5')).toBe(false)
		expect(shouldDefaultToAutoMode('claude-opus-4-7')).toBe(false)
		expect(shouldDefaultToAutoMode('claude-opus-4-6')).toBe(false)
		expect(shouldDefaultToAutoMode('claude-opus-4-6-1m')).toBe(false)
		expect(shouldDefaultToAutoMode('claude-opus-4-5')).toBe(false)
		expect(shouldDefaultToAutoMode(null)).toBe(false)
	})
})

describe('supportsAutoMode', () => {
	test('allows Claude Opus 4.6 and later to preserve auto mode', () => {
		expect(supportsAutoMode('opus')).toBe(true)
		expect(supportsAutoMode('claude-opus-5-5')).toBe(true)
		expect(supportsAutoMode('claude-opus-5')).toBe(true)
		expect(supportsAutoMode('claude-opus-4-8')).toBe(true)
		expect(supportsAutoMode('claude-opus-4-7')).toBe(true)
		expect(supportsAutoMode('claude-opus-4-6')).toBe(true)
		expect(supportsAutoMode('claude-opus-4-6-1m')).toBe(true)
	})

	test('does not treat unsupported models as auto-mode capable', () => {
		expect(supportsAutoMode('claude-opus-4-5')).toBe(false)
		expect(supportsAutoMode('claude-sonnet-5')).toBe(false)
		expect(supportsAutoMode(null)).toBe(false)
	})
})

describe('resolvePermissionsModeForSelectedModel', () => {
	const defaultToAutoModels = ['claude-opus-4-8'] as const
	const supportedAutoModeModels = [
		'opus',
		'claude-opus-5-5',
		'claude-opus-5',
		'claude-opus-4-7',
		'claude-opus-4-6',
		'claude-opus-4-6-1m',
	] as const
	const unsupportedAutoModeModels = ['claude-opus-4-5', 'claude-sonnet-5-5', 'claude-sonnet-5'] as const

	test.each(defaultToAutoModels)('%s changes default to auto', (model) => {
		expect(resolvePermissionsModeForSelectedModel({ model, currentPermissionsMode: 'default' })).toEqual({
			nextPermissionsMode: 'auto',
			changed: true,
		})
	})

	test.each(defaultToAutoModels)('%s changes accept_edits to auto', (model) => {
		expect(resolvePermissionsModeForSelectedModel({ model, currentPermissionsMode: 'accept_edits' })).toEqual({
			nextPermissionsMode: 'auto',
			changed: true,
		})
	})

	test.each(defaultToAutoModels)('%s preserves auto and bypass', (model) => {
		expect(resolvePermissionsModeForSelectedModel({ model, currentPermissionsMode: 'auto' })).toEqual({
			nextPermissionsMode: 'auto',
			changed: false,
		})
		expect(resolvePermissionsModeForSelectedModel({ model, currentPermissionsMode: 'bypass' })).toEqual({
			nextPermissionsMode: 'bypass',
			changed: false,
		})
	})

	test.each(supportedAutoModeModels)('%s preserves manually selected auto without defaulting to it', (model) => {
		expect(resolvePermissionsModeForSelectedModel({ model, currentPermissionsMode: 'default' })).toEqual({
			nextPermissionsMode: 'default',
			changed: false,
		})
		expect(resolvePermissionsModeForSelectedModel({ model, currentPermissionsMode: 'accept_edits' })).toEqual({
			nextPermissionsMode: 'accept_edits',
			changed: false,
		})
		expect(resolvePermissionsModeForSelectedModel({ model, currentPermissionsMode: 'auto' })).toEqual({
			nextPermissionsMode: 'auto',
			changed: false,
		})
	})

	test.each(unsupportedAutoModeModels)('%s changes auto to default', (model) => {
		expect(resolvePermissionsModeForSelectedModel({ model, currentPermissionsMode: 'auto' })).toEqual({
			nextPermissionsMode: 'default',
			changed: true,
		})
	})

	test.each(unsupportedAutoModeModels)('%s preserves default, accept_edits, and bypass', (model) => {
		expect(resolvePermissionsModeForSelectedModel({ model, currentPermissionsMode: 'default' })).toEqual({
			nextPermissionsMode: 'default',
			changed: false,
		})
		expect(resolvePermissionsModeForSelectedModel({ model, currentPermissionsMode: 'accept_edits' })).toEqual({
			nextPermissionsMode: 'accept_edits',
			changed: false,
		})
		expect(resolvePermissionsModeForSelectedModel({ model, currentPermissionsMode: 'bypass' })).toEqual({
			nextPermissionsMode: 'bypass',
			changed: false,
		})
	})
})

describe('with a host catalog entry', () => {
	const entry = {
		provider: 'anthropic' as const,
		value: 'opus[1m]',
		label: 'Opus (1M context)',
		isDefault: true,
		hidden: false,
		effortLevels: ['low', 'medium', 'high'],
		supportsFastMode: true,
		supportsAutoMode: true,
	}

	test('auto mode support comes from the probe, not the model id', () => {
		expect(supportsAutoMode('opus[1m]', entry)).toBe(true)
		expect(supportsAutoMode('opus[1m]', { ...entry, supportsAutoMode: false })).toBe(false)
	})

	test('the host default model that supports auto mode promotes default to auto', () => {
		expect(shouldDefaultToAutoMode('opus[1m]', entry)).toBe(true)
		expect(shouldDefaultToAutoMode('opus[1m]', { ...entry, isDefault: false })).toBe(false)
		expect(
			resolvePermissionsModeForSelectedModel({
				model: 'opus[1m]',
				currentPermissionsMode: 'default',
				autoMode: { supported: true, defaultsToAuto: true },
			}),
		).toEqual({ nextPermissionsMode: 'auto', changed: true })
	})

	test('auto is repaired to default when the probe says the model cannot run it', () => {
		expect(
			resolvePermissionsModeForSelectedModel({
				model: 'haiku',
				currentPermissionsMode: 'auto',
				autoMode: { supported: false, defaultsToAuto: false },
			}),
		).toEqual({ nextPermissionsMode: 'default', changed: true })
	})
})
