/**
 * Pure pivot behind the stacked-area cards (model, stage and mode spend):
 * sparse (bucket, name, value) cells in, dense recharts rows plus a bounded
 * series list out. Kept free of React/recharts so the top-N fold and the
 * disclosure of what it dropped are unit-testable.
 *
 * These are RAW SUMS, not ratios, so they bucket to the day with no trailing
 * window and no lead-in — a day's spend by model is exactly a day's spend by
 * model. The whole trailing apparatus exists for the ratio cards only.
 */

import { enumerateBuckets } from '@humanlayer/riptide-api-contract/api/metrics/range'

import type { MetricsBucket } from './range'

/** One sparse cell from the API. */
export interface BucketCell {
	bucketStart: string
	name: string
	value: number
}

export interface StackSeries {
	/**
	 * Synthetic row/config key ("series_0", …). Deliberately NOT the raw name:
	 * ChartConfig keys become CSS custom properties (`--color-<key>`), and real
	 * names contain '/', '.', spaces — anything. The label carries the name.
	 */
	key: string
	label: string
	total: number
}

export interface BucketStackData {
	/** Dense: one row per bucket in [startDate, endDate], zero-filled. */
	rows: Array<Record<string, number | string>>
	/** Largest-total-first, at most maxSeries entries plus the optional fold. */
	series: StackSeries[]
	/**
	 * Names folded into the "other" series, largest first — the caption must
	 * NAME what the cap dropped rather than letting an opaque "other" band
	 * look as authoritative as the real ones.
	 */
	droppedNames: string[]
}

/** Key of the fold series when more than `maxSeries` names exist. */
export const OTHER_SERIES_KEY = 'series_other'

/**
 * Sparse cells → dense zero-filled rows, one per bucket in [startDate, endDate].
 *
 * The shared half of every pivot on this page. What differs between the model,
 * stage and mode cards is only how series are CHOSEN and named — the
 * densification is identical, and had been copied three times with the same
 * boundary comment attached to each copy.
 */
export function densifyBucketRows<Cell extends { bucketStart: string }>(
	cells: readonly Cell[],
	seriesKeys: readonly string[],
	keyOf: (cell: Cell) => string,
	valueOf: (cell: Cell) => number,
	startDate: string,
	endDate: string,
	bucket: MetricsBucket,
): Array<Record<string, number | string>> {
	const rowByBucket = new Map<string, Record<string, number | string>>()
	for (const bucketStart of enumerateBuckets(startDate, endDate, bucket)) {
		const row: Record<string, number | string> = { bucketStart }
		for (const key of seriesKeys) row[key] = 0
		rowByBucket.set(bucketStart, row)
	}

	for (const cell of cells) {
		const row = rowByBucket.get(cell.bucketStart)
		// Cells outside the dense range (clock skew on the boundary) are dropped
		// rather than crashing or minting phantom buckets.
		if (!row) continue
		const key = keyOf(cell)
		row[key] = (row[key] as number) + valueOf(cell)
	}

	return Array.from(rowByBucket.values())
}

/**
 * Pivots sparse cells into dense stacked-area rows.
 *
 * Series are ordered by range total, descending (name ascending on ties, so
 * the stacking order is stable across refetches instead of shuffling bands),
 * and capped at `maxSeries`; the remainder is summed into one "other" series
 * whose members are returned in `droppedNames` for the caption. Buckets are
 * densified over [startDate, endDate] with zeros so the areas span the full
 * range instead of starting at the first nonzero bucket.
 */
export function pivotBucketStacks(
	cells: readonly BucketCell[],
	startDate: string,
	endDate: string,
	bucket: MetricsBucket,
	maxSeries: number,
): BucketStackData {
	const totals = new Map<string, number>()
	for (const cell of cells) {
		totals.set(cell.name, (totals.get(cell.name) ?? 0) + cell.value)
	}

	const ranked = Array.from(totals.entries()).sort((a, b) => {
		const diff = b[1] - a[1]
		return diff !== 0 ? diff : a[0].localeCompare(b[0])
	})

	const kept = ranked.slice(0, maxSeries)
	const dropped = ranked.slice(maxSeries)

	const keyByName = new Map<string, string>()
	const series: StackSeries[] = kept.map(([name, total], index) => {
		const key = `series_${index}`
		keyByName.set(name, key)
		return { key, label: name, total }
	})

	if (dropped.length > 0) {
		const droppedTotal = dropped.reduce((sum, [, total]) => sum + total, 0)
		for (const [name] of dropped) keyByName.set(name, OTHER_SERIES_KEY)
		series.push({ key: OTHER_SERIES_KEY, label: `other (${dropped.length})`, total: droppedTotal })
	}

	return {
		rows: densifyBucketRows(
			// A name with no series key belongs to no band at all; filtering here
			// keeps densifyBucketRows from having to model "drop this cell".
			cells.filter((cell) => keyByName.has(cell.name)),
			series.map((entry) => entry.key),
			(cell) => keyByName.get(cell.name) as string,
			(cell) => cell.value,
			startDate,
			endDate,
			bucket,
		),
		series,
		droppedNames: dropped.map(([name]) => name),
	}
}
