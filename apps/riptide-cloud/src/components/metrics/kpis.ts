import type { RiptideApiOutputs } from '@humanlayer/riptide-api-contract/contract-router'

import type { ScatterFilters } from './filters'

/**
 * The per-user aggregate row from metrics.usersScatter — DERIVED from the
 * contract, never re-typed by hand, so a renamed endpoint field breaks the
 * build here instead of silently feeding NaN into every total.
 */
export type KpiUserRow = RiptideApiOutputs['metrics']['usersScatter']['data'][number]

export interface KpiTotals {
	costUsd: number
	/** locAdded + locDeleted — the "LOC changed" denominator. */
	locChanged: number
	commitCount: number
	prsMerged: number
	/** Dollars per 1,000 changed lines; null when locChanged is 0. */
	costPerKlocChanged: number | null
	/** Dollars per commit; null when commitCount is 0. */
	costPerCommit: number | null
	/** Dollars per merged PR; null when prsMerged is 0. */
	costPerPrMerged: number | null
}

export function computeKpiTotals(rows: KpiUserRow[]): KpiTotals {
	// Only what a consumer reads is kept on the result — per-row token and
	// added/deleted splits stay on the scatter rows where the tooltips live.
	const sums = rows.reduce(
		(acc, row) => {
			acc.costUsd += row.costUsd
			acc.locChanged += row.locAdded + row.locDeleted
			acc.commitCount += row.commitCount
			acc.prsMerged += row.prsMerged
			return acc
		},
		{ costUsd: 0, locChanged: 0, commitCount: 0, prsMerged: 0 },
	)
	return {
		...sums,
		costPerKlocChanged: sums.locChanged > 0 ? sums.costUsd / (sums.locChanged / 1000) : null,
		costPerCommit: sums.commitCount > 0 ? sums.costUsd / sums.commitCount : null,
		costPerPrMerged: sums.prsMerged > 0 ? sums.costUsd / sums.prsMerged : null,
	}
}

/**
 * Which active filter makes the cost ÷ LOC ratio incomparable, or null when
 * it's safe to show. Each filter narrows only the aggregates whose source
 * table carries the column (see the usersScatter contract): a repo filter
 * narrows LOC but not spend, a model filter narrows spend but not LOC —
 * dividing org-wide spend by repo-scoped LOC (or vice versa) produces a
 * nonsense number. An agent filter narrows both sides, so it stays valid.
 */
export function locRatioBlockingFilter(filters: ScatterFilters): 'model' | 'repo' | null {
	if (filters.models && filters.models.length > 0) return 'model'
	if (filters.repos && filters.repos.length > 0) return 'repo'
	return null
}

/**
 * Heuristic for "spend history doesn't reach the start of this range": usage
 * collection typically starts later than commit backfill, so a longer window
 * whose total spend is IDENTICAL to the next-shorter window's — while its LOC
 * kept growing — is dividing a partial numerator by a full denominator.
 * Callers compare adjacent week windows (8w vs 4w, 12w vs 8w — see
 * SHORTER_WEEKS in MetricsKpiRow). Originally observed on real data with the
 * old day ranges: 90d cost == 30d cost to the cent while 90d LOC ≈ 2.7×.
 *
 * "Identical" is a half-cent tolerance, not strict equality: cost_usd is
 * double precision and both the server's SUM() and the client reduce are
 * order-dependent float sums, so the same spend can differ in the last ulp
 * between the two range queries.
 */
export function spendCoverageSuspect(
	longRange: Pick<KpiTotals, 'costUsd' | 'locChanged'>,
	shortRange: Pick<KpiTotals, 'costUsd' | 'locChanged'>,
): boolean {
	return (
		longRange.costUsd > 0 &&
		Math.abs(longRange.costUsd - shortRange.costUsd) < 0.005 &&
		longRange.locChanged > shortRange.locChanged
	)
}

// Pinned locale: deterministic output in tests and consistent with the charts'
// hardcoded `$${v.toFixed(2)}` axis formatting.
const compactFormat = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })

/** 2171483 → "2.2M", 439 → "439". */
export function formatCompact(value: number): string {
	return compactFormat.format(value)
}

/** Compact dollars for tile sublines: 19155.8 → "$19.2K", 81 → "$81". */
export function formatUsdCompact(value: number): string {
	return `$${compactFormat.format(value)}`
}

/**
 * Whole dollars for a table column: 507.53 → "$508", 12519.91 → "$12,520".
 *
 * Not `formatUsdCompact` here: a ranked list is read DOWN the column, and
 * "$1.1K" next to "$507.5" gives two different precisions in one column of
 * figures. Whole dollars are one precision and still separate 1,100 from
 * 1,400, which a compact "$1K" for both would not.
 */
export function formatUsdWhole(value: number): string {
	return `$${Math.round(value).toLocaleString('en-US')}`
}

/**
 * Exact dollars for tooltips: 19155.831 → "$19,155.83". The axis stays compact
 * (`formatUsdCompact`); a tooltip is where the reader wants the real number.
 */
export function formatUsdExact(value: number): string {
	return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** Ratio dollars: always two decimals so $8.82 and $1.97 read as unit prices. */
export function formatUsdRatio(value: number): string {
	return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/**
 * The literal per-line whisper for the hero subline. Four decimals because the
 * real magnitude is fractions of a cent per line ($0.0088); two would round to
 * an information-free "$0.01".
 */
export function formatUsdPerLine(costPerKloc: number): string {
	return `$${(costPerKloc / 1000).toFixed(4)}`
}

/**
 * Below this many changed lines a cost ÷ LOC ratio explodes (a real user with
 * $81 spend over 21 lines computes to $3,843/kLOC) and reads as noise rather
 * than efficiency — applies to the per-user tooltip AND the org hero tile.
 */
export const LOW_VOLUME_LOC_FLOOR = 1000

/**
 * The same floor expressed in the units a kLOC ratio divides by, so a caller
 * holding a kLOC denominator can apply it without re-deriving the line count.
 */
export const LOW_VOLUME_KLOC_FLOOR = LOW_VOLUME_LOC_FLOOR / 1000

/** Per-user tooltip ratio with the low-volume guard applied. */
export function costPerKlocLabel(costUsd: number, locChanged: number): string {
	if (locChanged < LOW_VOLUME_LOC_FLOOR) return 'low volume'
	return formatUsdRatio(costUsd / (locChanged / 1000))
}
