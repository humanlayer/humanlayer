import { PULL_REQUEST_COUNTED_TIERS } from '@humanlayer/git-attribution'
import * as Sentry from '@sentry/node'
import { sql } from 'drizzle-orm'

import { logger } from '../../../logger'
import { apiBaseForAdvancedMetrics } from '../../base'
import { bucketKey, bucketKeySql, RATIO_LEAD_IN, resolveMetricsRange } from './utils'

/**
 * Per-bucket spend plus all three unit-cost denominators (LOC changed,
 * commits, merged PRs) in one response — the client divides by whichever
 * denominator the page's lens has selected.
 *
 * Three independent grouped queries — spend from `session_usage_events`
 * (bucketed on occurred_at), changed lines + commit counts from `authored_commits`
 * (committed_at), merged PRs from `pull_requests` (merged_at) — merged in JS
 * on the bucket key. They share no data dependency, so they run concurrently
 * and the request costs one round-trip of wall clock rather than three.
 *
 * No ratio is computed here (see the contract): the client divides Σcost by
 * the Σdenominator AFTER summing — never a mean of per-user or per-commit
 * ratios, which is a different quantity that on real data reads ~150x too
 * high. The UI's `computeKpiTotals` derives the KPI cards the same way; the
 * two must agree.
 *
 * The bucket size comes from the request and the range arrives bucket-aligned,
 * so this handler never has to anchor or snap anything. In DAILY mode it reads
 * {@link RATIO_LEAD_IN} extra buckets before `from` and marks them
 * `inRange: false`: the client plots a 7-day trailing ratio, whose first
 * plotted day needs the six days before it. Reading them here rather than
 * having the client widen its own request keeps one payload self-describing.
 *
 * Counting rules match the usersScatter aggregates the KPI cards sum over, so
 * each card and its trend describe the same population:
 * - commits: everything EXCEPT known-human commits (attribution_method IS
 *   DISTINCT FROM 'human') — the spend numerator only ever contains agent
 *   spend, so human lines in the denominator would make the ratio
 *   incommensurable. Legacy NULL rows ("unknown") stay.
 * - PRs: state = 'merged', non-bot, with a resource owner (scatter groups by
 *   owner, so ownerless PRs never reach the cards either) and an attribution
 *   tier of committed: a session committed to the head branch. A branch a
 *   session merely had checked out (observed) and a PR no session touched
 *   (null) stay out of the denominator.
 *
 * Access: plan entitlement + the page's audience, both enforced by
 * apiBaseForAdvancedMetrics.
 */
export const unitCostTrendProcedure = apiBaseForAdvancedMetrics.metrics.unitCostTrend.handler(
	async ({ context, input }) => {
		const { dbReadReplica } = context.services
		const { organizationId } = context.auth

		try {
			const range = resolveMetricsRange(input, RATIO_LEAD_IN)
			const { startTimestamp, endTimestamp, bucket, offsetMinutes } = range

			// Identical bucket expression on all three tables so the result sets
			// share a key space — built once in bucketKeySql, not copied per query.
			const spendQuery = dbReadReplica.execute<{
				bucket_start: string | Date
				cost_usd: number | null
			}>(sql`
				SELECT
					${bucketKeySql(sql`occurred_at`, bucket, offsetMinutes)} AS bucket_start,
					SUM(cost_usd) AS cost_usd
				FROM session_usage_events
				WHERE organization_id = ${organizationId}
					AND occurred_at >= ${startTimestamp}
					AND occurred_at <= ${endTimestamp}
				GROUP BY bucket_start
			`)

			// Same human-commit exclusion as usersScatter (see the rationale
			// there): the numerator is agent-only spend, so known-human lines in
			// the denominator would understate unit cost — and would drift the
			// TREND downward as the phantom-hook work captures more human
			// commits over time, faking an efficiency gain. NULL (unattributed
			// legacy) rows stay.
			const locQuery = dbReadReplica.execute<{
				bucket_start: string | Date
				additions: string
				deletions: string
				commit_count: string
			}>(sql`
				SELECT
					${bucketKeySql(sql`committed_at`, bucket, offsetMinutes)} AS bucket_start,
					SUM(additions)::text AS additions,
					SUM(deletions)::text AS deletions,
					COUNT(*)::text AS commit_count
				FROM authored_commits
				WHERE organization_id = ${organizationId}
					AND committed_at >= ${startTimestamp}
					AND committed_at <= ${endTimestamp}
					AND attribution_method IS DISTINCT FROM 'human'
				GROUP BY bucket_start
			`)

			const prQuery = dbReadReplica.execute<{
				bucket_start: string | Date
				pr_count: string
			}>(sql`
				SELECT
					${bucketKeySql(sql`merged_at`, bucket, offsetMinutes)} AS bucket_start,
					COUNT(*)::text AS pr_count
				FROM pull_requests
				WHERE organization_id = ${organizationId}
					AND state = 'merged'
					AND author_is_bot = false
					AND resource_owner_user_id IS NOT NULL
					AND attribution_method IN ${[...PULL_REQUEST_COUNTED_TIERS]}
					AND merged_at >= ${startTimestamp}
					AND merged_at <= ${endTimestamp}
				GROUP BY bucket_start
			`)

			const [spendRows, locRows, prRows] = await Promise.all([spendQuery, locQuery, prQuery])

			const spendByBucket = new Map<string, number>()
			for (const row of spendRows as Array<Record<string, unknown>>) {
				const cost = row.cost_usd === null || row.cost_usd === undefined ? 0 : Number(row.cost_usd)
				spendByBucket.set(bucketKey(row.bucket_start as string | Date), cost)
			}

			const locByBucket = new Map<string, { locChanged: number; commitCount: number }>()
			for (const row of locRows as Array<Record<string, unknown>>) {
				locByBucket.set(bucketKey(row.bucket_start as string | Date), {
					locChanged: Number.parseInt(String(row.additions), 10) + Number.parseInt(String(row.deletions), 10),
					commitCount: Number.parseInt(String(row.commit_count), 10),
				})
			}

			const prsByBucket = new Map<string, number>()
			for (const row of prRows as Array<Record<string, unknown>>) {
				prsByBucket.set(bucketKey(row.bucket_start as string | Date), Number.parseInt(String(row.pr_count), 10))
			}

			// Dense over every bucket in the window (lead-in included), so a bucket
			// with no activity is an explicit zero row rather than a silently
			// missing x-value — and so the client's trailing window sees a
			// continuous series instead of inferring gaps as breaks.
			const data = range.bucketKeys.map((key) => {
				const { locChanged, commitCount } = locByBucket.get(key) ?? { locChanged: 0, commitCount: 0 }
				return {
					bucketStart: key,
					inRange: key >= range.startDate,
					costUsd: spendByBucket.get(key) ?? 0,
					locChanged,
					commitCount,
					prsMerged: prsByBucket.get(key) ?? 0,
				}
			})

			return { data, startDate: range.startDate, endDate: range.endDate }
		} catch (error) {
			// Base (apiBaseForAdvancedMetrics) also forwards to Sentry; log with
			// context + a procedure tag here so query failures are triageable.
			logger.error(
				{ error, organizationId, from: input.from, to: input.to, bucket: input.bucket },
				'metrics.unitCostTrend query failed',
			)
			Sentry.captureException(error, { tags: { procedure: 'metrics.unitCostTrend' } })
			throw error
		}
	},
)
