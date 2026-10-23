import {
	isAlignedRange,
	RANGE_HISTORY_DAYS,
	rangeLengthDays,
	validateMetricsRange,
} from '@humanlayer/riptide-api-contract/api/metrics/range'
import { describe, expect, it } from 'vitest'

import {
	activePreset,
	attributionPending,
	dayAtFraction,
	DEFAULT_PRESET,
	formatRangeLength,
	rangeBounds,
	rangeFromDrag,
	rangeFromSearch,
	resolveRange,
	searchFromRange,
	todayKey,
	withBucket,
} from './range'

// A Thursday, so the current week runs Mon 2026-08-17 – Sun 2026-08-23.
const TODAY = '2026-08-20'

const overview = (attributionStartDate: string | null = null) => ({
	earliestDate: '2026-02-23',
	latestDate: TODAY,
	attributionStartDate,
})

describe('todayKey', () => {
	it('uses the viewer’s local calendar, not UTC', () => {
		// 23:30 local on the 20th is the 21st in UTC for anyone east of Greenwich;
		// the key must follow the calendar the viewer is looking at.
		const local = new Date(2026, 7, 20, 23, 30)
		expect(todayKey(local)).toBe('2026-08-20')
	})
})

describe('rangeFromSearch', () => {
	it('falls back to the default preset when the URL says nothing', () => {
		// Daily, because 28 days is under DAILY_BUCKET_MAX_DAYS — and a daily
		// range ends today, never on the current week's future Sunday.
		expect(rangeFromSearch({}, TODAY)).toEqual({ from: '2026-07-27', to: TODAY, bucket: 'day' })
		expect(activePreset(rangeFromSearch({}, TODAY), TODAY)).toBe(DEFAULT_PRESET)
	})

	it('opens on the 4-week preset, daily, ending TODAY and with the button pressed', () => {
		// 28 days is under DAILY_BUCKET_MAX_DAYS, so opening daily is intended.
		// The regression was the END: the route built the preset weekly and then
		// relabelled it daily, so the range ran to the current week's FUTURE
		// Sunday — empty buckets at the right edge — and no preset lit, because
		// matchPreset compares against a daily preset that ends today.
		const range = rangeFromSearch({}, TODAY)
		expect(range.bucket).toBe('day')
		expect(range.to).toBe(TODAY)
		expect(activePreset(range, TODAY)).toBe(4)
	})

	it('never returns a daily range that ends after today', () => {
		for (const search of [{}, { weeks: 8 }, { bucket: 'day' as const }, { weeks: 12, bucket: 'day' as const }]) {
			const range = rangeFromSearch(search, TODAY)
			if (range.bucket === 'day') expect(range.to <= TODAY).toBe(true)
		}
	})

	it('lights the preset button for an explicitly daily preset link', () => {
		const range = rangeFromSearch({ weeks: 8, bucket: 'day' }, TODAY)
		expect(range.bucket).toBe('day')
		expect(range.to).toBe(TODAY)
		expect(activePreset(range, TODAY)).toBe(8)
	})

	it('falls back rather than passing through a range the API would refuse', () => {
		// A stale link naming six years. Passed through, every card renders an
		// error state because the contract rejects it as too long.
		const range = rangeFromSearch({ from: '2020-01-06', to: '2026-08-23' }, TODAY)
		expect(validateMetricsRange(range)).toBeNull()
		expect(activePreset(range, TODAY)).toBe(DEFAULT_PRESET)
	})

	it('honours an explicit aligned range', () => {
		const range = rangeFromSearch({ from: '2026-08-03', to: '2026-08-23', bucket: 'week' }, TODAY)
		expect(range).toEqual({ from: '2026-08-03', to: '2026-08-23', bucket: 'week' })
	})

	it('snaps a hand-typed unaligned range instead of rejecting it', () => {
		// Wednesday to Wednesday, weekly bucket: expanded outward to whole weeks,
		// which is exactly what dropping the brush handles there would do.
		const range = rangeFromSearch({ from: '2026-08-05', to: '2026-08-19', bucket: 'week' }, TODAY)
		expect(range).toEqual({ from: '2026-08-03', to: '2026-08-23', bucket: 'week' })
	})

	it('resolves a legacy ?weeks= link to the range that preset always meant', () => {
		// Links pasted into tickets before the brush shipped must still open on
		// the view they described.
		expect(rangeFromSearch({ weeks: 8 }, TODAY)).toEqual({
			from: '2026-06-29',
			to: '2026-08-23',
			bucket: 'week',
		})
	})

	it('ignores a nonsense weeks value rather than erroring', () => {
		expect(rangeFromSearch({ weeks: 99 }, TODAY)).toEqual(rangeFromSearch({}, TODAY))
	})

	it('ignores half a range', () => {
		expect(rangeFromSearch({ from: '2026-08-03' }, TODAY)).toEqual(rangeFromSearch({}, TODAY))
	})

	it('picks a bucket from the range width when the URL does not say', () => {
		expect(rangeFromSearch({ from: '2026-08-10', to: '2026-08-23' }, TODAY).bucket).toBe('day')
		expect(rangeFromSearch({ from: '2026-06-01', to: '2026-08-23' }, TODAY).bucket).toBe('week')
	})

	it('round-trips through searchFromRange', () => {
		const range = rangeFromSearch({ from: '2026-08-03', to: '2026-08-23', bucket: 'week' }, TODAY)
		expect(rangeFromSearch(searchFromRange(range), TODAY)).toEqual(range)
	})
})

describe('rangeBounds', () => {
	it('opens the whole strip when the org has no attribution boundary', () => {
		const bounds = rangeBounds(overview(), 'week', TODAY)
		expect(bounds.minDate).toBe('2026-02-23')
		expect(bounds.availablePresets).toEqual([4, 8, 12])
		expect(bounds.empty).toBe(false)
	})

	it('moves the floor to the Monday AFTER the opt-in week', () => {
		// Attribution started Wednesday 2026-07-01; that week is only partly
		// covered, so the first selectable Monday is the following one.
		const bounds = rangeBounds(overview('2026-07-01'), 'week', TODAY)
		expect(bounds.minDate).toBe('2026-07-06')
	})

	it('moves the floor to the day AFTER opt-in at day resolution', () => {
		expect(rangeBounds(overview('2026-07-01'), 'day', TODAY).minDate).toBe('2026-07-02')
	})

	it('disables only the presets that would reach past the floor', () => {
		// Floor 2026-07-06: the 4-week preset starts 2026-07-27 (fine), the
		// 8-week starts 2026-06-29 (before the floor).
		expect(rangeBounds(overview('2026-07-01'), 'week', TODAY).availablePresets).toEqual([4])
	})

	it('reports empty only when nothing at all is covered yet', () => {
		expect(rangeBounds(overview(TODAY), 'week', TODAY).empty).toBe(true)
		expect(rangeBounds(overview('2026-07-01'), 'week', TODAY).empty).toBe(false)
	})
})

describe('attributionPending', () => {
	it('separates "no floor" from "nothing attributed"', () => {
		// The pair that made the warm-up unreachable: rangeBounds must read a
		// null start date as an absent restriction and open the whole strip,
		// so the org that has never attributed anything looks identical to one
		// that opted in a year ago. Only this predicate tells them apart.
		expect(rangeBounds(overview(), 'week', TODAY).empty).toBe(false)
		expect(attributionPending(overview())).toBe(true)
	})

	it('is false once a first commit has been attributed', () => {
		expect(attributionPending(overview('2026-07-01'))).toBe(false)
		// Including the warm-up's own state — attribution started today, no
		// whole bucket yet. That one has a date, so it is a wait, not a void.
		expect(attributionPending(overview(TODAY))).toBe(false)
	})

	it('is false while the overview is unknown', () => {
		// Loading or failed. Claiming attribution is missing on the strength of
		// an answer we never got would replace working cards with a wait.
		expect(attributionPending(undefined)).toBe(false)
	})
})

describe('resolveRange', () => {
	it('clamps a range that starts before coverage rather than refusing it', () => {
		// The change the brush makes possible: a newly opted-in org sees its
		// covered weeks instead of "the 4-week view unlocks on…".
		const bounds = rangeBounds(overview('2026-07-01'), 'week', TODAY)
		const resolved = resolveRange({ from: '2026-06-01', to: '2026-08-23', bucket: 'week' }, bounds)
		expect(resolved).toEqual({ from: '2026-07-06', to: '2026-08-23', bucket: 'week' })
	})

	it('leaves a fully-covered range alone', () => {
		const bounds = rangeBounds(overview('2026-07-01'), 'week', TODAY)
		const range = { from: '2026-07-27', to: '2026-08-23', bucket: 'week' } as const
		expect(resolveRange(range, bounds)).toEqual(range)
	})

	it('returns null when the floor is past the range end', () => {
		const bounds = rangeBounds(overview('2026-08-19'), 'week', TODAY)
		expect(resolveRange({ from: '2026-08-03', to: '2026-08-09', bucket: 'week' }, bounds)).toBeNull()
	})
})

describe('dayAtFraction', () => {
	const EARLIEST = '2026-08-01'
	const LATEST = '2026-08-10' // ten days

	it('maps the left edge to the first day and the right edge to the last', () => {
		expect(dayAtFraction(0, EARLIEST, LATEST)).toBe('2026-08-01')
		expect(dayAtFraction(1, EARLIEST, LATEST)).toBe('2026-08-10')
	})

	it('gives the LAST day a full bar’s width, not a sliver at the edge', () => {
		// 0.95 is inside the tenth bar (0.9–1.0). Rounding rather than flooring
		// over `span` would have made the final day unreachable by pointer.
		expect(dayAtFraction(0.95, EARLIEST, LATEST)).toBe('2026-08-10')
		expect(dayAtFraction(0.89, EARLIEST, LATEST)).toBe('2026-08-09')
	})

	it('clamps a pointer dragged outside the track', () => {
		expect(dayAtFraction(-2, EARLIEST, LATEST)).toBe('2026-08-01')
		expect(dayAtFraction(3, EARLIEST, LATEST)).toBe('2026-08-10')
	})
})

describe('rangeFromDrag', () => {
	const bounds = rangeBounds(overview('2026-07-01'), 'week', TODAY)

	it('snaps a weekly drag out to whole weeks — the no-partial-bucket guarantee', () => {
		expect(rangeFromDrag('2026-08-05', '2026-08-19', 'week', bounds)).toEqual({
			from: '2026-08-03',
			to: '2026-08-23',
			bucket: 'week',
		})
	})

	it('keeps a daily drag day-exact', () => {
		expect(rangeFromDrag('2026-08-05', '2026-08-19', 'day', bounds)).toEqual({
			from: '2026-08-05',
			to: '2026-08-19',
			bucket: 'day',
		})
	})

	it('handles a handle dragged past the other end', () => {
		expect(rangeFromDrag('2026-08-19', '2026-08-05', 'day', bounds)).toEqual({
			from: '2026-08-05',
			to: '2026-08-19',
			bucket: 'day',
		})
	})

	it('stops the left handle at the coverage floor', () => {
		// Clamping happens BEFORE snapping, so the handle lands on the first
		// covered bucket rather than being pulled forward twice.
		expect(rangeFromDrag('2026-03-02', '2026-08-19', 'week', bounds).from).toBe('2026-07-06')
	})

	it('does not let outward snapping push `from` back past the bound it just clamped to', () => {
		// Snapping expands outward, so a handle clamped to the floor could snap to
		// the Monday BEFORE it — one bucket earlier than the user was allowed.
		const strict = rangeBounds(overview('2026-07-01'), 'week', TODAY)
		expect(rangeFromDrag('2026-01-01', '2026-08-19', 'week', strict).from).toBe(strict.minDate)
	})

	it('keeps a full-width weekly drag inside the API’s range-length cap', () => {
		// The bug this guards: snapping the strip's first day BACK to its Monday
		// made the widest drag up to 194 days, which the API refuses outright.
		// RANGE_HISTORY_DAYS is 26 whole weeks precisely so this lands on the cap.
		for (let shift = 0; shift < 7; shift++) {
			const day = `2026-08-${String(17 + shift).padStart(2, '0')}`
			const wide = rangeBounds({ ...overview(), latestDate: day }, 'week', day)
			const range = rangeFromDrag('2020-01-01', day, 'week', wide)
			expect(rangeLengthDays(range)).toBeLessThanOrEqual(RANGE_HISTORY_DAYS)
		}
	})

	it('never produces an unaligned weekly range, whatever it is handed', () => {
		for (let offset = 0; offset < 7; offset++) {
			const from = `2026-08-${String(3 + offset).padStart(2, '0')}`
			const range = rangeFromDrag(from, '2026-08-19', 'week', bounds)
			expect(new Date(`${range.from}T00:00:00Z`).getUTCDay()).toBe(1)
			expect(new Date(`${range.to}T00:00:00Z`).getUTCDay()).toBe(0)
		}
	})
})

describe('withBucket', () => {
	// Bounds for the TARGET bucket, as the route computes them — the two buckets
	// have different ends, so passing the outgoing bucket's bounds is a bug.
	const weekBounds = rangeBounds(overview(), 'week', TODAY)
	const dayBounds = rangeBounds(overview(), 'day', TODAY)

	it('re-snaps a daily range when switching to weekly, instead of sending a partial bucket', () => {
		// 17 days, Wednesday to Friday: legal daily, illegal weekly. Flipping the
		// toggle without snapping would send the API a partial week, which it
		// refuses — this is the bug the assertion exists for.
		const daily = { from: '2026-08-05', to: '2026-08-21', bucket: 'day' } as const
		expect(withBucket(daily, 'week', weekBounds)).toEqual({
			from: '2026-08-03',
			to: '2026-08-23',
			bucket: 'week',
		})
	})

	it('ends a daily range at today, not at the current week’s future Sunday', () => {
		// Weekly runs to Sunday 08-23 because the current week IS the last bucket.
		// Daily must stop at today: the three days after it would be whole, empty
		// buckets, and a run of zero bars at the right edge reads as a collapse.
		const weekly = { from: '2026-06-29', to: '2026-08-23', bucket: 'week' } as const
		expect(withBucket(weekly, 'day', dayBounds)).toEqual({ from: '2026-06-29', to: TODAY, bucket: 'day' })
	})

	it('round-trips back to the same weekly range', () => {
		const weekly = { from: '2026-06-29', to: '2026-08-23', bucket: 'week' } as const
		const daily = withBucket(weekly, 'day', dayBounds)
		expect(withBucket(daily, 'week', weekBounds)).toEqual(weekly)
	})

	it('keeps the preset lit through a bucket switch', () => {
		// A preset that went dark the moment anyone pressed Daily would make the
		// buttons feel broken; presets are bucket-aware for exactly this reason.
		const weekly = { ...rangeFromSearch({ weeks: 8 }, TODAY) }
		expect(activePreset(weekly, TODAY)).toBe(8)
		expect(activePreset(withBucket(weekly, 'day', dayBounds), TODAY)).toBe(8)
	})

	it('always yields a range the API would accept', () => {
		for (let offset = 0; offset < 7; offset++) {
			const from = `2026-08-${String(3 + offset).padStart(2, '0')}`
			const range = withBucket({ from, to: '2026-08-21', bucket: 'day' }, 'week', weekBounds)
			expect(isAlignedRange(range.from, range.to, 'week')).toBe(true)
		}
	})
})

describe('formatRangeLength', () => {
	it('names whole weeks in weeks and everything else in days', () => {
		expect(formatRangeLength({ from: '2026-08-03', to: '2026-08-23', bucket: 'week' })).toBe('3 weeks')
		expect(formatRangeLength({ from: '2026-08-03', to: '2026-08-19', bucket: 'day' })).toBe('17 days')
		expect(formatRangeLength({ from: '2026-08-03', to: '2026-08-03', bucket: 'day' })).toBe('1 day')
	})
})
