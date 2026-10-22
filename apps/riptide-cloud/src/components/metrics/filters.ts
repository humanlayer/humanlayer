import type { CodingAgent } from '@humanlayer/schemas/coding-agent'

/**
 * Active filter selections for the Efficiency scatter charts. Empty/omitted
 * arrays mean "no filter" and are sent to the API as `undefined`. Each filter
 * narrows only the aggregates whose source table carries the column (see the
 * usersScatter contract): models → usage; agents → usage + commits; repos →
 * commits + merged PRs.
 */
export interface ScatterFilters {
	models?: string[]
	agents?: CodingAgent[]
	repos?: string[]
}

/**
 * Caption fragment disclosing which side of the scatter each active filter
 * actually narrows — the scatter tolerates one-sided filters as a disclosed
 * exploration (unlike the ratios, which refuse them), but only if the
 * asymmetry is said out loud: a model filter narrows the spend axis while the
 * output axis stays all-model, etc. Bare ' · '-joined clauses (empty when
 * every active filter is symmetric for the current axes).
 */
export function filterAsymmetryNote(filters: ScatterFilters, prsOnY: boolean): string {
	const parts: string[] = []
	if (filters.models && filters.models.length > 0) parts.push('model filter narrows spend only')
	if (filters.repos && filters.repos.length > 0) parts.push('repo filter narrows output only')
	if (prsOnY && filters.agents && filters.agents.length > 0)
		parts.push('agent filter narrows spend but not merged PRs')
	return parts.join(' · ')
}

/**
 * Card-description fragment describing the active filters, e.g.
 * " · filtered to 2 models · 1 repo". Empty string when nothing is filtered.
 */
export function filterSummary(filters: ScatterFilters): string {
	const parts = (
		[
			['model', filters.models],
			['agent', filters.agents],
			['repo', filters.repos],
		] as const
	).flatMap(([noun, values]) =>
		values && values.length > 0 ? [`${values.length} ${noun}${values.length === 1 ? '' : 's'}`] : [],
	)
	return parts.length > 0 ? ` · filtered to ${parts.join(' · ')}` : ''
}
