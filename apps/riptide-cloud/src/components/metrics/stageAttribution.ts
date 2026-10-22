/**
 * Pure display + pivot logic behind the stage-attribution cards. Kept free of
 * React/recharts (like weeklyStacks) so the naming rules, series ordering,
 * and color assignment are unit-testable.
 *
 * Unlike models, stages are a CLOSED vocabulary (the RPI labels), so these
 * pivots show every stage — no top-N fold — and give each stage one fixed
 * color that both cards share, assigned by workflow position rather than by
 * window ranking so a stage keeps its color across weeks, ranges, and cards.
 */

import { NO_STAGE_KEY } from '@humanlayer/riptide-api-contract/api/metrics/stageSpendTrend'
import { RPI_LABELS } from '@humanlayer/ui/constants/rpi-skills'

import { densifyBucketRows } from './bucketStacks'
import type { MetricsBucket } from './range'

export { NO_STAGE_KEY }

/** Display name of the no-RPI-label bucket, everywhere it appears. */
export const NO_STAGE_LABEL = 'ad-hoc'

/**
 * Every possible stage in workflow progression order ('rpi:todo' excluded —
 * it never labels a session). Series stack and take colors in this order.
 */
export const STAGE_ORDER: readonly string[] = RPI_LABELS.filter((label) => label.name !== 'rpi:todo').map(
	(label) => label.name,
)

/** Series key for the no-stage bucket (raw stage names contain ':' and ChartConfig keys become CSS vars). */
export const NO_STAGE_SERIES_KEY = 'stage_none'

/**
 * How many `--chart-N` variables the theme defines (globals.css). Stage and
 * mode colors index into it by canonical position, so the vocabulary must fit:
 * at 10 the eleventh stage wrapped onto the first one's color, which is
 * invisible on the ranked card (every row carries text) and wrong on the
 * stacked bar, where color is the only thing naming a segment. Asserted
 * against STAGE_ORDER in stageAttribution.test.ts.
 */
export const CHART_PALETTE_SIZE = 12

/** Synthetic, CSS-safe series key for a stage. */
export function stageSeriesKey(stage: string): string {
	if (stage === NO_STAGE_KEY) return NO_STAGE_SERIES_KEY
	const index = STAGE_ORDER.indexOf(stage)
	return index === -1 ? `stage_x_${stage.replace(/[^a-z0-9]+/gi, '_')}` : `stage_${index}`
}

/**
 * The stage's fixed chart color. Keyed to the stage's canonical position, not
 * its rank in the current window, so 'research' is the same color on every
 * card and every date range. The no-stage bucket (and any legacy label not in
 * the vocabulary) is muted: it marks unattributed spend, not a stage.
 */
export function stageColorVar(stage: string): string {
	const index = STAGE_ORDER.indexOf(stage)
	if (stage === NO_STAGE_KEY || index === -1) return 'var(--color-muted-foreground)'
	return `var(--chart-${(index % CHART_PALETTE_SIZE) + 1})`
}

/**
 * Human name for a stage value from the API: the RPI label's title
 * ('rpi:structure' → 'structure'), the sentinel's fixed label, or — for a
 * legacy label no longer in RPI_LABELS — the raw name minus its 'rpi:' prefix
 * (still honest, still recognizable).
 */
export function stageDisplayName(stage: string): string {
	if (stage === NO_STAGE_KEY) return NO_STAGE_LABEL
	const known = RPI_LABELS.find((label) => label.name === stage)
	return known?.title ?? stage.replace(/^rpi:/, '')
}

/**
 * Human name for a `tasks.workflow_type` value. Unknown values render as
 * stored — the API deliberately passes modes through, so a future mode shows
 * up (ugly but present) instead of vanishing.
 */
export function modeDisplayName(mode: string): string {
	switch (mode) {
		case 'oneshot':
			return 'oneshot'
		case 'outline_only':
			return 'outline only'
		case 'prd_tdd':
			return 'PRD / TDD'
		case 'freeform':
			return 'freeform'
		case 'rpi':
			return 'rpi (legacy)'
		default:
			return mode
	}
}

export interface StageSeries {
	key: string
	label: string
	total: number
	color: string
}

/**
 * Ascending progression rank; the no-stage bucket ranks after every stage,
 * unknown legacy labels just before it.
 */
function stageRank(stage: string): number {
	if (stage === NO_STAGE_KEY) return STAGE_ORDER.length + 1
	const index = STAGE_ORDER.indexOf(stage)
	return index === -1 ? STAGE_ORDER.length : index
}

/** Series entries for the stages present in `totals`, in progression order, no-stage last. */
function buildStageSeries(totals: Map<string, number>): StageSeries[] {
	return Array.from(totals.entries())
		.sort((a, b) => stageRank(a[0]) - stageRank(b[0]))
		.map(([stage, total]) => ({
			key: stageSeriesKey(stage),
			label: stageDisplayName(stage),
			total,
			color: stageColorVar(stage),
		}))
}

/** One sparse cell from the stageSpendTrend API. */
export interface StageBucketCell {
	bucketStart: string
	stage: string
	costUsd: number
}

export interface StageBucketData {
	/** Dense: one row per bucket in [startDate, endDate], zero-filled. */
	rows: Array<Record<string, number | string>>
	/** Workflow progression order, no-stage last — every stage with spend, no fold. */
	series: StageSeries[]
}

/** Pivots sparse (bucket, stage, cost) cells into dense grouped-bar rows. */
export function pivotStageBuckets(
	cells: readonly StageBucketCell[],
	startDate: string,
	endDate: string,
	bucket: MetricsBucket,
): StageBucketData {
	const totals = new Map<string, number>()
	for (const cell of cells) {
		totals.set(cell.stage, (totals.get(cell.stage) ?? 0) + cell.costUsd)
	}
	const series = buildStageSeries(totals)

	return {
		rows: densifyBucketRows(
			cells,
			series.map((entry) => entry.key),
			(cell) => stageSeriesKey(cell.stage),
			(cell) => cell.costUsd,
			startDate,
			endDate,
			bucket,
		),
		series,
	}
}

/**
 * Workflow modes in stacking order, most ceremony first, so a stack reads
 * structured at the bottom and unstructured on top. Legacy 'rpi' sits with
 * the structured modes it predates.
 */
export const MODE_ORDER: readonly string[] = ['prd_tdd', 'outline_only', 'rpi', 'oneshot', 'freeform']

/** Synthetic, CSS-safe series key for a mode. */
export function modeSeriesKey(mode: string): string {
	const index = MODE_ORDER.indexOf(mode)
	return index === -1 ? `mode_x_${mode.replace(/[^a-z0-9]+/gi, '_')}` : `mode_${index}`
}

/**
 * The mode's fixed chart color, keyed to its canonical position so a mode
 * keeps its color across date ranges. A mode outside the known vocabulary
 * (a future workflow type) renders muted rather than stealing a color.
 */
export function modeColorVar(mode: string): string {
	const index = MODE_ORDER.indexOf(mode)
	if (index === -1) return 'var(--color-muted-foreground)'
	return `var(--chart-${(index % CHART_PALETTE_SIZE) + 1})`
}

/** One sparse cell from the modeSpendTrend API. */
export interface ModeBucketCell {
	bucketStart: string
	mode: string
	costUsd: number
}

export interface ModeSeries {
	key: string
	label: string
	total: number
	color: string
}

export interface ModeBucketData {
	/** Dense: one row per bucket in [startDate, endDate], zero-filled. */
	rows: Array<Record<string, number | string>>
	/** Canonical mode order — every mode with spend, no fold. */
	series: ModeSeries[]
}

/** Pivots sparse (bucket, mode, cost) cells into dense grouped-bar rows. */
export function pivotModeBuckets(
	cells: readonly ModeBucketCell[],
	startDate: string,
	endDate: string,
	bucket: MetricsBucket,
): ModeBucketData {
	const totals = new Map<string, number>()
	for (const cell of cells) {
		totals.set(cell.mode, (totals.get(cell.mode) ?? 0) + cell.costUsd)
	}

	const series: ModeSeries[] = Array.from(totals.entries())
		.sort((a, b) => {
			const rank = (mode: string) => {
				const index = MODE_ORDER.indexOf(mode)
				return index === -1 ? MODE_ORDER.length : index
			}
			return rank(a[0]) - rank(b[0])
		})
		.map(([mode, total]) => ({
			key: modeSeriesKey(mode),
			label: modeDisplayName(mode),
			total,
			color: modeColorVar(mode),
		}))

	return {
		rows: densifyBucketRows(
			cells,
			series.map((entry) => entry.key),
			(cell) => modeSeriesKey(cell.mode),
			(cell) => cell.costUsd,
			startDate,
			endDate,
			bucket,
		),
		series,
	}
}
