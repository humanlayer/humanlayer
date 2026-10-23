import { describe, expect, it } from 'vitest'

import {
	ACTIVE_BUCKET_FLOOR,
	activeBucketsLabel,
	formatShare,
	type RankableSeries,
	rankSpendSeries,
	SPARKLINE_MIN_PEAK,
	sparklineGeometry,
} from './spendRanking'

const series = (key: string, label: string): RankableSeries => ({
	key,
	label,
	color: `var(--chart-${key.slice(-1)})`,
})

/** Three buckets, two series — the smallest shape that exercises ordering. */
const rows = [
	{ bucketStart: '2026-08-01', a: 10, b: 1 },
	{ bucketStart: '2026-08-02', a: 40, b: 0 },
	{ bucketStart: '2026-08-03', a: 50, b: 4 },
]

describe('rankSpendSeries', () => {
	it('orders rows by window total, largest first', () => {
		const ranking = rankSpendSeries(rows, [series('b', 'beta'), series('a', 'alpha')])
		expect(ranking.rows.map((row) => row.key)).toEqual(['a', 'b'])
	})

	it('breaks ties on label so the order is stable across refetches', () => {
		const tied = [
			{ bucketStart: '2026-08-01', a: 7, b: 7 },
			{ bucketStart: '2026-08-02', a: 3, b: 3 },
		]
		const ranking = rankSpendSeries(tied, [series('b', 'zulu'), series('a', 'alpha')])
		expect(ranking.rows.map((row) => row.label)).toEqual(['alpha', 'zulu'])
	})

	it('shares sum to one and are taken against the ranked grand total', () => {
		const ranking = rankSpendSeries(rows, [series('a', 'alpha'), series('b', 'beta')])
		expect(ranking.grandTotal).toBe(105)
		expect(ranking.rows[0]?.share).toBeCloseTo(100 / 105)
		expect(ranking.rows.reduce((sum, row) => sum + row.share, 0)).toBeCloseTo(1)
	})

	it('scales bars to the largest row, not to the total', () => {
		const ranking = rankSpendSeries(rows, [series('a', 'alpha'), series('b', 'beta')])
		expect(ranking.rows[0]?.barFraction).toBe(1)
		expect(ranking.rows[1]?.barFraction).toBeCloseTo(0.05)
	})

	it('pairs each row with its per-bucket values, index-aligned with buckets', () => {
		const ranking = rankSpendSeries(rows, [series('a', 'alpha'), series('b', 'beta')])
		expect(ranking.buckets).toEqual(['2026-08-01', '2026-08-02', '2026-08-03'])
		expect(ranking.rows[0]?.values).toEqual([10, 40, 50])
		expect(ranking.rows[1]?.values).toEqual([1, 0, 4])
	})

	it('derives the total from the values it plots, never from a caller total', () => {
		// densifyBucketRows drops cells outside [startDate, endDate], so a
		// pivot's series total can exceed what the dense rows contain. The row
		// must not print dollars its own sparkline cannot account for.
		const ranking = rankSpendSeries(rows, [series('a', 'alpha')])
		const row = ranking.rows[0]!
		expect(row.total).toBe(row.values.reduce((sum, value) => sum + value, 0))
		expect(row.total).toBe(100)
	})

	it('marks the peak bucket by index', () => {
		const ranking = rankSpendSeries(rows, [series('a', 'alpha')])
		expect(ranking.rows[0]?.peakIndex).toBe(2)
		expect(ranking.rows[0]?.peak).toBe(50)
		expect(ranking.buckets[ranking.rows[0]!.peakIndex]).toBe('2026-08-03')
	})

	it('counts only buckets above the dust floor as active', () => {
		const dusty = [
			{ bucketStart: '2026-08-01', a: ACTIVE_BUCKET_FLOOR },
			{ bucketStart: '2026-08-02', a: ACTIVE_BUCKET_FLOOR + 0.01 },
			{ bucketStart: '2026-08-03', a: 0 },
		]
		const ranking = rankSpendSeries(dusty, [series('a', 'alpha')])
		expect(ranking.rows[0]?.activeBuckets).toBe(1)
	})

	it('drops series with no spend rather than ranking an empty row', () => {
		const withEmpty = [
			{ bucketStart: '2026-08-01', a: 10, b: 0 },
			{ bucketStart: '2026-08-02', a: 20, b: 0 },
		]
		const ranking = rankSpendSeries(withEmpty, [series('a', 'alpha'), series('b', 'beta')])
		expect(ranking.rows.map((row) => row.key)).toEqual(['a'])
	})

	it('survives an empty window without dividing by zero', () => {
		const ranking = rankSpendSeries([], [])
		expect(ranking.rows).toEqual([])
		expect(ranking.grandTotal).toBe(0)
		expect(ranking.buckets).toEqual([])
	})

	it('reads a missing bucket value as zero rather than NaN', () => {
		const sparse = [{ bucketStart: '2026-08-01' }, { bucketStart: '2026-08-02', a: 3 }]
		const ranking = rankSpendSeries(sparse, [series('a', 'alpha')])
		expect(ranking.rows[0]?.values).toEqual([0, 3])
	})

	it('scrubs a non-finite bucket value to zero', () => {
		// typeof NaN === 'number', so a type guard alone lets it through, and a
		// single NaN then blanks the whole row's sparkline path.
		const poisoned = [
			{ bucketStart: '2026-08-01', a: 5 },
			{ bucketStart: '2026-08-02', a: Number.NaN },
			{ bucketStart: '2026-08-03', a: Number.POSITIVE_INFINITY },
		]
		const ranking = rankSpendSeries(poisoned, [series('a', 'alpha')])
		expect(ranking.rows[0]?.values).toEqual([5, 0, 0])
		expect(ranking.rows[0]?.total).toBe(5)
	})
})

describe('formatShare', () => {
	it('renders one decimal', () => {
		expect(formatShare(0.448)).toBe('44.8%')
		expect(formatShare(1)).toBe('100.0%')
	})

	it('renders real-but-tiny spend as <0.1% rather than a flat zero', () => {
		// 'plan' totalled $0.07 of $13,188.88 in August 2026 — a visible row
		// labelled "0.0%" reads as a bug.
		expect(formatShare(0.07 / 13188.88)).toBe('<0.1%')
	})

	it('renders a true zero as zero', () => {
		expect(formatShare(0)).toBe('0.0%')
	})
})

describe('sparklineGeometry', () => {
	it('spans the box horizontally and pins the peak to the top padding', () => {
		const geometry = sparklineGeometry([0, 50, 100], 2, 104, 16)
		expect(geometry?.line).toBe('M2 14 L52 8 L102 2')
		expect(geometry?.peakX).toBeCloseTo(102)
		expect(geometry?.peakY).toBeCloseTo(2)
	})

	it('closes the area along the baseline', () => {
		const geometry = sparklineGeometry([0, 100], 1, 104, 16)
		expect(geometry?.area).toBe('M2 14 L102 2 L102 14 L2 14 Z')
	})

	it('refuses to draw a curve out of rounding dust', () => {
		// A self-normalising sparkline would render seven cents as a mountain.
		expect(sparklineGeometry([0, 0.07, 0], 1, 104, 16)).toBeNull()
		expect(sparklineGeometry([0, SPARKLINE_MIN_PEAK, 0], 1, 104, 16)).not.toBeNull()
	})

	it('refuses to draw a line through fewer than two buckets', () => {
		expect(sparklineGeometry([500], 0, 104, 16)).toBeNull()
	})

	it('refuses to draw when the peak is not a finite number', () => {
		// `NaN < SPARKLINE_MIN_PEAK` is false, so a bare comparison would emit
		// d="M2 NaN L52 NaN" and blank the row.
		expect(sparklineGeometry([5, Number.NaN, 10], 2, 104, 16)).toBeNull()
		expect(sparklineGeometry([5, Number.POSITIVE_INFINITY], 1, 104, 16)).toBeNull()
	})

	it('clamps a negative bucket to the baseline instead of drawing outside the box', () => {
		const geometry = sparklineGeometry([-5, 10], 1, 104, 16)
		// Baseline is y=14 in a 16px box; an unclamped -5 mapped to y=20.
		expect(geometry?.line).toBe('M2 14 L102 2')
	})

	it('keeps an out-of-range peak index inside the box', () => {
		const geometry = sparklineGeometry([10, 20], 9, 104, 16)
		expect(geometry?.peakX).toBeCloseTo(102)
		expect(geometry?.peakY).toBeCloseTo(2)
	})
})

describe('activeBucketsLabel', () => {
	it('names the bucket the reader is looking at', () => {
		expect(activeBucketsLabel('day')).toBe('Active days')
		expect(activeBucketsLabel('week')).toBe('Active weeks')
	})
})
