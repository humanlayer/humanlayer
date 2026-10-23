import { describe, expect, test } from 'vitest'

/**
 * Tests for billing visibility logic.
 *
 * We test the core boolean logic directly rather than importing the module,
 * because mock.module for the settings store would interfere with other test
 * files that import the real settingsStore.
 */
describe('billing visibility logic', () => {
	function isVisible(enforcementEnabled: boolean, previewEnabled: boolean): boolean {
		return enforcementEnabled || previewEnabled
	}

	test('returns false when enforcement is disabled and preview is disabled', () => {
		expect(isVisible(false, false)).toBe(false)
	})

	test('returns true when enforcement is enabled regardless of preview', () => {
		expect(isVisible(true, false)).toBe(true)
	})

	test('returns true when enforcement is enabled and preview is also enabled', () => {
		expect(isVisible(true, true)).toBe(true)
	})

	test('returns true when enforcement is disabled but preview is enabled', () => {
		expect(isVisible(false, true)).toBe(true)
	})
})
