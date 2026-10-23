import { describe, expect, test, vi } from 'vitest'

import {
	DEFAULT_SETTINGS_SECTION,
	SETTINGS_SECTION_PATHS,
	type SettingsSection,
} from '@/components/settings/settings-sections'

import {
	type NavigateFn,
	navigateBackFromSettings,
	navigateToSettings,
	navigateWithinSettings,
} from './settings-navigation'

const ALL_SECTIONS: SettingsSection[] = [
	'general',
	'agent',
	'tips',
	'experiments',
	'billing',
	'access-requests',
	'users',
	'daemons',
	'sync',
	'diagnostics',
	'updates',
]

/**
 * Tests for the typed settings navigation helpers. Every settings entry point
 * routes through these, so they pin down section-path normalization and the
 * browser back behavior.
 *
 * We pass mocked router functions because these helpers only dispatch the
 * requested navigation action.
 */
describe('navigateToSettings', () => {
	test('navigates to the requested section route', () => {
		for (const section of ALL_SECTIONS) {
			const navigate = vi.fn() as unknown as NavigateFn
			navigateToSettings(navigate, section)
			expect(navigate).toHaveBeenCalledTimes(1)
			expect(navigate).toHaveBeenLastCalledWith({ to: SETTINGS_SECTION_PATHS[section] })
		}
	})

	test('falls back to the default section when none is provided', () => {
		const navigate = vi.fn() as unknown as NavigateFn
		navigateToSettings(navigate)
		expect(navigate).toHaveBeenLastCalledWith({ to: SETTINGS_SECTION_PATHS[DEFAULT_SETTINGS_SECTION] })
	})

	test('default section resolves to /settings/general', () => {
		expect(SETTINGS_SECTION_PATHS[DEFAULT_SETTINGS_SECTION]).toBe('/settings/general')
	})

	test('every section path is /settings/<section>', () => {
		for (const section of ALL_SECTIONS) {
			expect(SETTINGS_SECTION_PATHS[section]).toBe(`/settings/${section}`)
		}
	})
})

describe('navigateBackFromSettings', () => {
	test('navigates back through browser history', () => {
		const back = vi.fn()
		const replace = vi.fn()
		navigateBackFromSettings({ back, canGoBack: () => true, replace })
		expect(back).toHaveBeenCalledTimes(1)
		expect(replace).not.toHaveBeenCalled()
	})

	test('replaces settings with the app home when there is no back entry', () => {
		const back = vi.fn()
		const replace = vi.fn()
		navigateBackFromSettings({ back, canGoBack: () => false, replace })
		expect(back).not.toHaveBeenCalled()
		expect(replace).toHaveBeenCalledWith('/')
	})
})

describe('navigateWithinSettings', () => {
	test('replaces the current settings history entry', () => {
		const navigate = vi.fn() as unknown as NavigateFn
		navigateWithinSettings(navigate, 'billing')
		expect(navigate).toHaveBeenCalledWith({ to: SETTINGS_SECTION_PATHS.billing, replace: true })
	})
})
