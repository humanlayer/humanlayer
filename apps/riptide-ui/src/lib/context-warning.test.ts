import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { CONTEXT_WARNING_HIDE_MS, isContextWarningShown } from '@/lib/context-warning'

const NOW = Date.UTC(2026, 8, 30, 12)

describe('isContextWarningShown', () => {
	test('shows when enabled and never hidden', () => {
		expect(isContextWarningShown({ contextWarningEnabled: true, contextWarningHiddenUntil: null }, NOW)).toBe(true)
	})

	test('stays hidden until the hide window ends', () => {
		const hiddenUntil = NOW + CONTEXT_WARNING_HIDE_MS
		const settings = { contextWarningEnabled: true, contextWarningHiddenUntil: hiddenUntil }
		expect(isContextWarningShown(settings, hiddenUntil - 1)).toBe(false)
		expect(isContextWarningShown(settings, hiddenUntil)).toBe(true)
	})

	test('never shows when the setting is off', () => {
		expect(isContextWarningShown({ contextWarningEnabled: false, contextWarningHiddenUntil: null }, NOW)).toBe(
			false,
		)
	})
})

describe('settings store context warning actions', () => {
	beforeEach(() => {
		vi.useFakeTimers()
		vi.setSystemTime(NOW)
		useSettingsStore.setState({ contextWarningEnabled: true, contextWarningHiddenUntil: null })
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	test('hideContextWarning hides it for 7 days', () => {
		useSettingsStore.getState().hideContextWarning()
		expect(useSettingsStore.getState().contextWarningHiddenUntil).toBe(NOW + 7 * 24 * 60 * 60 * 1000)
		expect(isContextWarningShown(useSettingsStore.getState(), NOW + 6 * 24 * 60 * 60 * 1000)).toBe(false)
		expect(isContextWarningShown(useSettingsStore.getState(), NOW + 7 * 24 * 60 * 60 * 1000)).toBe(true)
	})

	test('toggling the setting clears a running hide', () => {
		useSettingsStore.getState().hideContextWarning()
		useSettingsStore.getState().setContextWarningEnabled(true)
		expect(useSettingsStore.getState().contextWarningHiddenUntil).toBeNull()
	})
})
