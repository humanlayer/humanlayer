/**
 * Pure derivations behind the ranked spend cards (stage and mode): ordering,
 * shares, bar widths, and sparkline geometry. Kept free of React/SVG markup
 * (like stageAttribution and commitsByRepo) so every display decision here is
 * unit-testable.
 *
 * Why a ranking and not the grouped bars this replaced: both cards ask a MIX
 * question ("where in the workflow does spend land", "which kind of workflow
 * is the spend running in"), and a closed vocabulary × one bar per bucket
 * answers it with hundreds of needles. On the dev org's August window that was
 * 11 stages × 26 days = 286 bars in a ~670px card — about 2px each — of which
 * 224 were under $50 and 82 were exactly zero, while one outlier owned the
 * axis and flattened the rest. Ranking the window totals answers the question
 * directly and keeps the per-bucket shape as a sparkline beside each row.
 */

import type { MetricsBucket } from './range'

/**
 * A series to rank: how to find it in a row, and how to name and color it.
 *
 * Deliberately NO total. The pivots carry one, but it is summed over the raw
 * cells while the dense rows drop any cell outside [startDate, endDate] (see
 * `densifyBucketRows`, which does that on purpose for clock skew). Trusting it
 * would let a row print a total the sparkline beside it cannot account for, so
 * the total is derived from the same values the sparkline draws.
 */
export interface RankableSeries {
	key: string
	label: string
	color: string
}

export interface RankedSpendRow {
	key: string
	label: string
	color: string
	/** Window total for this series, in dollars — always exactly `sum(values)`. */
	total: number
	/** Fraction of the window's grand total, 0..1. */
	share: number
	/** Bar width as a fraction of the LARGEST row, 0..1 — the ranking's scale. */
	barFraction: number
	/** One value per bucket, in bucket order — the sparkline's series. */
	values: number[]
	/** Index into `values` (and into `SpendRanking.buckets`) of the largest bucket. */
	peakIndex: number
	/** Spend in the peak bucket. */
	peak: number
	/** Buckets carrying more than `ACTIVE_BUCKET_FLOOR` — see below. */
	activeBuckets: number
}

export interface SpendRanking {
	/** Largest total first. */
	rows: RankedSpendRow[]
	/** Bucket starts, in order — index-aligned with every row's `values`. */
	buckets: string[]
	/** Sum of every row's total; the denominator behind `share`. */
	grandTotal: number
}

/**
 * A bucket counts as "active" above 50 cents. Attribution leaves cent-sized
 * dust in buckets where nothing really ran (a stray sub-agent turn, a session
 * that opened and closed), and counting those as working days would make a
 * stage look continuously busy on rounding error.
 */
export const ACTIVE_BUCKET_FLOOR = 0.5

/**
 * A sparkline normalises to its OWN max, so a series whose whole window is
 * pocket change would draw a dramatic peak out of $0.07 — 'plan' really did
 * total 7 cents over August 2026 and would have rendered as the same mountain
 * as a $5,900 series. Below this peak the row draws a flat baseline instead.
 */
export const SPARKLINE_MIN_PEAK = 1

/** Padding inside the sparkline box, so the stroke and peak dot are not clipped. */
const SPARKLINE_PADDING = 2

/**
 * Ranks the series by window total, deriving BOTH the total and the per-bucket
 * values from the same dense rows — so a row's dollars, its share, its bar and
 * its sparkline can never tell different stories.
 *
 * Ties break on label ascending: totals collide at zero-ish values, and an
 * insertion-ordered tie would reshuffle rows on every refetch for no reason.
 */
export function rankSpendSeries(
	rows: ReadonlyArray<Record<string, number | string>>,
	series: readonly RankableSeries[],
): SpendRanking {
	const buckets = rows.map((row) => String(row.bucketStart))

	const ranked = series
		.map((entry) => {
			// Non-finite guard, not just a type guard: a NaN reaching the SVG
			// poisons the whole row's path (`d="M2 NaN …"`), and NaN survives
			// `typeof value === 'number'`.
			const values = rows.map((row) => {
				const value = row[entry.key]
				return typeof value === 'number' && Number.isFinite(value) ? value : 0
			})

			let total = 0
			let peak = 0
			let peakIndex = 0
			let activeBuckets = 0
			values.forEach((value, index) => {
				total += value
				if (value > peak) {
					peak = value
					peakIndex = index
				}
				if (value > ACTIVE_BUCKET_FLOOR) activeBuckets += 1
			})

			return { ...entry, total, values, peak, peakIndex, activeBuckets }
		})
		.filter((entry) => entry.total > 0)
		.sort((a, b) => b.total - a.total || a.label.localeCompare(b.label))

	const grandTotal = ranked.reduce((sum, entry) => sum + entry.total, 0)
	const maxTotal = ranked[0]?.total ?? 0

	return {
		buckets,
		grandTotal,
		rows: ranked.map((entry) => ({
			...entry,
			share: grandTotal > 0 ? entry.total / grandTotal : 0,
			barFraction: maxTotal > 0 ? entry.total / maxTotal : 0,
		})),
	}
}

/**
 * A share as a percentage. Real spend that rounds to 0.0% renders as "<0.1%"
 * rather than "0.0%": the row exists BECAUSE it has spend, and printing a flat
 * zero next to a visible bar reads as a bug.
 */
export function formatShare(share: number): string {
	const percent = share * 100
	if (percent > 0 && percent < 0.05) return '<0.1%'
	return `${percent.toFixed(1)}%`
}

export interface SparklineGeometry {
	/** `d` for the stroked line. */
	line: string
	/** `d` for the filled area under it (the line, closed along the baseline). */
	area: string
	peakX: number
	peakY: number
}

/**
 * Sparkline path geometry for one row, or null when there is nothing honest to
 * draw — fewer than two buckets (a line needs two points) or a peak under
 * `SPARKLINE_MIN_PEAK`. Callers render a flat baseline in the null case.
 */
export function sparklineGeometry(
	values: readonly number[],
	peakIndex: number,
	width: number,
	height: number,
): SparklineGeometry | null {
	if (values.length < 2) return null

	const max = Math.max(...values)
	// `!Number.isFinite` first: `NaN < SPARKLINE_MIN_PEAK` is FALSE, so a NaN
	// would sail past a bare comparison and emit `d="M2 NaN L52 NaN"`, which
	// blanks the row's whole sparkline rather than one point.
	if (!Number.isFinite(max) || max < SPARKLINE_MIN_PEAK) return null

	const innerWidth = width - SPARKLINE_PADDING * 2
	const innerHeight = height - SPARKLINE_PADDING * 2
	const lastIndex = values.length - 1
	const xAt = (index: number) => SPARKLINE_PADDING + (index / lastIndex) * innerWidth
	// Clamped to the box: the SVG root clips overflow, so a negative value
	// (a refund or billing adjustment) would otherwise draw below the baseline
	// and read as the line flattening out rather than dipping.
	const yAt = (value: number) => {
		const fraction = Math.min(Math.max(value / max, 0), 1)
		return SPARKLINE_PADDING + innerHeight - fraction * innerHeight
	}

	const line = values
		.map((value, index) => `${index === 0 ? 'M' : 'L'}${round(xAt(index))} ${round(yAt(value))}`)
		.join(' ')
	const baseline = round(SPARKLINE_PADDING + innerHeight)

	// Clamped rather than trusted: rankSpendSeries always hands over an index
	// it derived from these same values, but a stray index must move the dot,
	// not put it outside the box.
	const peak = Math.min(Math.max(peakIndex, 0), lastIndex)

	return {
		line,
		area: `${line} L${round(xAt(lastIndex))} ${baseline} L${round(xAt(0))} ${baseline} Z`,
		peakX: xAt(peak),
		peakY: yAt(values[peak] ?? 0),
	}
}

function round(value: number): number {
	return Math.round(value * 10) / 10
}

/** "Active days" or "Active weeks" — a weekly point stands for seven days. */
export function activeBucketsLabel(bucket: MetricsBucket): string {
	return bucket === 'week' ? 'Active weeks' : 'Active days'
}
