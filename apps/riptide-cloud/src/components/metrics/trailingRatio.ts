/**
 * THE rule for daily unit costs: at day resolution every ratio on this page is
 * a 7-DAY TRAILING ratio, never a same-day one.
 *
 * ## Why
 *
 * A same-day unit cost is not a number anyone can read, for two independent
 * reasons.
 *
 * **Small denominators.** A Tuesday with $380 of spend and two commits reads
 * $190/commit. The identical work merged as one 900-line commit on Wednesday
 * reads $12/commit. Nothing changed but the merge timing, and the chart would
 * present that as a 16× efficiency swing.
 *
 * **Different clocks.** Spend accrues on `occurred_at`, every day the agent
 * runs. Output lands on `committed_at` and `merged_at` — days later, and in a
 * lump. A weekly bucket absorbs that lag. A daily bucket divides Monday's
 * money by Thursday's output.
 *
 * A trailing window fixes both without inventing anything: it is still
 * Σcost ÷ Σdenominator, the page's one arithmetic rule, just summed over the
 * seven days ending at each point instead of over one. On the last day of a
 * week the trailing value EQUALS that week's weekly figure, so the daily and
 * weekly views of the same data agree where they can be compared — which is
 * the property that makes it safe to offer both.
 *
 * ## The lead-in
 *
 * The first plotted day's window reaches six days before the range. The API
 * sends those days flagged `inRange: false` (see the unitCostTrend contract);
 * this module consumes them and drops them, so nothing outside the selection
 * is ever plotted. Without the lead-in the opening points would average one,
 * then two, then three days — a ramp from an artificially extreme value that
 * reads as a cost collapse in the first week of every range.
 */

import type { MetricsBucket } from './range'

/** Days in the trailing window. A week, so a daily point and a weekly bucket are commensurable. */
export const TRAILING_WINDOW_DAYS = 7

/** The minimum a bucketed series must supply for the trailing sum to work. */
export interface TrailingInput {
	bucketStart: string
	inRange: boolean
	numerator: number
	denominator: number
}

export interface TrailingPoint {
	bucketStart: string
	/** Σnumerator over the window, for callers that need to explain the value. */
	numerator: number
	/** Σdenominator over the window. */
	denominator: number
}

/**
 * Rolls a bucketed series into the values a chart should plot.
 *
 * At `bucket: 'week'` this is the identity on the in-range buckets: a weekly
 * ratio already divides a whole week of numerator by the same whole week of
 * denominator, and re-smoothing it would blur real week-to-week movement the
 * page exists to show.
 *
 * At `bucket: 'day'` each in-range day carries the sums of the seven days
 * ending on it, lead-in days included in the sums and excluded from the
 * output.
 *
 * Rows must arrive ascending and dense — which is what the API guarantees.
 * A sparse series would silently shorten windows near its gaps.
 */
export function trailingSeries(rows: readonly TrailingInput[], bucket: MetricsBucket): TrailingPoint[] {
	if (bucket === 'week') {
		return rows
			.filter((row) => row.inRange)
			.map((row) => ({ bucketStart: row.bucketStart, numerator: row.numerator, denominator: row.denominator }))
	}

	const points: TrailingPoint[] = []
	for (let i = 0; i < rows.length; i++) {
		const row = rows[i]
		if (!row || !row.inRange) continue
		let numerator = 0
		let denominator = 0
		for (let back = 0; back < TRAILING_WINDOW_DAYS; back++) {
			const source = rows[i - back]
			if (!source) break
			numerator += source.numerator
			denominator += source.denominator
		}
		points.push({ bucketStart: row.bucketStart, numerator, denominator })
	}
	return points
}

/**
 * The same roll-up for a SPARSE, multi-series source (the per-model cells).
 *
 * The per-model endpoint returns only the (bucket, model) pairs that exist, so
 * a model idle on a Tuesday has no row at all. Densifying against the caller's
 * bucket spine first is what keeps each model's trailing window seven days
 * wide rather than "however many rows this model happened to have".
 *
 * @param bucketKeys every bucket key in ascending order, lead-in first — the
 *   same spine the response was built on.
 */
export function trailingSeriesByGroup<T extends { bucketStart: string }>(
	cells: readonly T[],
	bucketKeys: readonly string[],
	/**
	 * First bucket of the SELECTED range. Everything before it on the spine is
	 * lead-in. Derived positionally on purpose: reading `inRange` off the cells
	 * only works for keys some cell mentions, and this source is sparse — a
	 * lead-in day on which no group had activity (a weekend suffices) has no
	 * cell at all, so it would default to in-range and be plotted six days
	 * before the range, on a truncated window, at exactly the extreme value the
	 * lead-in exists to prevent.
	 */
	inRangeFrom: string,
	groups: readonly string[],
	groupOf: (cell: T) => string,
	numeratorOf: (cell: T) => number,
	denominatorOf: (cell: T) => number,
	bucket: MetricsBucket,
): Map<string, TrailingPoint[]> {
	const byGroup = new Map<string, Map<string, T>>()
	for (const cell of cells) {
		const group = groupOf(cell)
		let cellsForGroup = byGroup.get(group)
		if (!cellsForGroup) {
			cellsForGroup = new Map()
			byGroup.set(group, cellsForGroup)
		}
		cellsForGroup.set(cell.bucketStart, cell)
	}

	const result = new Map<string, TrailingPoint[]>()
	for (const group of groups) {
		const cellsForGroup = byGroup.get(group)
		const dense: TrailingInput[] = bucketKeys.map((key) => {
			const cell = cellsForGroup?.get(key)
			return {
				bucketStart: key,
				inRange: key >= inRangeFrom,
				numerator: cell ? numeratorOf(cell) : 0,
				denominator: cell ? denominatorOf(cell) : 0,
			}
		})
		result.set(group, trailingSeries(dense, bucket))
	}
	return result
}

/**
 * The caption that must accompany any daily ratio chart.
 *
 * Not optional and not a footnote: a reader who takes a daily point for "what
 * Tuesday cost per kLOC" has misread the chart, and the only defence against
 * that is saying what the point is on the chart itself.
 */
export function trailingCaption(bucket: MetricsBucket): string | null {
	return bucket === 'day' ? `${TRAILING_WINDOW_DAYS}-day trailing — each point covers the week ending that day` : null
}
