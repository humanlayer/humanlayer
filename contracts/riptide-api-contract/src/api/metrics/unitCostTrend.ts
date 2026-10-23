import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'
import { metricsRangeInput } from './range'

// Deliberately NO filters. Every number this endpoint feeds is a ratio of
// spend to output, and no single filter narrows both sides for all three
// denominators (models narrow only spend, repos narrow only output, agents
// narrow spend/commits/LOC but never merged PRs). The page scopes its filters
// to the scatter — the one chart where a one-sided narrowing is a disclosed
// exploration rather than a corrupted ratio.
export const UnitCostTrendInputSchema = metricsRangeInput()

/**
 * Per-bucket numerator and denominators for the page's unit-cost lens: Σspend,
 * ΣLOC changed, commit count, and merged-PR count. The client divides spend by
 * the active lens's denominator — cost per kLOC, per commit, or per PR over
 * time — so all three trends come from one query and are guaranteed to agree
 * with each other and with the KPI cards (same Σ-before-÷ rule;
 * `computeKpiTotals` derives the cards identically).
 *
 * No ratio field is returned on purpose: shipping a pre-divided ratio for one
 * denominator invites a client to plot it next to a locally-divided ratio for
 * another, and any future drift between the two derivations would be invisible.
 * One side does the division.
 *
 * ## Buckets
 *
 * Buckets are whole and dense — every bucket in the range is present even with
 * no activity — and follow the request's `bucket`, so a weekly response is
 * Monday-anchored exactly as before and a daily response is one row per
 * calendar day. The range is bucket-aligned by contract (see range.ts), so no
 * bucket here is ever partial except the current one in progress.
 *
 * ## The lead-in
 *
 * At `bucket: 'day'` the response ALSO carries the
 * six days (TRAILING_LEAD_IN_DAYS in range.ts) immediately before `from`, flagged
 * `inRange: false`.
 *
 * A daily unit cost cannot be read as a same-day ratio: a Tuesday with $380 of
 * spend and two commits reads $190/commit, while the identical work merged as
 * one commit on Wednesday reads $12 — and spend accrues on `occurred_at` every
 * day the agent runs while output lands on `committed_at`/`merged_at` days
 * later, in a lump. The client therefore plots a 7-DAY TRAILING ratio, and its
 * first plotted day needs the six days before it. Sending those days here,
 * marked, keeps the range the user picked and the data the response carries
 * reconcilable inside one payload — the alternative (the client quietly
 * widening its own request) makes every cache key and every caption a lie.
 *
 * Weekly responses carry no lead-in: a weekly ratio is already a whole week of
 * numerator over the same whole week of denominator.
 *
 * Raw sums are returned so a client can tell the different "no line here"
 * cases apart:
 *
 * - denominator = 0           → nothing to divide by; render no point.
 * - denominator > 0, cost = 0 → NOT a $0.00 efficiency reading. Usage
 *                               collection started later than the commit
 *                               backfill, so early buckets legitimately have
 *                               output and no spend. Clients must render these
 *                               as a GAP (see `toTrendRows` in the UI) —
 *                               plotting them at zero would read as "AI output
 *                               used to be free".
 * - both > 0                  → a real reading.
 */
export const UnitCostTrendOutputSchema = z.object({
	data: z.array(
		z.object({
			/** First day of the bucket, 'YYYY-MM-DD' (a Monday when bucket is 'week'). */
			bucketStart: z.string(),
			/**
			 * False for the trailing lead-in buckets that precede `from`. Clients
			 * must FEED these to the trailing window and NOT plot them; plotting
			 * them silently widens every daily chart past the selected range.
			 * Always true in weekly responses.
			 */
			inRange: z.boolean(),
			/** Σ session_usage_events.cost_usd for the bucket (occurred_at). */
			costUsd: z.number(),
			/**
			 * Σ (additions + deletions) for the bucket (committed_at), excluding
			 * commits known to be human-authored — see usersScatter, whose commit
			 * aggregates share the counting rule.
			 */
			locChanged: z.number(),
			/** Commits in the bucket (same human exclusion) — the $/commit denominator. */
			commitCount: z.number(),
			/**
			 * Merged, non-bot PRs in the bucket (merged_at) — the $/PR denominator.
			 * PRs carry no attribution, so no human exclusion is possible here.
			 */
			prsMerged: z.number(),
		}),
	),
	/** Echo of the requested range, so a card captions what it actually plots. */
	startDate: z.string(),
	endDate: z.string(),
})

export const unitCostTrendContract = contractBuilder.input(UnitCostTrendInputSchema).output(UnitCostTrendOutputSchema)
