import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'
import { metricsRangeInput } from './range'

// No filters: a `models` filter is moot (the series IS the model breakdown),
// and the page scopes its other filters to the scatter (see unitCostTrend).
export const CostPerKlocByModelInputSchema = metricsRangeInput()

/**
 * Weekly cost per 1,000 changed lines, **split by model** — the efficiency
 * comparison between models (is Fable cheaper per unit of output than
 * Sonnet?), not merely which model we spend the most on. `modelSpendTrend`
 * answers the spend question already and structurally cannot answer this
 * one: it has no LOC.
 *
 * Each cell's `costPerKloc` is Σcost ÷ ΣkLOC for that (week, model) — a ratio
 * of sums, never a mean of per-commit or per-user ratios.
 *
 * ## How a model is attributed — one rule, applied to both sides
 *
 * Commits carry no model column, so the model is derived at **session**
 * granularity: each session is assigned the model carrying the largest share
 * of that session's spend (cost-weighted, so a session that briefly switched
 * still lands on the model that did the work), falling back to
 * `sessions.resolved_model` and then `sessions.model` for sessions with no
 * usage rows.
 *
 * That single rule then attributes BOTH sides of the ratio: the numerator is
 * the spend of sessions whose dominant model is M, and the denominator is the
 * changed lines of commits belonging to those same sessions. Mixing rules —
 * taking the numerator from each usage row's own `model` while the denominator
 * used session-dominance — would make the ratio incoherent for any session
 * that switched models, since the two sides would be summing over different
 * populations. With one consistent rule the chart states something true: *for
 * sessions predominantly on model M, this is what their output cost.*
 *
 * The approximation is real and clients must disclose it: a session that
 * switched models mid-flight is counted **wholly** under its dominant model.
 *
 * ## Coverage — why it ships with the data, not as a footnote
 *
 * The numerator and denominator are asymmetrically attributable. Every usage
 * event belongs to a session, but a commit only does when it was captured with
 * a `session_id` (known-human commits have it NULL by design — they are
 * structurally excluded here, consistent with the rest of the page). Commits
 * without a session leave the denominator while unrelated spend still counts
 * in the numerator, which biases cost/kLOC **upward** — and the bias is
 * invisible in the ratio itself. `coverage` therefore reports, per week, what
 * fraction of the page's changed lines (non-human) were session-linked, so a
 * client can de-emphasise weeks whose ratio isn't trustworthy. A confidently
 * wrong efficiency number is worse than a withheld one.
 */
export const CostPerKlocByModelOutputSchema = z.object({
	/**
	 * One row per (week, model) observed in either spend or LOC. Sparse —
	 * clients pivot and decide their own densification (a missing cell means
	 * that model had neither spend nor session-linked commits in that bucket).
	 */
	data: z.array(
		z.object({
			/** First day of the bucket, 'YYYY-MM-DD' (a Monday when bucket is 'week'). */
			bucketStart: z.string(),
			/**
			 * False for the trailing lead-in buckets before `from`, present only in
			 * daily responses. This endpoint's cells are ratios, so they obey the
			 * same 7-day trailing rule as unitCostTrend and need the same lead-in —
			 * see that contract for why a same-day unit cost is not a readable
			 * number. Always true in weekly responses.
			 */
			inRange: z.boolean(),
			/** The session-dominant model, not any individual usage row's model. */
			model: z.string(),
			costUsd: z.number(),
			/** Σ(additions + deletions) over commits from sessions dominated by this model. */
			locChanged: z.number(),
			commitCount: z.number(),
			/** costUsd ÷ (locChanged / 1000); null when locChanged is 0. */
			costPerKloc: z.number().nullable(),
		}),
	),
	/** Per-bucket session-link coverage of the denominator. Dense over the range. */
	coverage: z.array(
		z.object({
			bucketStart: z.string(),
			/** Changed lines on commits that carry a session_id (never known-human). */
			attributedLocChanged: z.number(),
			/** Changed lines on ALL non-human commits in the bucket, session-linked or not. */
			totalLocChanged: z.number(),
			/** attributed ÷ total, 0..1; null when the bucket has no commits at all. */
			coverage: z.number().nullable(),
		}),
	),
	startDate: z.string(),
	endDate: z.string(),
})

export const costPerKlocByModelContract = contractBuilder
	.input(CostPerKlocByModelInputSchema)
	.output(CostPerKlocByModelOutputSchema)
