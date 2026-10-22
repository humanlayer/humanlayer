import { describe, expect, test } from 'vitest'

import { activityMinute, compareSessionsByActivityMinute } from './activitySorting'

describe('activityMinute', () => {
	test('returns the same key for timestamps in the same minute', () => {
		expect(activityMinute(120_001)).toBe(activityMinute(179_999))
	})

	test('returns different keys across a minute boundary', () => {
		expect(activityMinute(119_999)).toBe(1)
		expect(activityMinute(120_000)).toBe(2)
	})

	test('accepts bigint timestamps', () => {
		expect(activityMinute(179_999n)).toBe(2)
	})

	test('preserves ordering across hour and day boundaries', () => {
		expect(activityMinute(3_600_000)).toBe(activityMinute(3_599_999) + 1)
		expect(activityMinute(86_400_000)).toBe(activityMinute(86_399_999) + 1)
	})

	test('allows callers to select fallback activity before bucketing', () => {
		const effectiveMinute = (sessionActivity: bigint | null, taskUpdatedAt: bigint | null) =>
			activityMinute(sessionActivity ?? taskUpdatedAt ?? 0)

		expect(effectiveMinute(179_999n, 60_000n)).toBe(2)
		expect(effectiveMinute(null, 60_000n)).toBe(1)
		expect(effectiveMinute(null, null)).toBe(0)
	})

	test('retains source order when activity minute and creation time tie', () => {
		const tasks = [
			{ id: 'first', activity: 120_001n, createdAt: 1_000n },
			{ id: 'second', activity: 179_999n, createdAt: 1_000n },
		]

		const sorted = [...tasks].sort((a, b) => {
			const minuteDifference = activityMinute(b.activity) - activityMinute(a.activity)
			if (minuteDifference !== 0) return minuteDifference
			return Number(b.createdAt) - Number(a.createdAt)
		})

		expect(sorted.map((task) => task.id)).toEqual(['first', 'second'])
	})
})

describe('compareSessionsByActivityMinute', () => {
	test('sorts activity minutes descending', () => {
		const sessions = [
			{ id: 'older', last_activity_at: 119_999n, created_at: 2_000n },
			{ id: 'newer', last_activity_at: 120_000n, created_at: 1_000n },
		]

		expect(sessions.sort(compareSessionsByActivityMinute).map((session) => session.id)).toEqual(['newer', 'older'])
	})

	test('sorts creation time descending within an activity minute', () => {
		const sessions = [
			{ id: 'older', last_activity_at: 120_001n, created_at: 1_000n },
			{ id: 'newer', last_activity_at: 179_999n, created_at: 2_000n },
		]

		expect(sessions.sort(compareSessionsByActivityMinute).map((session) => session.id)).toEqual(['newer', 'older'])
	})

	test('returns zero for exact ordering ties', () => {
		const first = { last_activity_at: 120_001n, created_at: 1_000n }
		const second = { last_activity_at: 179_999n, created_at: 1_000n }

		expect(compareSessionsByActivityMinute(first, second)).toBe(0)
	})
})
