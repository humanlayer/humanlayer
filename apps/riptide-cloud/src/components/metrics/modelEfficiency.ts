/**
 * Pure derivations behind the "Cost per kLOC by model" card: which models earn
 * a line, how sparse (bucket, model) cells become a dense chart series, and when a
 * bucket's ratio is too thinly attributed to be trusted. Kept free of
 * React/recharts so every judgement call is unit-testable.
 */

import { addDays, enumerateBuckets, TRAILING_LEAD_IN_DAYS } from '@humanlayer/riptide-api-contract/api/metrics/range'
import type { RiptideApiOutputs } from '@humanlayer/riptide-api-contract/contract-router'

import { formatUsdRatio, LOW_VOLUME_KLOC_FLOOR, LOW_VOLUME_LOC_FLOOR } from './kpis'
import type { MetricLens } from './lenses'
import type { MetricsBucket } from './range'
import { trailingSeriesByGroup } from './trailingRatio'

/** One (bucket, model) cell from metrics.costPerKlocByModel — derived from the contract (see KpiUserRow). */
export type ModelCell = RiptideApiOutputs['metrics']['costPerKlocByModel']['data'][number]

/** One bucket's session-link coverage of the LOC denominator — derived from the contract. */
export type CoverageBucket = RiptideApiOutputs['metrics']['costPerKlocByModel']['coverage'][number]

/**
 * The denominators this chart can split by model. NOT every page lens:
 * merged PRs carry no session linkage (and no model), so a per-model $/PR
 * does not exist as a quantity — the PR lens pins this chart to kLOC and
 * says so instead of showing an empty card or a silently different number.
 */
export type ModelLens = 'kloc' | 'commits'

export interface ModelLensChoice {
	modelLens: ModelLens
	/**
	 * Non-null when the page lens could not be followed — the disclosure the
	 * card must surface so a $/kLOC chart under a $/PR lens reads as a stated
	 * limitation, not a bug.
	 */
	pinnedNote: string | null
}

/** Which denominator the card uses for a given page lens, with the disclosure. */
export function modelLensFor(lens: MetricLens): ModelLensChoice {
	if (lens === 'prs') {
		return {
			modelLens: 'kloc',
			pinnedNote:
				'Merged PRs carry no session linkage, so a per-model $/PR does not exist — showing $/kLOC by model instead.',
		}
	}
	return { modelLens: lens, pinnedNote: null }
}

/** The lens's denominator for one cell, in the units the ratio divides by. */
export function modelCellDenominator(cell: ModelCell, modelLens: ModelLens): number {
	return modelLens === 'kloc' ? cell.locChanged / 1000 : cell.commitCount
}

/**
 * True when a cell has too few changed lines for its ratio to be reliable.
 *
 * A single model's slice of a bucket is often small: on dev one cell held $182
 * of spend against 9 changed lines, which works out to $20,227/kLOC. Since all
 * models share one linear axis, that cell sets the scale and flattens the rest,
 * so the chart plots a gap instead, as it does for a bucket with no spend.
 *
 * This applies to the kLOC lens only, because the floor counts lines and has no
 * equivalent for commits. `unitCostTrend` uses the same rule.
 */
export function isLowVolumeCell(cell: ModelCell, modelLens: ModelLens): boolean {
	return modelLens === 'kloc' && cell.locChanged < LOW_VOLUME_LOC_FLOOR
}

/**
 * How many models get a line. Five is the number of distinct chart colours
 * (--chart-1..5) that stay distinguishable; past that the reader is matching
 * near-identical hues to a legend instead of comparing models.
 */
export const TOP_MODEL_LIMIT = 5

/**
 * Below this fraction of changed lines being session-linked, a bucket's
 * per-model ratio is not reliable: commits with no `session_id` (sessionless
 * capture paths) drop out of the denominator while unrelated spend still sits
 * in the numerator, so the ratio reads HIGH by roughly 1/coverage. Half is a
 * deliberately generous bar — it marks the buckets where the correction would
 * be larger than the signal.
 */
export const LOW_COVERAGE_THRESHOLD = 0.5

export interface ModelRanking {
	/** Models that get a line, ordered by total spend descending. */
	models: string[]
	/** Models omitted from the chart — named in the disclosures, never silently dropped. */
	omittedModels: string[]
	/** Total spend attributed to the omitted models, for the disclosure. */
	omittedCostUsd: number
}

/**
 * Ranks models by total spend over the range and keeps the top `limit`.
 *
 * Ties break on model name so the selection — and therefore each model's
 * colour — is stable across refetches rather than reshuffling on every poll.
 *
 * The remainder is DROPPED rather than folded into an "Other" line. On a spend
 * chart an "Other" series is a meaningful total; on a ratio chart it would be
 * the blended efficiency of a set of models nobody chose to look at, which
 * answers no question while looking exactly as authoritative as the real
 * lines. What the reader actually needs is to know that something was left
 * out and what — hence `omittedModels`.
 */
export function rankModels(cells: readonly ModelCell[], limit: number = TOP_MODEL_LIMIT): ModelRanking {
	const costByModel = new Map<string, number>()
	for (const cell of cells) {
		costByModel.set(cell.model, (costByModel.get(cell.model) ?? 0) + cell.costUsd)
	}
	const ordered = Array.from(costByModel.entries()).sort(
		([aModel, aCost], [bModel, bCost]) => bCost - aCost || aModel.localeCompare(bModel),
	)
	const kept = ordered.slice(0, limit)
	const omitted = ordered.slice(limit)
	return {
		models: kept.map(([model]) => model),
		omittedModels: omitted.map(([model]) => model),
		omittedCostUsd: omitted.reduce((sum, [, cost]) => sum + cost, 0),
	}
}

export interface ModelSeries {
	/**
	 * The recharts `dataKey` / ChartConfig key for this model. NOT the model
	 * name: recharts treats a dot in a dataKey as a property path (so
	 * "claude-opus-4.5" would resolve to `row['claude-opus-4']['5']` and plot
	 * nothing), and the chart's colours come from a `--color-<key>` CSS custom
	 * property, where dots, slashes and colons are invalid. An opaque index key
	 * sidesteps both; the model name lives in `label`.
	 */
	key: string
	label: string
	color: string
}

/** Stable, syntactically safe series descriptors for the ranked models. */
export function modelSeries(models: readonly string[]): ModelSeries[] {
	return models.map((model, index) => ({
		key: `model${index}`,
		label: model,
		color: `var(--chart-${index + 1})`,
	}))
}

export interface ModelTrendRow {
	bucketStart: string
	/** One entry per series key; null renders as a gap in that model's line. */
	[seriesKey: string]: string | number | null
}

export interface ModelTrend {
	/** One row per plotted bucket, one column per ranked model. */
	rows: ModelTrendRow[]
	/** Cells the low-volume floor turned into gaps, for the disclosure. */
	lowVolumeCells: number
}

/**
 * Pivots the sparse (bucket, model) cells onto the range's dense bucket axis,
 * one column per ranked model.
 *
 * These cells are RATIOS, so at day resolution they obey the page's trailing
 * rule exactly as the org-wide trend does: each plotted day carries the sums
 * of the seven days ending on it. Per model that matters even more than it
 * does org-wide — a single model's slice of a single day is often one commit,
 * or none.
 *
 * The axis is built from the RANGE rather than from the `coverage` array it
 * used to borrow. Coverage is a disclosure about the denominator, not a
 * statement about which buckets exist, and a daily trailing window needs the
 * lead-in buckets coverage deliberately omits.
 *
 * A value is null — a gap, not a zero — in every case where no honest ratio
 * exists:
 *
 * - the model has no cell in the window (it wasn't used, or produced no
 *   attributed commits): there is nothing to plot, and a 0 would claim it
 *   produced output for free;
 * - the denominator is 0: nothing to divide by;
 * - the denominator is positive but spend is 0: the same collection-lag
 *   artifact `toTrendRows` guards against on the org-wide chart — real output
 *   whose spend was never recorded, which as a plotted 0 reads as a free model;
 * - the denominator is under the low-volume floor: see {@link isLowVolumeCell}.
 *
 * Recharts leaves nulls unconnected, so each model's line breaks over the
 * buckets it has no trustworthy reading for.
 *
 * `lowVolumeCells` comes back with the rows because the caption has to name a
 * number that matches what the chart drew. Deriving it separately would walk
 * the same cells again and restate the rule, and the two could then disagree.
 */
export function pivotModelTrend(
	cells: readonly ModelCell[],
	series: readonly ModelSeries[],
	startDate: string,
	endDate: string,
	bucket: MetricsBucket,
	modelLens: ModelLens = 'kloc',
): ModelTrend {
	if (!startDate || !endDate) return { rows: [], lowVolumeCells: 0 }

	// The spine the API built its response on: the range, preceded by the
	// trailing lead-in when the buckets are days.
	const spineFrom = bucket === 'day' ? addDays(startDate, -TRAILING_LEAD_IN_DAYS) : startDate
	const bucketKeys = enumerateBuckets(spineFrom, endDate, bucket)

	const models = series.map((entry) => entry.label)
	const cost = trailingSeriesByGroup(
		cells,
		bucketKeys,
		startDate,
		models,
		(cell) => cell.model,
		(cell) => cell.costUsd,
		(cell) => modelCellDenominator(cell, modelLens),
		bucket,
	)
	let lowVolumeCells = 0
	const rowByBucket = new Map<string, ModelTrendRow>()
	for (const entry of series) {
		const points = cost.get(entry.label) ?? []
		for (const point of points) {
			let row = rowByBucket.get(point.bucketStart)
			if (!row) {
				row = { bucketStart: point.bucketStart }
				rowByBucket.set(point.bucketStart, row)
			}
			const plottable = point.denominator > 0 && point.numerator > 0
			// On the kLOC lens the trailing denominator already IS the window's
			// kLOC (see modelCellDenominator), so the floor applies directly — no
			// second pass over the same windows to recover the raw line count.
			const lowVolume = modelLens === 'kloc' && point.denominator < LOW_VOLUME_KLOC_FLOOR
			// Counted only when the floor is what stopped it. A window with no
			// spend or no denominator was already a gap for another reason.
			if (plottable && lowVolume) lowVolumeCells += 1
			row[entry.key] = plottable && !lowVolume ? point.numerator / point.denominator : null
		}
	}

	// Ascending. Every series is densified over the same spine, so the first one
	// already inserts every bucket in order — but the sort is cheap insurance
	// against that ever changing. Byte order IS date order for fixed-width keys,
	// so no collator is needed.
	const rows = Array.from(rowByBucket.values()).sort((a, b) => (a.bucketStart < b.bucketStart ? -1 : 1))
	return { rows, lowVolumeCells }
}

/**
 * Range-wide coverage: attributed changed lines ÷ all changed lines. A ratio
 * of sums, like everything else here — averaging the per-bucket fractions
 * would let a quiet bucket with three commits count as much as a busy one.
 */
export function overallCoverage(coverage: readonly CoverageBucket[]): number | null {
	const totals = coverage.reduce(
		(acc, entry) => {
			acc.attributed += entry.attributedLocChanged
			acc.total += entry.totalLocChanged
			return acc
		},
		{ attributed: 0, total: 0 },
	)
	return totals.total > 0 ? totals.attributed / totals.total : null
}

/** "62% of changed lines are session-linked" — mandatory context, not a footnote. */
export function formatCoverage(fraction: number): string {
	return `${Math.round(fraction * 100)}%`
}

/**
 * The info popover's honesty budget: what the chart is not showing and why,
 * one note per line. Every entry exists because its absence would let the
 * chart be read as more complete than it is — a silently truncated model
 * list reads as "these are all our models", and an unqualified ratio reads
 * as measured when it is partly inferred.
 */
export function disclosureNotes(
	ranking: ModelRanking,
	coverage: readonly CoverageBucket[],
	lowVolumeCells = 0,
	modelLens: ModelLens = 'kloc',
	bucket: MetricsBucket = 'week',
): string[] {
	// Every note that counts buckets has to name them correctly: "3 weeks under
	// 50% coverage" on a daily chart is simply false, and a disclosure that is
	// itself wrong is worse than none.
	const noun = bucket === 'week' ? 'week' : 'day'
	const plural = bucket === 'week' ? 'weeks' : 'days'
	const notes: string[] = [
		'Each session counts wholly under the model holding most of its spend — a session that switched models lands on one line.',
	]

	const overall = overallCoverage(coverage)
	if (overall !== null) {
		// "Session-linked", NOT "attributed to a model": the coverage counts
		// commits carrying a session_id, but a linked line still drops out of
		// the split when its session resolves no model — this figure is the
		// ceiling on attribution, not the attribution itself.
		notes.push(
			`${formatCoverage(overall)} of changed lines are session-linked — the ceiling for this split; a linked line still drops out if its session resolves no model.`,
		)
	}

	const lowCoverage = coverage.filter(
		(entry) => entry.coverage !== null && entry.coverage < LOW_COVERAGE_THRESHOLD,
	).length
	if (lowCoverage > 0) {
		notes.push(
			`${lowCoverage} ${lowCoverage === 1 ? noun : plural} under ${formatCoverage(LOW_COVERAGE_THRESHOLD)} coverage — those ratios read high.`,
		)
	}

	if (ranking.omittedModels.length > 0) {
		notes.push(
			`Showing the top ${ranking.models.length} models by spend; not shown: ${ranking.omittedModels.join(', ')} (${formatUsdRatio(ranking.omittedCostUsd)} total).`,
		)
	}

	notes.push(`${bucket === 'week' ? 'Weeks' : 'Windows'} with output but no recorded spend are gaps, not $0.`)

	// The note says what the chart does. The earlier wording described the floor
	// while the chart still plotted the cells below it.
	if (modelLens === 'kloc') {
		notes.push(
			lowVolumeCells > 0
				? `${lowVolumeCells} model-${lowVolumeCells === 1 ? noun : plural} under ${LOW_VOLUME_LOC_FLOOR.toLocaleString()} changed lines shown as gaps — the ratio is noise below that.`
				: `Model-${plural} under ${LOW_VOLUME_LOC_FLOOR.toLocaleString()} changed lines are shown as gaps — the ratio is noise below that.`,
		)
	}

	return notes
}
