import { describe, expect, it } from 'vitest'

import { trailingCaption, trailingSeries, trailingSeriesByGroup, TRAILING_WINDOW_DAYS } from './trailingRatio'

const day = (index: number) => `2026-01-${String(index).padStart(2, '0')}`

/** `count` consecutive days from `from`, each with the same numerator/denominator. */
const flat = (from: number, count: number, numerator: number, denominator: number, inRange = true) =>
	Array.from({ length: count }, (_, index) => ({
		bucketStart: day(from + index),
		inRange,
		numerator,
		denominator,
	}))

describe('trailingSeries (weekly)', () => {
	it('is the identity on in-range weeks — a week is already a whole window', () => {
		const rows = [
			{ bucketStart: '2026-01-05', inRange: true, numerator: 100, denominator: 10 },
			{ bucketStart: '2026-01-12', inRange: true, numerator: 400, denominator: 10 },
		]
		expect(trailingSeries(rows, 'week')).toEqual([
			{ bucketStart: '2026-01-05', numerator: 100, denominator: 10 },
			{ bucketStart: '2026-01-12', numerator: 400, denominator: 10 },
		])
	})

	it('still drops anything marked out of range', () => {
		const rows = [
			{ bucketStart: '2025-12-29', inRange: false, numerator: 999, denominator: 999 },
			{ bucketStart: '2026-01-05', inRange: true, numerator: 100, denominator: 10 },
		]
		expect(trailingSeries(rows, 'week').map((point) => point.bucketStart)).toEqual(['2026-01-05'])
	})
})

describe('trailingSeries (daily)', () => {
	it('sums the seven days ending at each point', () => {
		const points = trailingSeries(flat(1, 10, 10, 2), 'day')
		// Day 7 onward sees a full window: 7 × 10 over 7 × 2.
		expect(points.at(-1)).toEqual({ bucketStart: day(10), numerator: 70, denominator: 14 })
	})

	it('consumes lead-in days and never reports them', () => {
		const rows = [...flat(1, TRAILING_WINDOW_DAYS - 1, 10, 2, false), ...flat(7, 3, 10, 2, true)]
		const points = trailingSeries(rows, 'day')
		expect(points.map((point) => point.bucketStart)).toEqual([day(7), day(8), day(9)])
		// The first plotted day is whole BECAUSE of the lead-in: 7 × 10.
		expect(points[0]?.numerator).toBe(70)
	})

	it('shortens the window at the very start of a series rather than inventing data', () => {
		// No lead-in supplied: the opening point can only average what exists.
		// This is the ramp the API's lead-in exists to prevent, asserted here so
		// the shape of the bug is on record.
		const points = trailingSeries(flat(1, 3, 10, 2), 'day')
		expect(points[0]).toEqual({ bucketStart: day(1), numerator: 10, denominator: 2 })
		expect(points[2]?.numerator).toBe(30)
	})

	it('carries a spike across the whole window instead of spiking one point', () => {
		// One expensive day among six cheap ones. A same-day ratio would read
		// $350/kLOC on that day alone; trailing spreads it over the week.
		const rows = [
			...flat(1, 6, 100, 2, true),
			{ bucketStart: day(7), inRange: true, numerator: 700, denominator: 2 },
		]
		const points = trailingSeries(rows, 'day')
		expect(points.at(-1)?.numerator / points.at(-1)!.denominator).toBeCloseTo(1_300 / 14, 5)
	})
})

describe('trailingSeriesByGroup', () => {
	const keys = Array.from({ length: 10 }, (_, index) => day(index + 1))

	it('densifies each group before rolling, so an idle day is a zero not a shorter window', () => {
		// 'opus' has cells on two days only. Without densification its window
		// would average two rows and read far too high.
		const cells = [
			{ bucketStart: day(1), inRange: true, model: 'opus', cost: 100, loc: 10 },
			{ bucketStart: day(7), inRange: true, model: 'opus', cost: 100, loc: 10 },
		]
		const result = trailingSeriesByGroup(
			cells,
			keys,
			day(1),
			['opus'],
			(cell) => cell.model,
			(cell) => cell.cost,
			(cell) => cell.loc,
			'day',
		)
		const points = result.get('opus') ?? []
		expect(points).toHaveLength(10)
		expect(points.find((point) => point.bucketStart === day(7))).toEqual({
			bucketStart: day(7),
			numerator: 200,
			denominator: 20,
		})
	})

	it('does not plot a lead-in bucket that no cell mentions', () => {
		// The sparse trap: this source has one row per (bucket, group) that EXISTS,
		// so a lead-in day where nothing happened has no row. Defaulting such a key
		// to in-range plotted a point six days before the range, on a window that
		// ran off the front of the array.
		const cells = [{ bucketStart: day(8), model: 'opus', cost: 100, loc: 10 }]
		const result = trailingSeriesByGroup(
			cells,
			keys,
			day(7),
			['opus'],
			(cell) => cell.model,
			(cell) => cell.cost,
			(cell) => cell.loc,
			'day',
		)
		const plotted = (result.get('opus') ?? []).map((point) => point.bucketStart)
		expect(plotted.every((key) => key >= day(7))).toBe(true)
		expect(plotted).not.toContain(day(1))
	})

	it('emits a group with no cells at all as an all-zero series, not a missing one', () => {
		const result = trailingSeriesByGroup(
			[],
			keys,
			day(1),
			['fable'],
			() => 'fable',
			() => 0,
			() => 0,
			'day',
		)
		expect(result.get('fable')).toHaveLength(10)
	})

	it('takes in-range from the spine position, not from the cells', () => {
		const cells = [
			{ bucketStart: day(1), model: 'opus', cost: 10, loc: 1 },
			{ bucketStart: day(2), model: 'opus', cost: 10, loc: 1 },
		]
		const result = trailingSeriesByGroup(
			cells,
			[day(1), day(2)],
			day(2),
			['opus'],
			(cell) => cell.model,
			(cell) => cell.cost,
			(cell) => cell.loc,
			'day',
		)
		expect((result.get('opus') ?? []).map((point) => point.bucketStart)).toEqual([day(2)])
	})
})

describe('trailingCaption', () => {
	it('says what a daily point actually is', () => {
		expect(trailingCaption('day')).toContain(`${TRAILING_WINDOW_DAYS}-day trailing`)
	})

	it('says nothing on the weekly view, where a point is its own week', () => {
		expect(trailingCaption('week')).toBeNull()
	})
})
