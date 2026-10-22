import { enumerateBuckets } from '@humanlayer/riptide-api-contract/api/metrics/range'
import * as Sentry from '@sentry/node'
import { sql } from 'drizzle-orm'

import { logger } from '../../../logger'
import { apiBaseForAdvancedMetrics } from '../../base'
import { bucketKey, bucketKeySql, resolveHistoryWindow } from './utils'

/**
 * The range brush's data: daily spend over the last {@link RANGE_HISTORY_DAYS}
 * days, plus the boundaries that decide where the handles may go.
 *
 * Range-independent on purpose — see the contract. The strip is how a user
 * FINDS the range worth selecting, so it must show what lies outside the
 * current selection, and it must not refetch while a handle is being dragged.
 * Its only input is the caller's timezone offset.
 *
 * Two queries, no data dependency, so they overlap:
 *
 *  - daily spend, bucketed with the same client-local expression every other
 *    card uses (`bucketKeySql`), so a bar on the strip and a bar on a daily
 *    chart cover the identical span of real time;
 *  - the org's first attributed commit, unbounded by any window — it is the
 *    coverage floor the left handle refuses to cross, and an org that opted in
 *    a year ago must still get a date rather than a null just because the
 *    strip only reaches back 26 weeks.
 *
 * Access: plan entitlement + the page's audience, both enforced by
 * apiBaseForAdvancedMetrics.
 */
export const rangeOverviewProcedure = apiBaseForAdvancedMetrics.metrics.rangeOverview.handler(
	async ({ context, input }) => {
		const { dbReadReplica } = context.services
		const { organizationId } = context.auth
		const offsetMinutes = input.timezoneOffset ?? 0

		try {
			const { earliestDate, latestDate, startTimestamp, endTimestamp } = resolveHistoryWindow(offsetMinutes)

			const spendQuery = dbReadReplica.execute<{
				bucket_start: string | Date
				cost_usd: number | null
			}>(sql`
				SELECT
					${bucketKeySql(sql`occurred_at`, 'day', offsetMinutes)} AS bucket_start,
					SUM(cost_usd) AS cost_usd
				FROM session_usage_events
				WHERE organization_id = ${organizationId}
					AND occurred_at >= ${startTimestamp}
					AND occurred_at <= ${endTimestamp}
				GROUP BY bucket_start
			`)

			// Deliberately unbounded by the strip window: this is a property of the
			// org, not of the view. An index-only probe on
			// commits_org_owner_committed_idx (org leftmost, committed_at reachable
			// by skip scan).
			//
			// Reads `authored_commits`, like every other denominator on the page: a
			// merge commit is not authored output, and dating the floor from one
			// would open the gate earlier than the first row any chart can plot.
			// Same human exclusion too — a commit we KNOW a person wrote is not
			// attributed output and must not date the boundary.
			const attributionStartQuery = dbReadReplica.execute<{ started_on: string | Date | null }>(sql`
				SELECT ${bucketKeySql(sql`MIN(committed_at)`, 'day', offsetMinutes)} AS started_on
				FROM authored_commits
				WHERE organization_id = ${organizationId}
					AND attribution_method IS DISTINCT FROM 'human'
			`)

			const [spendRows, attributionRows] = await Promise.all([spendQuery, attributionStartQuery])

			const spendByDay = new Map<string, number>()
			for (const row of spendRows as Array<Record<string, unknown>>) {
				const cost = row.cost_usd === null || row.cost_usd === undefined ? 0 : Number(row.cost_usd)
				spendByDay.set(bucketKey(row.bucket_start as string | Date), cost)
			}

			const startedOn = (attributionRows as Array<Record<string, unknown>>)[0]?.started_on
			const attributionStartDate =
				startedOn === null || startedOn === undefined ? null : bucketKey(startedOn as string | Date)

			// Dense: a quiet day is an explicit zero bar. A missing day would
			// compress the strip's time axis and put every handle a day out.
			const days = enumerateBuckets(earliestDate, latestDate, 'day').map((date) => ({
				date,
				costUsd: spendByDay.get(date) ?? 0,
			}))

			return { days, earliestDate, latestDate, attributionStartDate }
		} catch (error) {
			// Base (apiBaseForAdvancedMetrics) also forwards to Sentry; log with
			// context + a procedure tag here so query failures are triageable.
			logger.error({ error, organizationId }, 'metrics.rangeOverview query failed')
			Sentry.captureException(error, { tags: { procedure: 'metrics.rangeOverview' } })
			throw error
		}
	},
)
