import { describe, expect, test } from 'vitest'
import { recoveryRequired } from './billing-recovery'

describe('recoveryRequired', () => {
	test.each([
		['not_linked', 'none', false],
		['not_linked', 'canceled', false],
		['billing_linked', 'none', true],
		['billing_linked', 'active', true],
		['billing_enrolled', 'canceled', true],
		['billing_enrolled', 'active', false],
		['billing_enrolled', 'trialing', false],
	] as const)('returns %s for %s / %s', (rolloutDisplayState, status, expected) => {
		expect(recoveryRequired(rolloutDisplayState, status)).toBe(expected)
	})
})
