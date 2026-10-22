import { describe, expect, it } from 'vitest'
import z from 'zod/v4'

import {
	addDays,
	bucketStartOf,
	DAILY_BUCKET_MAX_DAYS,
	dayOfWeek,
	defaultBucketFor,
	enumerateBuckets,
	firstWholeBucketOn,
	historyStart,
	isAlignedRange,
	matchPreset,
	metricsRangeInput,
	mondayOf,
	parseDayKey,
	presetRange,
	rangeLengthDays,
	RANGE_HISTORY_DAYS,
	snapRange,
	sundayOf,
	validateMetricsRange,
} from '../src/api/metrics/range'

// 2026-06-22 is a Monday; every fixture below is anchored to it.
const MON = '2026-06-22'
const SUN = '2026-06-28'

describe('day-key math', () => {
	it('parses and rejects', () => {
		expect(parseDayKey(MON)).toBe(Date.UTC(2026, 5, 22))
		expect(parseDayKey('2026-6-22')).toBeNull()
		expect(parseDayKey('nonsense')).toBeNull()
	})

	it('rejects valid-looking impossible dates instead of rolling them forward', () => {
		// Date.UTC(2026, 1, 30) silently becomes March 2nd — the round-trip check
		// is what stops that reaching a SQL bound as a real day.
		expect(parseDayKey('2026-02-30')).toBeNull()
	})

	it('adds days across month and year boundaries', () => {
		expect(addDays('2026-06-30', 1)).toBe('2026-07-01')
		expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
	})

	it('orders the week from Monday', () => {
		expect(dayOfWeek(MON)).toBe(0)
		expect(dayOfWeek(SUN)).toBe(6)
		expect(mondayOf('2026-06-25')).toBe(MON)
		expect(sundayOf('2026-06-25')).toBe(SUN)
	})

	it('counts an inclusive range the way a person says it', () => {
		expect(rangeLengthDays({ from: MON, to: SUN })).toBe(7)
		expect(rangeLengthDays({ from: MON, to: MON })).toBe(1)
	})
})

describe('bucket enumeration', () => {
	it('walks weeks by their Mondays', () => {
		expect(enumerateBuckets(MON, '2026-07-12', 'week')).toEqual(['2026-06-22', '2026-06-29', '2026-07-06'])
	})

	it('walks days one at a time', () => {
		expect(enumerateBuckets(MON, '2026-06-24', 'day')).toEqual(['2026-06-22', '2026-06-23', '2026-06-24'])
	})

	it('starts from the containing bucket when `from` is mid-week', () => {
		expect(enumerateBuckets('2026-06-25', '2026-07-05', 'week')).toEqual(['2026-06-22', '2026-06-29'])
	})

	it('returns nothing for an inverted or unparseable range rather than throwing', () => {
		expect(enumerateBuckets('2026-07-06', MON, 'week')).toEqual([])
		expect(enumerateBuckets('bad', MON, 'day')).toEqual([])
	})

	it('covers a full-history daily range without gaps', () => {
		const from = historyStart('2026-08-20')
		expect(enumerateBuckets(from, '2026-08-20', 'day')).toHaveLength(RANGE_HISTORY_DAYS)
	})
})

describe('alignment', () => {
	it('accepts Monday-to-Sunday weeks and rejects anything else', () => {
		expect(isAlignedRange(MON, SUN, 'week')).toBe(true)
		expect(isAlignedRange(MON, '2026-07-05', 'week')).toBe(true)
		expect(isAlignedRange(MON, '2026-06-27', 'week')).toBe(false)
		expect(isAlignedRange('2026-06-23', SUN, 'week')).toBe(false)
	})

	it('accepts any ordered pair of days', () => {
		expect(isAlignedRange('2026-06-24', '2026-06-25', 'day')).toBe(true)
		expect(isAlignedRange('2026-06-25', '2026-06-24', 'day')).toBe(false)
	})
})

describe('snapping', () => {
	it('expands outward to bucket edges', () => {
		expect(snapRange('2026-06-24', '2026-07-01', 'week')).toEqual({ from: MON, to: '2026-07-05', bucket: 'week' })
	})

	it('leaves a day range alone', () => {
		expect(snapRange('2026-06-24', '2026-06-27', 'day')).toEqual({
			from: '2026-06-24',
			to: '2026-06-27',
			bucket: 'day',
		})
	})

	it('orders reversed handles', () => {
		expect(snapRange('2026-06-27', '2026-06-24', 'day')).toEqual({
			from: '2026-06-24',
			to: '2026-06-27',
			bucket: 'day',
		})
	})

	it('is idempotent, so a stored range survives every later round trip', () => {
		const once = snapRange('2026-06-24', '2026-07-01', 'week')
		expect(snapRange(once.from, once.to, 'week')).toEqual(once)
	})

	it('always produces an aligned range, whatever it is handed', () => {
		for (const offset of [0, 1, 2, 3, 4, 5, 6]) {
			const snapped = snapRange(addDays(MON, offset), addDays(MON, offset + 3), 'week')
			expect(isAlignedRange(snapped.from, snapped.to, 'week')).toBe(true)
		}
	})
})

describe('presets', () => {
	it('reproduces the old anchored window: N-1 whole weeks plus the current one', () => {
		// Thursday 2026-08-20 → current week starts Monday 2026-08-17.
		expect(presetRange(4, '2026-08-20')).toEqual({ from: '2026-07-27', to: '2026-08-23', bucket: 'week' })
		expect(presetRange(12, '2026-08-20')).toEqual({ from: '2026-06-01', to: '2026-08-23', bucket: 'week' })
	})

	it('produces aligned ranges from any weekday', () => {
		for (let day = 0; day < 7; day++) {
			const range = presetRange(8, addDays('2026-08-17', day))
			expect(isAlignedRange(range.from, range.to, 'week')).toBe(true)
			expect(rangeLengthDays(range)).toBe(56)
		}
	})

	it('round-trips through matchPreset so a dragged-to-exact range lights the button', () => {
		const range = presetRange(8, '2026-08-20')
		expect(matchPreset(range, '2026-08-20')).toBe(8)
	})

	it('reports a custom selection as custom', () => {
		expect(matchPreset({ from: '2026-07-27', to: '2026-08-16', bucket: 'week' }, '2026-08-20')).toBeNull()
	})

	it('ends a daily preset at today, not at the current week’s future Sunday', () => {
		// Every day after today would be a whole, EMPTY bucket, and a run of zero
		// bars at the right edge of a daily chart reads as a spending collapse.
		// A weekly range's single in-progress bucket is a disclosed reading; six
		// empty days are a fabricated trend.
		expect(presetRange(8, '2026-08-20', 'day')).toEqual({
			from: '2026-06-29',
			to: '2026-08-20',
			bucket: 'day',
		})
	})

	it('matches presets per bucket, so pressing Daily does not darken every button', () => {
		expect(matchPreset(presetRange(8, '2026-08-20', 'day'), '2026-08-20')).toBe(8)
		expect(matchPreset(presetRange(8, '2026-08-20', 'week'), '2026-08-20')).toBe(8)
	})

	it('keeps `from` identical across buckets — only the tail differs', () => {
		// The difference between the two is "the last eight weeks" and "the last
		// eight weeks so far", never a different starting point.
		expect(presetRange(12, '2026-08-20', 'day').from).toBe(presetRange(12, '2026-08-20', 'week').from)
	})
})

describe('firstWholeBucketOn', () => {
	it('moves FORWARD to a whole bucket, unlike bucketStartOf', () => {
		// Wednesday: the containing week started on Monday, but that Monday is
		// outside the strip. The first whole week inside it starts next Monday.
		expect(bucketStartOf('2026-08-19', 'week')).toBe('2026-08-17')
		expect(firstWholeBucketOn('2026-08-19', 'week')).toBe('2026-08-24')
	})

	it('leaves a day that is already a bucket start alone', () => {
		expect(firstWholeBucketOn('2026-08-17', 'week')).toBe('2026-08-17')
		expect(firstWholeBucketOn('2026-08-19', 'day')).toBe('2026-08-19')
	})

	it('caps the widest weekly drag at exactly RANGE_HISTORY_DAYS, on every weekday', () => {
		// The reason the constant is 26 WHOLE weeks: the widest range a full-width
		// weekly drag can produce must land on the cap the API enforces, not one
		// bucket past it. Snapping the strip's first day backwards blew this.
		for (let shift = 0; shift < 7; shift++) {
			const today = addDays('2026-08-17', shift)
			const stripStart = addDays(today, -(RANGE_HISTORY_DAYS - 1))
			const range = {
				from: firstWholeBucketOn(stripStart, 'week'),
				to: presetRange(1, today, 'week').to,
				bucket: 'week' as const,
			}
			expect(rangeLengthDays(range)).toBe(RANGE_HISTORY_DAYS)
			expect(validateMetricsRange(range)).toBeNull()
		}
	})
})

describe('default bucket', () => {
	it('opens narrow ranges daily and wide ranges weekly', () => {
		expect(defaultBucketFor('2026-07-27', '2026-08-23')).toBe('day')
		expect(defaultBucketFor('2026-06-01', '2026-08-23')).toBe('week')
	})

	it('switches exactly at the documented width', () => {
		const from = '2026-06-22'
		expect(defaultBucketFor(from, addDays(from, DAILY_BUCKET_MAX_DAYS - 1))).toBe('day')
		expect(defaultBucketFor(from, addDays(from, DAILY_BUCKET_MAX_DAYS))).toBe('week')
	})
})

describe('validation', () => {
	it('passes an aligned range', () => {
		expect(validateMetricsRange({ from: MON, to: SUN, bucket: 'week' })).toBeNull()
	})

	it('names each way a range can be wrong', () => {
		expect(validateMetricsRange({ from: 'x', to: SUN, bucket: 'week' })).toBe('unparseable')
		expect(validateMetricsRange({ from: '2026-07-06', to: MON, bucket: 'day' })).toBe('inverted')
		expect(validateMetricsRange({ from: MON, to: '2026-06-27', bucket: 'week' })).toBe('unaligned')
		expect(validateMetricsRange({ from: '2025-01-06', to: '2026-08-23', bucket: 'week' })).toBe('too-long')
	})
})

describe('metricsRangeInput', () => {
	const schema = metricsRangeInput()

	it('defaults bucket and offset', () => {
		expect(schema.parse({ from: MON, to: SUN })).toEqual({
			from: MON,
			to: SUN,
			bucket: 'week',
			timezoneOffset: 0,
		})
	})

	it('refuses a partial weekly bucket at the API boundary, not just in the UI', () => {
		const result = schema.safeParse({ from: MON, to: '2026-06-27', bucket: 'week' })
		expect(result.success).toBe(false)
		expect(result.error?.issues[0]?.message).toContain('Monday')
	})

	it('accepts the same range once the bucket is daily', () => {
		expect(schema.safeParse({ from: MON, to: '2026-06-27', bucket: 'day' }).success).toBe(true)
	})

	it('accepts clients east of UTC+12, which the old copied bound rejected', () => {
		expect(schema.safeParse({ from: MON, to: SUN, timezoneOffset: -780 }).success).toBe(true)
	})

	it('composes endpoint-specific extras', () => {
		const withFilters = metricsRangeInput({ models: z.array(z.string()).optional() })
		expect(withFilters.parse({ from: MON, to: SUN, models: ['a'] }).models).toEqual(['a'])
	})
})
