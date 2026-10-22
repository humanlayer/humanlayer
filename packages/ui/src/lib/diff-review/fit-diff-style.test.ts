import { describe, expect, test } from 'vitest'

import { fitDiffStyle, fitsSplitDiff, MIN_SPLIT_DIFF_WIDTH_PX } from './fit-diff-style'

describe('fitsSplitDiff', () => {
	test('fits at and above the minimum width', () => {
		expect(fitsSplitDiff(MIN_SPLIT_DIFF_WIDTH_PX)).toBe(true)
		expect(fitsSplitDiff(1200)).toBe(true)
	})

	test('does not fit in a side panel', () => {
		expect(fitsSplitDiff(210)).toBe(false)
		expect(fitsSplitDiff(MIN_SPLIT_DIFF_WIDTH_PX - 1)).toBe(false)
	})

	test('keeps the saved choice for a pane with no width yet', () => {
		expect(fitsSplitDiff(0)).toBe(true)
	})
})

describe('fitDiffStyle', () => {
	test('falls back to unified when split has no room', () => {
		expect(fitDiffStyle('split', false)).toBe('unified')
	})

	test('keeps the saved choice otherwise', () => {
		expect(fitDiffStyle('split', true)).toBe('split')
		expect(fitDiffStyle('unified', true)).toBe('unified')
		expect(fitDiffStyle('unified', false)).toBe('unified')
	})
})
