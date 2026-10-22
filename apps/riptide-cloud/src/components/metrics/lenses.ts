/**
 * The page's lens system: one numerator (token spend), three denominators
 * (commits, changed lines, merged PRs). The selected lens re-denominates the
 * KPI card, the scatter's y-axis, and the unit-cost trend TOGETHER — three
 * views of the same ratio, never three different metrics. Kept free of
 * React/recharts so the copy and accessors are unit-testable.
 */

import { formatCompact, type KpiTotals, type KpiUserRow } from './kpis'

export type MetricLens = 'commits' | 'kloc' | 'prs'

/** Card order on the page: commits · kLOC (default) · PRs. */
export const METRIC_LENSES: readonly MetricLens[] = ['commits', 'kloc', 'prs']

export const DEFAULT_LENS: MetricLens = 'kloc'

export interface TrackingFlags {
	commitTrackingEnabled: boolean
	prTrackingEnabled: boolean
}

/**
 * The lenses whose data pipeline is actually collecting: commits and kLOC
 * need commit tracking, PRs need PR tracking. A card for a disabled pipeline
 * can only ever read "—", so it hides instead — flag-driven, not
 * data-driven, deliberately: an org WITH tracking on and zero PRs merged
 * should still see "$— / no PRs merged" (that zero is signal), while an org
 * that never collects PRs shouldn't see a permanently dead card.
 *
 * Degenerate config (dashboard enabled, both pipelines off) falls back to
 * every lens rather than rendering a bare spend page with no explanation.
 */
export function availableLenses(flags: TrackingFlags): readonly MetricLens[] {
	const lenses = METRIC_LENSES.filter((lens) =>
		lens === 'prs' ? flags.prTrackingEnabled : flags.commitTrackingEnabled,
	)
	return lenses.length > 0 ? lenses : METRIC_LENSES
}

/**
 * The available lenses that can still be computed while commit attribution has
 * produced nothing at all.
 *
 * $/commit and $/kLOC both divide by attributed commits, so they are dead
 * until the first one lands. $/PR is NOT: merged PRs are collected by their
 * own pipeline into their own table and carry no attribution
 * (`usersScatter.ts` never joins them to commits), so an org still waiting on
 * its first attributed commit has a real, correct cost per PR. Hiding that
 * would withhold working data, which is the opposite of what the wait is for.
 *
 * Returns empty when every available lens needs a commit — that is the page's
 * signal that the whole lens instrument, not just one card, has to wait.
 */
export function lensesWithDenominator(
	available: readonly MetricLens[],
	commitAttributionPending: boolean,
): readonly MetricLens[] {
	if (!commitAttributionPending) return available
	return available.filter((lens) => lens === 'prs')
}

/** The requested lens if available, else the default, else the first available. */
export function resolveLens(requested: MetricLens, available: readonly MetricLens[]): MetricLens {
	if (available.includes(requested)) return requested
	if (available.includes(DEFAULT_LENS)) return DEFAULT_LENS
	return available[0] ?? DEFAULT_LENS
}

export interface LensDefinition {
	/** KPI card label. */
	kpiLabel: string
	/** Unit suffix on the KPI value. */
	unit: string
	/** Hero scatter card title. */
	scatterTitle: string
	/** The question the scatter answers, leading its caption. */
	scatterQuestion: string
	/** Scatter y-axis title (always a weekly rate — see perWeek). */
	yAxisLabel: string
	/** Trend card title. */
	trendTitle: string
	/** The question the trend answers, leading its caption. */
	trendQuestion: string
	/** Headline suffix, e.g. "$21.06/kLOC". */
	headlineUnit: string
}

export const LENS_DEFINITIONS: Record<MetricLens, LensDefinition> = {
	commits: {
		kpiLabel: 'Cost per commit',
		unit: '/ commit',
		scatterTitle: 'Spend vs Commits',
		scatterQuestion: 'Does more agent spend track with more commits landed?',
		yAxisLabel: 'Commits / week',
		trendTitle: 'Cost per commit over time',
		trendQuestion: 'Is our cost per commit rising?',
		headlineUnit: '/commit',
	},
	kloc: {
		kpiLabel: 'Cost per kLOC changed',
		unit: '/ kLOC',
		scatterTitle: 'Spend vs Net LOC',
		scatterQuestion: 'Does heavier agent use add or remove code on net?',
		yAxisLabel: 'Net LOC / week',
		trendTitle: 'Cost per kLOC over time',
		trendQuestion: 'Is our cost per kLOC rising?',
		headlineUnit: '/kLOC',
	},
	prs: {
		kpiLabel: 'Cost per PR merged',
		unit: '/ PR',
		scatterTitle: 'Spend vs Throughput',
		scatterQuestion: 'Does more agent spend track with more merged PRs?',
		yAxisLabel: 'PRs merged / week',
		trendTitle: 'Cost per PR over time',
		trendQuestion: 'Is our cost per merged PR rising?',
		headlineUnit: '/PR',
	},
}

/** The lens's unit-cost ratio from the org totals; null when no denominator. */
export function lensRatio(totals: KpiTotals, lens: MetricLens): number | null {
	switch (lens) {
		case 'commits':
			return totals.costPerCommit
		case 'kloc':
			return totals.costPerKlocChanged
		case 'prs':
			return totals.costPerPrMerged
	}
}

/** The "÷ <denominator>" half of a KPI card subheader. */
export function lensDenominatorLabel(totals: KpiTotals, lens: MetricLens): string {
	switch (lens) {
		case 'commits':
			return `${formatCompact(totals.commitCount)} commits`
		case 'kloc':
			return `${formatCompact(totals.locChanged)} LOC changed`
		case 'prs':
			return `${formatCompact(totals.prsMerged)} PRs merged`
	}
}

/**
 * The scatter's RAW y for a user under this lens (before perWeek scaling).
 * kloc plots NET lines (added − deleted) on a signed axis — deletion-heavy
 * work (refactors, cleanups) is real output and belongs below zero, not at
 * the origin like idleness.
 */
export function scatterRawY(user: KpiUserRow, lens: MetricLens): number {
	switch (lens) {
		case 'commits':
			return user.commitCount
		case 'kloc':
			return user.locAdded - user.locDeleted
		case 'prs':
			return user.prsMerged
	}
}

/**
 * Whether a user has anything to plot under this lens: some spend, or some
 * activity on the lens's axis. Users with neither are skipped; zero-spend
 * users WITH activity stay — they're the non-adopter baseline group.
 */
export function scatterHasSignal(user: KpiUserRow, lens: MetricLens): boolean {
	if (user.costUsd !== 0) return true
	switch (lens) {
		case 'commits':
			return user.commitCount !== 0
		case 'kloc':
			return user.locAdded !== 0 || user.locDeleted !== 0
		case 'prs':
			return user.prsMerged !== 0
	}
}

/**
 * Dot-size dimension per lens — always a metric NOT already on an axis, so
 * the third encoding adds information instead of restating y.
 */
export function scatterSizeKey(lens: MetricLens): 'commitCount' | 'prsMerged' {
	return lens === 'prs' ? 'commitCount' : 'prsMerged'
}

export const SCATTER_SIZE_LABEL: Record<MetricLens, string> = {
	commits: 'PRs merged',
	kloc: 'PRs merged',
	prs: 'commits',
}
