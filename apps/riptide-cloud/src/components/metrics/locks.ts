/**
 * Which tabs are locked because their denominator is never collected.
 *
 * Advanced Metrics itself follows billing (see the route guard). These two say something
 * narrower: an entitled org that collects nothing has two tabs that can only ever divide by
 * zero, and they are told so with an offer rather than an empty chart.
 *
 * Kept beside {@link availableLenses} in lenses.ts, and for the same reason: the rule about
 * which pipeline feeds which view is one sentence long and belongs somewhere a test can read
 * it, not spread through JSX.
 */
export interface CollectionFlags {
	commitTrackingEnabled: boolean
	prTrackingEnabled: boolean
}

/**
 * Efficiency locks only when BOTH pipelines are off.
 *
 * Its three lenses are $/commit, $/kLOC and $/PR. The first two need commits; the third needs
 * only a merged pull request, so an org that collects PRs and not commits still has a working
 * instrument — one lens is not a broken tab.
 */
export function efficiencyLocked(flags: CollectionFlags): boolean {
	return !flags.commitTrackingEnabled && !flags.prTrackingEnabled
}

/** Adoption is agent commits ranked by repository, so commits are the only input that matters. */
export function adoptionLocked(flags: CollectionFlags): boolean {
	return !flags.commitTrackingEnabled
}
