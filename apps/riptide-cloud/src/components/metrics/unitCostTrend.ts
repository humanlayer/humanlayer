/**
 * Pure derivations behind the "Cost per … over time" card: the per-lens
 * division, the trailing-window rule at day resolution, the zero-spend gap
 * rule, the low-volume guard, and the quiet summary line. Kept free of
 * React/recharts so every display decision is unit-testable — these are the
 * judgement calls that decide whether the chart tells the truth. Bucket-key
 * mechanics live in clientBuckets.ts; the trailing rule itself in
 * trailingRatio.ts.
 */

import type { RiptideApiOutputs } from '@humanlayer/riptide-api-contract/contract-router'

import { bucketNoun, isCompleteBucket } from './clientBuckets'
import { formatUsdRatio, LOW_VOLUME_KLOC_FLOOR, LOW_VOLUME_LOC_FLOOR } from './kpis'
import { LENS_DEFINITIONS, type MetricLens } from './lenses'
import type { MetricsBucket } from './range'
import { trailingSeries } from './trailingRatio'

/** One bucket from metrics.unitCostTrend — derived from the contract (see KpiUserRow). */
export type UnitCostBucket = RiptideApiOutputs['metrics']['unitCostTrend']['data'][number]

/** A bucket prepared for plotting under one lens. */
export interface TrendRow {
	bucketStart: string
	/**
	 * The plotted ratio, or null for a deliberate gap in the line. Null covers
	 * BOTH "nothing to divide by" and "no recorded spend" — see {@link toTrendRows}.
	 */
	value: number | null
	/** Real output but no recorded spend — plotted as a gap, not as $0.00. */
	spendMissing: boolean
	/** kLOC lens only: fewer than {@link LOW_VOLUME_LOC_FLOOR} changed lines. The chart plots a gap. */
	lowVolume: boolean
}

/** The lens's denominator for one bucket, in the units the ratio divides by. */
export function lensBucketDenominator(bucket: UnitCostBucket, lens: MetricLens): number {
	switch (lens) {
		case 'commits':
			return bucket.commitCount
		case 'kloc':
			// The ratio is per 1,000 lines, so the divisor is kLOC, not LOC.
			return bucket.locChanged / 1000
		case 'prs':
			return bucket.prsMerged
	}
}

/**
 * Prepares API buckets for the line chart under one lens, applying the rules
 * that decide whether this chart is honest. Σcost ÷ Σdenominator per bucket —
 * the same ratio-of-sums the KPI cards use.
 *
 * **At day resolution the sums are TRAILING, never same-day.**
 *
 * A same-day unit cost divides one day's money by one day's merges, which is
 * not a readable number — see trailingRatio for the full argument. The lead-in
 * buckets the API sends (`inRange: false`) feed those windows and are then
 * dropped, so the line starts whole at the first day of the range instead of
 * ramping up from a one-day average.
 *
 * **A bucket with output but zero recorded spend is a GAP, not $0.00.**
 *
 * Usage collection started later than the commit backfill, so the early
 * buckets of any long range genuinely have output and no spend rows. Dividing
 * 0 by real output yields a perfectly valid-looking 0, which on a line chart
 * reads as "AI output used to be free and has been getting more expensive ever
 * since" — a dramatic, entirely fabricated trend. There is no true ratio for
 * those buckets, so the line breaks instead (recharts leaves nulls
 * unconnected).
 *
 * Buckets with no denominator are gaps too — there is nothing to divide by.
 *
 * **A bucket below LOW_VOLUME_LOC_FLOOR is also a gap.**
 *
 * Spend is recorded when it happens, but changed lines only appear once the
 * commit lands, so the current bucket usually holds hours of spend against very
 * few lines. On dev that gave $624.90 over 477 lines, or $1,310/kLOC, while the
 * other weeks sat between $11 and $225. That one value set the axis and made
 * the rest of the line unreadable, so those buckets are now gaps.
 *
 * The floor applies to the TRAILING sum at day resolution, not the raw day:
 * measuring a 7-day window against a floor calibrated for a week is the whole
 * reason the two views agree about which points are trustworthy.
 *
 * The low-volume flag applies to the kLOC lens only. LOW_VOLUME_LOC_FLOOR
 * counts lines, and there is no equivalent floor for commits or PRs.
 */
export function toTrendRows(
	buckets: readonly UnitCostBucket[],
	lens: MetricLens,
	bucket: MetricsBucket = 'week',
): TrendRow[] {
	const ratio = trailingSeries(
		buckets.map((row) => ({
			bucketStart: row.bucketStart,
			inRange: row.inRange,
			numerator: row.costUsd,
			denominator: lensBucketDenominator(row, lens),
		})),
		bucket,
	)
	return ratio.map((point) => {
		const spendMissing = point.denominator > 0 && point.numerator <= 0
		// The floor only applies to the kLOC lens, and on THAT lens the trailing
		// denominator already IS the window's kLOC (see lensBucketDenominator), so
		// the raw line count needs no second pass over the same windows.
		const lowVolume = lens === 'kloc' && point.denominator > 0 && point.denominator < LOW_VOLUME_KLOC_FLOOR
		return {
			bucketStart: point.bucketStart,
			value: spendMissing || point.denominator <= 0 || lowVolume ? null : point.numerator / point.denominator,
			spendMissing,
			lowVolume,
		}
	})
}

/**
 * The latest fully-elapsed bucket that has a real ratio. The in-progress final
 * bucket is skipped: its ratio is a partial numerator over a partial
 * denominator and routinely swings wildly. Returns null when no complete
 * bucket has a plottable ratio.
 */
export function latestCompleteBucket(
	rows: readonly TrendRow[],
	bucket: MetricsBucket,
	now: Date,
	offsetMinutes = 0,
): { bucketStart: string; value: number } | null {
	for (let i = rows.length - 1; i >= 0; i--) {
		const row = rows[i]
		if (row && row.value !== null && isCompleteBucket(row.bucketStart, bucket, now, offsetMinutes)) {
			return { bucketStart: row.bucketStart, value: row.value }
		}
	}
	return null
}

/**
 * The in-progress bucket's ratio-so-far, or null when the final row is complete
 * or has no reading. The partial bucket is real data the line already plots, so
 * acknowledging it ("this week so far: $21.06/kLOC") beats letting a rising
 * tail silently contradict the complete buckets before it.
 */
export function currentBucketSoFar(
	rows: readonly TrendRow[],
	bucket: MetricsBucket,
	now: Date,
	offsetMinutes = 0,
): { bucketStart: string; value: number } | null {
	const last = rows[rows.length - 1]
	if (!last || last.value === null || isCompleteBucket(last.bucketStart, bucket, now, offsetMinutes)) return null
	return { bucketStart: last.bucketStart, value: last.value }
}

/**
 * "wk of Jul 27: $16.73/kLOC · this week so far: $21.06/kLOC" — one quiet
 * line under the card title. Buckets are NAMED because the two figures describe
 * different buckets: the latest complete one, and the partial one the line's
 * final point plots. No period-over-period delta, deliberately — with the dots
 * visible on a linear line, the reader can see the move; a colored ▲/▼
 * percentage was shouting a comparison the chart already shows.
 */
export function formatTrendSummary(
	complete: { bucketStart: string; value: number } | null,
	soFar: { value: number } | null,
	lens: MetricLens,
	bucket: MetricsBucket,
): string {
	const unit = LENS_DEFINITIONS[lens].headlineUnit
	const noun = bucket === 'week' ? 'week' : 'day'
	const parts: string[] = []
	if (complete) {
		parts.push(`${bucketNoun(complete.bucketStart, bucket)}: ${formatUsdRatio(complete.value)}${unit}`)
	}
	if (soFar) parts.push(`this ${noun} so far: ${formatUsdRatio(soFar.value)}${unit}`)
	return parts.join(' · ')
}

/** Buckets the chart is deliberately not drawing a point for, and why. */
export function gapSummary(rows: readonly TrendRow[], bucket: MetricsBucket = 'week'): string {
	const noun = bucket === 'week' ? 'week' : 'day'
	const missingSpend = rows.filter((row) => row.spendMissing).length
	// Do not also test `value !== null`, since a low-volume bucket is now always
	// null and that test would count zero of them and drop the note.
	const lowVolume = rows.filter((row) => row.lowVolume).length
	const parts: string[] = []
	if (missingSpend > 0) {
		parts.push(
			`${missingSpend} ${noun}${missingSpend === 1 ? '' : 's'} with output but no recorded spend shown as gaps`,
		)
	}
	if (lowVolume > 0) {
		parts.push(
			`${lowVolume} low-volume ${noun}${lowVolume === 1 ? '' : 's'} (under ${LOW_VOLUME_LOC_FLOOR.toLocaleString()} changed lines) shown as gaps`,
		)
	}
	return parts.join(' · ')
}
