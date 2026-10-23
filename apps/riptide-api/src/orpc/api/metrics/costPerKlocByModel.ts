import * as Sentry from '@sentry/node'
import { sql } from 'drizzle-orm'
import * as Schema from 'effect/Schema'

import { logger } from '../../../logger'
import { apiBaseForAdvancedMetrics } from '../../base'
import { bucketKey, bucketKeySql, RATIO_LEAD_IN, resolveMetricsRange } from './utils'

const SqlNumber = Schema.Union([Schema.Number, Schema.NumberFromString])
const NullableSqlNumber = Schema.NullOr(SqlNumber)

const CostPerKlocCellRow = Schema.Struct({
	bucket_start: Schema.Union([Schema.String, Schema.Date]),
	model: Schema.String,
	cost_usd: NullableSqlNumber,
	additions: NullableSqlNumber,
	deletions: NullableSqlNumber,
	commit_count: NullableSqlNumber,
})

const CostPerKlocCoverageRow = Schema.Struct({
	bucket_start: Schema.Union([Schema.String, Schema.Date]),
	attributed: NullableSqlNumber,
	total: NullableSqlNumber,
})

const parseCostPerKlocCellRows = Schema.decodeUnknownSync(Schema.Array(CostPerKlocCellRow))
const parseCostPerKlocCoverageRows = Schema.decodeUnknownSync(Schema.Array(CostPerKlocCoverageRow))

/**
 * Cost per 1,000 changed lines, split by model, one row per bucket.
 *
 * Commits carry no model column, so the model is derived at SESSION
 * granularity and that one derivation attributes both sides of the ratio:
 *
 *  - `relevant_sessions` — every session touched by the range, whether
 *    through usage events or through commits. Bounds everything below.
 *  - `dominant` — per session, the model with the largest summed `cost_usd`.
 *    Cost-weighted rather than first/last/most-rows, so a session that
 *    briefly switched still lands on the model that did the work. Computed
 *    over the session's ENTIRE usage history, not just the range, so a
 *    session's model doesn't change identity depending on what is being
 *    viewed (a commit near a range edge would otherwise migrate between lines
 *    as the user drags the brush).
 *  - `session_model` — `dominant`, falling back to `sessions.resolved_model`
 *    then `sessions.model` for sessions with no usage rows at all.
 *
 * The spend and LOC aggregates then BOTH join through `session_model`. This
 * symmetry is the point: taking the numerator from each usage row's own
 * `model` while the denominator used session-dominance would sum the two
 * sides over different populations, and the ratio for any session that
 * switched models would be incoherent. One rule, applied twice, yields a
 * statement that is actually true — *for sessions predominantly on model M,
 * this is what their output cost.*
 *
 * Known-human commits are structurally excluded: they carry no `session_id`
 * by design, and every LOC aggregate here joins through sessions. The
 * coverage query filters them explicitly so its `total` measures the same
 * non-human population as the rest of the page.
 *
 * Both aggregates live in a single statement joined with a FULL OUTER JOIN so
 * the shared CTE chain is computed once and a model shows up whether it has
 * spend, output, or both. Coverage is a second, independent statement (it must
 * count commits with NO session, which the join above excludes by
 * construction), so the two run concurrently.
 *
 * Every ratio is Σcost ÷ ΣkLOC for the cell, never a mean of per-row ratios —
 * see unitCostTrend for why that distinction is worth ~150x.
 *
 * Access: plan entitlement + the page's audience, both enforced by
 * apiBaseForAdvancedMetrics.
 */
export const costPerKlocByModelProcedure = apiBaseForAdvancedMetrics.metrics.costPerKlocByModel.handler(
	async ({ context, input }) => {
		const { dbReadReplica } = context.services
		const { organizationId } = context.auth

		try {
			// A ratio endpoint, so it reads the same trailing lead-in unitCostTrend
			// does: its cells are per-bucket unit costs and obey the same 7-day
			// trailing rule in daily mode.
			const range = resolveMetricsRange(input, RATIO_LEAD_IN)
			const { startTimestamp, endTimestamp, bucket, offsetMinutes } = range

			const cellsQuery = dbReadReplica.execute(sql`
				WITH relevant_sessions AS (
					SELECT DISTINCT session_id
					FROM session_usage_events
					WHERE organization_id = ${organizationId}
						AND occurred_at >= ${startTimestamp}
						AND occurred_at <= ${endTimestamp}
					UNION
					SELECT DISTINCT session_id
					FROM authored_commits
					WHERE organization_id = ${organizationId}
						AND committed_at >= ${startTimestamp}
						AND committed_at <= ${endTimestamp}
						AND session_id IS NOT NULL
				),
				model_cost AS (
					SELECT sue.session_id, sue.model, SUM(sue.cost_usd) AS cost
					FROM session_usage_events sue
					JOIN relevant_sessions rs ON rs.session_id = sue.session_id
					WHERE sue.organization_id = ${organizationId}
					GROUP BY 1, 2
				),
				dominant AS (
					-- Highest summed cost wins; NULLS LAST so a priced model always
					-- beats an unpriced one, and the model name breaks ties so the
					-- assignment is deterministic across refetches.
					SELECT DISTINCT ON (session_id) session_id, model
					FROM model_cost
					ORDER BY session_id, cost DESC NULLS LAST, model
				),
				session_model AS (
					SELECT rs.session_id, COALESCE(d.model, s.resolved_model, s.model) AS model
					FROM relevant_sessions rs
					LEFT JOIN dominant d ON d.session_id = rs.session_id
					LEFT JOIN sessions s ON s.id = rs.session_id
				),
				spend AS (
					SELECT
						${bucketKeySql(sql`sue.occurred_at`, bucket, offsetMinutes)} AS bucket_start,
						sm.model AS model,
						SUM(sue.cost_usd) AS cost_usd
					FROM session_usage_events sue
					JOIN session_model sm ON sm.session_id = sue.session_id
					WHERE sue.organization_id = ${organizationId}
						AND sue.occurred_at >= ${startTimestamp}
						AND sue.occurred_at <= ${endTimestamp}
						AND sm.model IS NOT NULL
					GROUP BY 1, 2
				),
				loc AS (
					SELECT
						${bucketKeySql(sql`c.committed_at`, bucket, offsetMinutes)} AS bucket_start,
						sm.model AS model,
						SUM(c.additions)::text AS additions,
						SUM(c.deletions)::text AS deletions,
						COUNT(*)::text AS commit_count
					FROM authored_commits c
					JOIN session_model sm ON sm.session_id = c.session_id
					WHERE c.organization_id = ${organizationId}
						AND c.committed_at >= ${startTimestamp}
						AND c.committed_at <= ${endTimestamp}
						AND sm.model IS NOT NULL
					GROUP BY 1, 2
				)
				SELECT
					COALESCE(spend.bucket_start, loc.bucket_start) AS bucket_start,
					COALESCE(spend.model, loc.model) AS model,
					spend.cost_usd AS cost_usd,
					loc.additions AS additions,
					loc.deletions AS deletions,
					loc.commit_count AS commit_count
				FROM spend
				FULL OUTER JOIN loc ON spend.bucket_start = loc.bucket_start AND spend.model = loc.model
			`)

			// Separate statement, not another CTE branch: coverage must count
			// commits with NO session_id, which every join above excludes by
			// construction. No dependency on the query above, so they overlap.
			// Known-human commits are filtered so `total` measures the same
			// population as the page's other denominators.
			const coverageQuery = dbReadReplica.execute(sql`
				SELECT
					${bucketKeySql(sql`committed_at`, bucket, offsetMinutes)} AS bucket_start,
					SUM(additions + deletions) FILTER (WHERE session_id IS NOT NULL)::text AS attributed,
					SUM(additions + deletions)::text AS total
				FROM authored_commits
				WHERE organization_id = ${organizationId}
					AND committed_at >= ${startTimestamp}
					AND committed_at <= ${endTimestamp}
					AND attribution_method IS DISTINCT FROM 'human'
				GROUP BY bucket_start
			`)

			const [rawCellRows, rawCoverageRows] = await Promise.all([cellsQuery, coverageQuery])
			const cellRows = parseCostPerKlocCellRows(rawCellRows)
			const coverageRows = parseCostPerKlocCoverageRows(rawCoverageRows)

			const data = cellRows.map((row) => {
				const costUsd = row.cost_usd ?? 0
				const locChanged = (row.additions ?? 0) + (row.deletions ?? 0)
				const key = bucketKey(row.bucket_start)
				return {
					bucketStart: key,
					inRange: key >= range.startDate,
					model: row.model,
					costUsd,
					locChanged,
					commitCount: row.commit_count ?? 0,
					// Ratio of the two sums. Null only when there is no denominator;
					// a zero numerator stays 0 here and is the client's job to render
					// as a gap (see contract).
					costPerKloc: locChanged > 0 ? costUsd / (locChanged / 1000) : null,
				}
			})

			const coverageByBucket = new Map<string, { attributed: number; total: number }>()
			for (const row of coverageRows) {
				coverageByBucket.set(bucketKey(row.bucket_start), {
					attributed: row.attributed ?? 0,
					total: row.total ?? 0,
				})
			}

			// Dense over the SELECTED range only — coverage is a disclosure about
			// what the card plots, and the lead-in buckets are never plotted.
			const coverage = range.inRangeBucketKeys.map((key) => {
				const { attributed, total } = coverageByBucket.get(key) ?? { attributed: 0, total: 0 }
				return {
					bucketStart: key,
					attributedLocChanged: attributed,
					totalLocChanged: total,
					coverage: total > 0 ? attributed / total : null,
				}
			})

			return { data, coverage, startDate: range.startDate, endDate: range.endDate }
		} catch (error) {
			// Base (apiBaseForAdvancedMetrics) also forwards to Sentry; log with
			// context + a procedure tag here so query failures are triageable.
			logger.error(
				{ error, organizationId, from: input.from, to: input.to, bucket: input.bucket },
				'metrics.costPerKlocByModel query failed',
			)
			Sentry.captureException(error, { tags: { procedure: 'metrics.costPerKlocByModel' } })
			throw error
		}
	},
)
