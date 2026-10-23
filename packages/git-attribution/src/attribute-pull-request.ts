import { commitLedgerMethod } from './evidence/commit-ledger/method'
import type {
	BranchSessionEvidence,
	PullRequestAttributionMethod,
	PullRequestAttributionMethodName,
} from './evidence/method'

/**
 * The pull request tiers (the DB's `pull_requests.attribution_method` and
 * `pull_request_sessions.tier` values), weakest to strongest. `observed` is the fallthrough: the
 * session had the branch checked out, and no method saw stronger evidence. Only `committed`
 * counts a pull request as a session's output in the metrics.
 */
export const PULL_REQUEST_ATTRIBUTION_TIERS = ['observed', 'committed'] as const
export type PullRequestAttributionTier = (typeof PULL_REQUEST_ATTRIBUTION_TIERS)[number]

/** The tiers under which a merged pull request counts as a session's output in the metrics. */
export const PULL_REQUEST_COUNTED_TIERS = ['committed'] as const satisfies readonly PullRequestAttributionTier[]

/** -1 for no tier, so any tier beats null. */
export const pullRequestTierRank = (tier: PullRequestAttributionTier | null): number =>
	tier === null ? -1 : PULL_REQUEST_ATTRIBUTION_TIERS.indexOf(tier)

/**
 * How long after a session last had a branch checked out a pull request on that branch still
 * counts as that session's work. Branch names are reused across people, so an older observation
 * is treated as coincidence.
 */
export const BRANCH_ATTRIBUTION_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

/**
 * THE pull request attribution sequencer — the one place that says which methods exist, which
 * are enabled, the order they run in, and the tier each one's claim books as, mirroring
 * ./attribute-commit. Order IS priority: the first claim wins, and a session no enabled method
 * claims falls through to `observed`.
 */
export const PULL_REQUEST_ATTRIBUTION_METHODS: ReadonlyArray<{
	readonly enabled: boolean
	readonly method: PullRequestAttributionMethod
	readonly tier: PullRequestAttributionTier
}> = [
	{ enabled: true, method: commitLedgerMethod, tier: 'committed' }, // the ledger has a commit of the session on the branch
]

export type PullRequestForAttribution = {
	/** Every session recorded on the head branch, however long ago. */
	readonly sessions: readonly BranchSessionEvidence[]
	/** Epoch ms the window is measured from. */
	readonly now: number
}

export type AttributedBranchSession = {
	readonly sessionId: string
	readonly tier: PullRequestAttributionTier
}

export type PullRequestAttributionResult = {
	/** One entry per session inside the window, in input order. */
	readonly sessions: readonly AttributedBranchSession[]
	/** The highest tier among them, or null when no session is inside the window. */
	readonly strongest: AttributedBranchSession | null
}

/**
 * Attribute the sessions on a pull request's head branch: drop those outside the window, then
 * run the enabled methods over each in sequence; first claim wins, else `observed`.
 *
 * `disabledMethods` skips methods for THIS call only — the durable switch is the `enabled`
 * literal in {@link PULL_REQUEST_ATTRIBUTION_METHODS}.
 */
export function attributePullRequest(
	pullRequest: PullRequestForAttribution,
	options?: { readonly disabledMethods?: ReadonlyArray<PullRequestAttributionMethodName> },
): PullRequestAttributionResult {
	const seenSince = pullRequest.now - BRANCH_ATTRIBUTION_WINDOW_MS
	const sessions = pullRequest.sessions
		.filter((session) => session.lastSeenAt >= seenSince)
		.map((session) => ({ sessionId: session.sessionId, tier: tierFor(session, options?.disabledMethods) }))
	const strongest = sessions.reduce<AttributedBranchSession | null>(
		(best, session) =>
			best === null || pullRequestTierRank(session.tier) > pullRequestTierRank(best.tier) ? session : best,
		null,
	)
	return { sessions, strongest }
}

function tierFor(
	session: BranchSessionEvidence,
	disabledMethods: ReadonlyArray<PullRequestAttributionMethodName> | undefined,
): PullRequestAttributionTier {
	for (const { enabled, method, tier } of PULL_REQUEST_ATTRIBUTION_METHODS) {
		if (!enabled || disabledMethods?.includes(method.name)) continue
		if (method.claim(session)) return tier
	}
	return 'observed'
}
