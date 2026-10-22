import { describe, expect, it } from 'vitest'

import {
	currentBucketSoFar,
	formatTrendSummary,
	gapSummary,
	latestCompleteBucket,
	lensBucketDenominator,
	toTrendRows,
	type TrendRow,
	type UnitCostBucket,
} from './unitCostTrend'

const bucket = (
	bucketStart: string,
	costUsd: number,
	locChanged: number,
	commitCount = 10,
	prsMerged = 5,
	inRange = true,
): UnitCostBucket => ({
	bucketStart,
	inRange,
	costUsd,
	locChanged,
	commitCount,
	prsMerged,
})

/** A lead-in bucket: read to fill a trailing window, never plotted. */
const leadIn = (bucketStart: string, costUsd: number, locChanged: number, commitCount = 10, prsMerged = 5) =>
	bucket(bucketStart, costUsd, locChanged, commitCount, prsMerged, false)

describe('lensBucketDenominator', () => {
	const b = bucket('2026-01-05', 200, 10_000, 40, 8)

	it('divides by kLOC (not LOC) on the kloc lens', () => {
		expect(lensBucketDenominator(b, 'kloc')).toBe(10)
	})

	it('divides by commit count on the commits lens', () => {
		expect(lensBucketDenominator(b, 'commits')).toBe(40)
	})

	it('divides by merged PRs on the prs lens', () => {
		expect(lensBucketDenominator(b, 'prs')).toBe(8)
	})
})

describe('toTrendRows (weekly)', () => {
	it('computes the kloc ratio as cost over kLOC', () => {
		const [row] = toTrendRows([bucket('2026-01-05', 200, 10_000)], 'kloc')
		expect(row?.value).toBe(20)
	})

	it('computes the same bucket differently under each lens — one query, three trends', () => {
		const input = [bucket('2026-01-05', 200, 10_000, 40, 8)]
		expect(toTrendRows(input, 'kloc')[0]?.value).toBe(20)
		expect(toTrendRows(input, 'commits')[0]?.value).toBe(5)
		expect(toTrendRows(input, 'prs')[0]?.value).toBe(25)
	})

	it('does not smooth weekly buckets — a week is already a whole window', () => {
		// Re-smoothing weekly points would blur the week-to-week movement the
		// page exists to show. Each row must be its own week's ratio.
		const rows = toTrendRows([bucket('2026-01-05', 100, 10_000), bucket('2026-01-12', 400, 10_000)], 'kloc', 'week')
		expect(rows.map((row) => row.value)).toEqual([10, 40])
	})

	it('gaps a bucket with output but no recorded spend instead of plotting $0', () => {
		// The trap this whole module exists for: usage collection started later
		// than the commit backfill, so plotting 0 would invent a "AI used to be
		// free" trend out of a data-collection artifact.
		const [row] = toTrendRows([bucket('2026-01-05', 0, 40_000)], 'kloc')
		expect(row?.value).toBeNull()
		expect(row?.spendMissing).toBe(true)
	})

	it('gaps a bucket with neither spend nor output', () => {
		const [row] = toTrendRows([bucket('2026-01-05', 0, 0, 0, 0)], 'kloc')
		expect(row?.value).toBeNull()
		// Not "missing spend" — there was no output to be missing spend for.
		expect(row?.spendMissing).toBe(false)
	})

	it('keeps a bucket with spend but no output as a gap, not an infinity', () => {
		const [row] = toTrendRows([bucket('2026-01-05', 500, 0, 0, 0)], 'kloc')
		expect(row?.value).toBeNull()
	})

	it('gaps a zero-denominator bucket independently per lens', () => {
		// Real spend and commits, but nothing merged: $/PR has no reading while
		// $/commit does — the gap is a property of the lens, not the bucket.
		const input = [bucket('2026-01-05', 200, 10_000, 40, 0)]
		expect(toTrendRows(input, 'prs')[0]?.value).toBeNull()
		expect(toTrendRows(input, 'commits')[0]?.value).toBe(5)
	})

	it('gaps kloc buckets below the low-volume floor', () => {
		// $81 over 21 lines gives $3,857/kLOC. Normal weeks are near $20.
		const [row] = toTrendRows([bucket('2026-01-05', 81, 21)], 'kloc')
		expect(row?.lowVolume).toBe(true)
		expect(row?.value).toBeNull()
	})

	it('plots a bucket exactly on the floor', () => {
		const [row] = toTrendRows([bucket('2026-01-05', 50, 1_000)], 'kloc')
		expect(row?.value).toBe(50)
	})

	it('keeps a small bucket on the commit lens, because the floor counts lines', () => {
		const [row] = toTrendRows([bucket('2026-01-05', 81, 21, 2, 1)], 'commits')
		expect(row?.value).toBe(40.5)
	})

	it('does not flag a bucket at or above the floor as low volume', () => {
		const [row] = toTrendRows([bucket('2026-01-05', 50, 1_000)], 'kloc')
		expect(row?.lowVolume).toBe(false)
	})

	it('never flags low volume on the commit/PR lenses — the floor is a lines threshold', () => {
		const input = [bucket('2026-01-05', 81, 21, 2, 1)]
		expect(toTrendRows(input, 'commits')[0]?.lowVolume).toBe(false)
		expect(toTrendRows(input, 'prs')[0]?.lowVolume).toBe(false)
	})
})

describe('toTrendRows (daily)', () => {
	/** Seven days of identical output, so a trailing window is easy to reason about. */
	const week = (from: number, cost: number, loc: number, inRange = true) =>
		Array.from({ length: 7 }, (_, index) =>
			bucket(`2026-01-${String(from + index).padStart(2, '0')}`, cost, loc, 10, 5, inRange),
		)

	it('plots a 7-day trailing ratio, not the day’s own', () => {
		// Six lead-in days at $100/2kLOC ($50/kLOC) then one day at $700/2kLOC
		// ($350/kLOC). Same-day would plot $350; trailing plots the week:
		// $1,300 ÷ 14 kLOC = $92.86.
		const rows = toTrendRows(
			[...week(1, 100, 2_000, false).slice(0, 6), bucket('2026-01-07', 700, 2_000, 10, 5, true)],
			'kloc',
			'day',
		)
		expect(rows).toHaveLength(1)
		expect(rows[0]?.value).toBeCloseTo(1_300 / 14, 5)
	})

	it('never plots the lead-in days', () => {
		const rows = toTrendRows([...week(1, 100, 2_000, false), ...week(8, 100, 2_000, true)], 'kloc', 'day')
		expect(rows).toHaveLength(7)
		expect(rows[0]?.bucketStart).toBe('2026-01-08')
	})

	it('agrees with the weekly view on the last day of a week', () => {
		// The property that makes offering both views safe: a trailing point at
		// the end of a week IS that week's weekly figure.
		const days = week(1, 100, 2_000, true)
		const daily = toTrendRows(days, 'kloc', 'day')
		const weekly = toTrendRows([bucket('2026-01-01', 700, 14_000)], 'kloc', 'week')
		expect(daily.at(-1)?.value).toBeCloseTo(weekly[0]?.value ?? Number.NaN, 10)
	})

	it('applies the low-volume floor to the trailing window, not the single day', () => {
		// 200 lines a day is under the 1,000-line floor, but a week of them is
		// 1,400 — comfortably over. Judging the day alone would gap the whole
		// daily chart for a team that simply commits in small pieces.
		const rows = toTrendRows(week(1, 50, 200, true), 'kloc', 'day')
		expect(rows.at(-1)?.lowVolume).toBe(false)
		expect(rows.at(-1)?.value).toBeCloseTo(350 / 1.4, 5)
	})

	it('gaps a trailing window with output but no spend anywhere in it', () => {
		const rows = toTrendRows(week(1, 0, 2_000, true), 'kloc', 'day')
		expect(rows.at(-1)?.value).toBeNull()
		expect(rows.at(-1)?.spendMissing).toBe(true)
	})
})

const rows = (...input: UnitCostBucket[]): TrendRow[] => toTrendRows(input, 'kloc')

describe('latestCompleteBucket', () => {
	const now = new Date('2026-01-21T00:00:00Z')

	it('ignores the in-progress final week and reports the last complete one', () => {
		const complete = latestCompleteBucket(
			rows(
				bucket('2026-01-05', 100, 10_000), // $10/kLOC
				bucket('2026-01-12', 200, 10_000), // $20/kLOC — latest complete
				bucket('2026-01-19', 5, 100), // in progress
			),
			'week',
			now,
		)
		expect(complete).toEqual({ bucketStart: '2026-01-12', value: 20 })
	})

	it('measures completeness against the BUCKET size, not always a week', () => {
		// 2026-01-19 is a Monday: the week containing it is still running on the
		// 21st, but the day itself finished two days ago.
		const series = rows(bucket('2026-01-19', 200, 10_000))
		expect(latestCompleteBucket(series, 'week', now)).toBeNull()
		expect(latestCompleteBucket(series, 'day', now)?.bucketStart).toBe('2026-01-19')
	})

	it('skips gap buckets and reports the last complete one WITH a reading', () => {
		const complete = latestCompleteBucket(
			rows(bucket('2026-01-05', 100, 10_000), bucket('2026-01-12', 0, 10_000)),
			'week',
			now,
		)
		expect(complete?.bucketStart).toBe('2026-01-05')
	})

	it('returns null when no complete bucket has a ratio', () => {
		expect(latestCompleteBucket(rows(bucket('2026-01-19', 100, 10_000)), 'week', now)).toBe(null)
	})

	it('returns null for an empty series', () => {
		expect(latestCompleteBucket([], 'week', now)).toBe(null)
	})
})

describe('formatTrendSummary', () => {
	it('names both buckets — the two figures describe different periods', () => {
		expect(formatTrendSummary({ bucketStart: '2026-01-12', value: 16.73 }, { value: 21.06 }, 'kloc', 'week')).toBe(
			'wk of Jan 12: $16.73/kLOC · this week so far: $21.06/kLOC',
		)
	})

	it('drops the "wk of" prefix at day resolution — a day stands for itself', () => {
		expect(formatTrendSummary({ bucketStart: '2026-01-12', value: 16.73 }, { value: 21.06 }, 'kloc', 'day')).toBe(
			'Jan 12: $16.73/kLOC · this day so far: $21.06/kLOC',
		)
	})

	it('renders each part alone when the other is absent', () => {
		expect(formatTrendSummary({ bucketStart: '2026-01-12', value: 26.27 }, null, 'commits', 'week')).toBe(
			'wk of Jan 12: $26.27/commit',
		)
		expect(formatTrendSummary(null, { value: 24.9 }, 'prs', 'week')).toBe('this week so far: $24.90/PR')
	})

	it('is empty when there is nothing to quote', () => {
		expect(formatTrendSummary(null, null, 'kloc', 'week')).toBe('')
	})
})

describe('currentBucketSoFar', () => {
	const now = new Date('2026-01-21T00:00:00Z')

	it('reports the in-progress final bucket so the rising tail is explained', () => {
		const soFar = currentBucketSoFar(
			rows(bucket('2026-01-12', 200, 10_000), bucket('2026-01-19', 300, 10_000)),
			'week',
			now,
		)
		expect(soFar).toEqual({ bucketStart: '2026-01-19', value: 30 })
	})

	it('is null when the final bucket is complete — nothing to disclaim', () => {
		expect(currentBucketSoFar(rows(bucket('2026-01-05', 200, 10_000)), 'week', now)).toBeNull()
	})

	it('is null when the in-progress bucket has no reading yet', () => {
		expect(currentBucketSoFar(rows(bucket('2026-01-19', 0, 0, 0, 0)), 'week', now)).toBeNull()
	})

	it('is null for an empty series', () => {
		expect(currentBucketSoFar([], 'week', now)).toBeNull()
	})
})

describe('gapSummary', () => {
	it('discloses zero-spend gaps so they are not read as missing weeks', () => {
		expect(gapSummary(rows(bucket('2026-01-05', 0, 40_000), bucket('2026-01-12', 200, 10_000)))).toContain(
			'1 week with output but no recorded spend',
		)
	})

	it('names days at day resolution, so the disclosure is not itself wrong', () => {
		expect(gapSummary(rows(bucket('2026-01-05', 0, 40_000)), 'day')).toContain('1 day with output')
	})

	it('discloses low-volume buckets as gaps, and still counts them when nulled', () => {
		expect(gapSummary(rows(bucket('2026-01-05', 81, 21)))).toContain('1 low-volume week')
		expect(gapSummary(rows(bucket('2026-01-05', 81, 21)))).toContain('shown as gaps')
	})

	it('is empty when every bucket is trustworthy', () => {
		expect(gapSummary(rows(bucket('2026-01-05', 200, 10_000)))).toBe('')
	})
})

// A lead-in bucket is only ever consumed, never reported — asserted here so the
// helper cannot quietly stop being used.
describe('lead-in fixtures', () => {
	it('marks lead-in buckets out of range', () => {
		expect(leadIn('2026-01-01', 1, 1).inRange).toBe(false)
	})
})
