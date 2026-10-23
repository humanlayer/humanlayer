import { describe, expect, it } from 'vitest'

import { adoptionLocked, efficiencyLocked } from './locks'

describe('efficiencyLocked', () => {
	it('locks when neither pipeline collects', () => {
		expect(efficiencyLocked({ commitTrackingEnabled: false, prTrackingEnabled: false })).toBe(true)
	})

	it('stays open on commits alone', () => {
		expect(efficiencyLocked({ commitTrackingEnabled: true, prTrackingEnabled: false })).toBe(false)
	})

	it('stays open on pull requests alone — $/PR needs no commit', () => {
		expect(efficiencyLocked({ commitTrackingEnabled: false, prTrackingEnabled: true })).toBe(false)
	})
})

describe('adoptionLocked', () => {
	it('locks without commit tracking, whatever PR tracking says', () => {
		expect(adoptionLocked({ commitTrackingEnabled: false, prTrackingEnabled: true })).toBe(true)
	})

	it('opens with commit tracking', () => {
		expect(adoptionLocked({ commitTrackingEnabled: true, prTrackingEnabled: false })).toBe(false)
	})
})
