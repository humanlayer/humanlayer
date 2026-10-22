import { describe, expect, test } from 'vitest'

import { BLOCK_FOCUS_SCROLL_MARGIN_PX, computeComfortScrollDelta } from './comfort-scroll'

const VIEW = 600
const M = BLOCK_FOCUS_SCROLL_MARGIN_PX

describe('computeComfortScrollDelta', () => {
	test('no scroll when the block sits comfortably inside the margins', () => {
		expect(computeComfortScrollDelta(200, 260, VIEW)).toBe(0)
	})

	test('scrolls up (negative) before the block reaches the top edge', () => {
		// Block top at 40px is inside the 96px comfort zone → scroll up by 56px so
		// the block clears the top margin, rather than only when it hits 0.
		expect(computeComfortScrollDelta(40, 100, VIEW)).toBe(40 - M)
	})

	test('scrolls down (positive) before the block reaches the bottom edge', () => {
		// Block bottom at 560px is within 96px of the 600px edge → scroll down.
		expect(computeComfortScrollDelta(500, 560, VIEW)).toBe(560 - (VIEW - M))
	})

	test('leaves a comfort zone of roughly 2-3 blocks worth of pixels', () => {
		// A block flush against the top (top=0) is pulled a full margin into view.
		expect(computeComfortScrollDelta(0, 60, VIEW)).toBe(-M)
		expect(Math.abs(computeComfortScrollDelta(0, 60, VIEW))).toBeGreaterThanOrEqual(64)
	})

	test('caps the margin so a tall block or short container cannot jitter', () => {
		// Block taller than the viewport minus both margins: margin collapses so
		// the block aligns to the top edge instead of demanding impossible room.
		expect(computeComfortScrollDelta(-100, 700, VIEW)).toBe(-100)
		// A very short container: the margin cannot exceed half the leftover
		// space, so a centered block still resolves to no scroll.
		expect(computeComfortScrollDelta(35, 65, 100)).toBe(0)
	})

	test('honors a custom margin', () => {
		expect(computeComfortScrollDelta(20, 80, VIEW, 40)).toBe(20 - 40)
	})
})
