import { describe, expect, test } from 'vitest'

import { isBillingVisibleFor } from './integration-capabilities'

/**
 * Tests for billing visibility logic.
 *
 * We test the pure decision rather than importing billing-visibility.ts, because mock.module for
 * the settings store would interfere with other test files that import the real settingsStore.
 */
describe('billing visibility logic', () => {
	function isVisible(enforcementEnabled: boolean, previewEnabled: boolean, billingConfigured?: boolean): boolean {
		return isBillingVisibleFor({ enforcementEnabled, previewEnabled, billingConfigured })
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

	test('returns false when the server reports billing is not set up, even with preview on', () => {
		expect(isVisible(false, true, false)).toBe(false)
		expect(isVisible(true, true, false)).toBe(false)
	})

	test('keeps the flag and preview decision when billing is set up or not yet known', () => {
		expect(isVisible(false, true, true)).toBe(true)
		expect(isVisible(false, true, undefined)).toBe(true)
		expect(isVisible(false, false, true)).toBe(false)
	})
})
