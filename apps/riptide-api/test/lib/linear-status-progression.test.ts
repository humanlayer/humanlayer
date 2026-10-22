import { describe, expect, test } from 'vitest'

import { isMoreProgressed } from '../../src/lib/linear-status-progression'

describe('isMoreProgressed', () => {
	test('allows forward moves within the started category (in-dev → code-review)', () => {
		const inDev = { type: 'started', position: 10 }
		const codeReview = { type: 'started', position: 12 }
		expect(isMoreProgressed(codeReview, inDev)).toBe(true)
	})

	test('blocks backward moves within the started category (code-review → in-dev)', () => {
		const inDev = { type: 'started', position: 10 }
		const codeReview = { type: 'started', position: 12 }
		// The reported regression: looping back to /iterate-implementation must not
		// drag a Code Review ticket back to In Dev.
		expect(isMoreProgressed(inDev, codeReview)).toBe(false)
	})

	test('treats the same state as not more progressed', () => {
		const inDev = { type: 'started', position: 10 }
		expect(isMoreProgressed(inDev, inDev)).toBe(false)
	})

	test('ranks categories ahead of position (started → completed allowed)', () => {
		const started = { type: 'started', position: 99 }
		const completed = { type: 'completed', position: 1 }
		expect(isMoreProgressed(completed, started)).toBe(true)
		expect(isMoreProgressed(started, completed)).toBe(false)
	})

	test('never auto-advances a canceled ticket back into an active state', () => {
		const canceled = { type: 'canceled', position: 0 }
		const started = { type: 'started', position: 50 }
		expect(isMoreProgressed(started, canceled)).toBe(false)
	})

	test('falls back to the started rank for unknown types', () => {
		const unknown = { type: 'mystery', position: 5 }
		const backlog = { type: 'backlog', position: 100 }
		// Unknown is treated as started (rank 3), which outranks backlog (rank 1).
		expect(isMoreProgressed(unknown, backlog)).toBe(true)
	})
})
