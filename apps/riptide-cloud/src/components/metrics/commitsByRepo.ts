/**
 * Pure derivations behind the "HumanLayer commits per repo" card: bar
 * ordering, tier totals, and repo-label shortening. Kept free of
 * React/recharts so every display decision is unit-testable.
 */

import type { RiptideApiOutputs } from '@humanlayer/riptide-api-contract/contract-router'

/** One repo's window totals, split by attribution tier — derived from the contract (see KpiUserRow). */
export type RepoCommitCounts = RiptideApiOutputs['metrics']['agentCommitsByRepo']['data'][number]

/** Total HumanLayer commits for a repo — the two tiers are disjoint, so they sum. */
export function repoTotal(row: RepoCommitCounts): number {
	return row.confirmedCount + row.inferredCount
}

/**
 * Bars ordered by total HumanLayer commits, descending. Ties break on repo
 * name ascending so the ordering is stable across refetches — recharts
 * animates row swaps, and a Map-insertion-ordered tie would make bars
 * shuffle on every poll for no reason.
 */
export function sortByTotalDesc(rows: readonly RepoCommitCounts[]): RepoCommitCounts[] {
	return [...rows].sort((a, b) => {
		const diff = repoTotal(b) - repoTotal(a)
		return diff !== 0 ? diff : a.repoFullName.localeCompare(b.repoFullName)
	})
}

/** Org-wide tier totals for the popover, so the reader can size the two tiers. */
export function tierTotals(rows: readonly RepoCommitCounts[]): {
	confirmed: number
	inferred: number
	total: number
} {
	const confirmed = rows.reduce((sum, row) => sum + row.confirmedCount, 0)
	const inferred = rows.reduce((sum, row) => sum + row.inferredCount, 0)
	return { confirmed, inferred, total: confirmed + inferred }
}

/** Widest repo label the category axis renders before shortening kicks in. */
export const REPO_LABEL_MAX = 28

/**
 * Shortens a long "owner/repo" for the category axis by dropping characters
 * from the FRONT, not the back: the repo name is the identifying part and
 * the owner is usually the same across every bar, so "…layer/riptide-api"
 * still distinguishes rows where "humanlayer/riptid…" would not.
 */
export function repoLabel(repoFullName: string, max: number = REPO_LABEL_MAX): string {
	if (repoFullName.length <= max) return repoFullName
	// Reserve one character for the leading ellipsis.
	return `…${repoFullName.slice(-(max - 1))}`
}

/** Chart row height in px — the card sizes itself so bars never get squashed. */
const ROW_HEIGHT = 34
const CHART_CHROME = 80

/**
 * Chart height for a given bar count. A horizontal bar chart with a fixed
 * height silently compresses rows as repos are added until the labels
 * collide; growing with the data keeps every bar legible and lets the page
 * scroll instead.
 */
export function chartHeight(barCount: number): number {
	return Math.max(180, barCount * ROW_HEIGHT + CHART_CHROME)
}
