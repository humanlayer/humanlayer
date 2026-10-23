import * as Sentry from '@sentry/node'
import { sql } from 'drizzle-orm'

import { logger } from '../../../logger'
import { apiBaseForAdvancedMetrics } from '../../base'
import { bucketKey, bucketKeySql, resolveMetricsRange } from './utils'

/**
 * Token spend split by workflow mode, one row per bucket. Same shape and
 * bucket keys as stageSpendTrend, so the two cards decompose one total two
 * ways.
 *
 * Mode comes from the session's task (`tasks.workflow_type`, a stored
 * column); usage on task-less sessions counts as 'freeform'. The join goes
 * through `sessions` rather than the denormalized `session_usage_events.task_id`
 * so a session reassigned to another task reports its CURRENT task's mode,
 * matching what the task page shows. No label unnest is needed here — this
 * card has no stage dimension.
 *
 * Sparse (bucket, mode) rows; the client pivots and densifies.
 *
 * Access: plan entitlement + the page's audience, both enforced by
 * apiBaseForAdvancedMetrics.
 */
export const modeSpendTrendProcedure = apiBaseForAdvancedMetrics.metrics.modeSpendTrend.handler(
	async ({ context, input }) => {
		const { dbReadReplica } = context.services
		const { organizationId } = context.auth

		try {
			const { startTimestamp, endTimestamp, bucket, offsetMinutes, startDate, endDate } =
				resolveMetricsRange(input)

			const rows = await dbReadReplica.execute<{
				bucket_start: string | Date
				mode: string
				cost_usd: number | null
			}>(sql`
				SELECT
					${bucketKeySql(sql`sue.occurred_at`, bucket, offsetMinutes)} AS bucket_start,
					COALESCE(t.workflow_type, 'freeform') AS mode,
					SUM(sue.cost_usd) AS cost_usd
				FROM session_usage_events sue
				JOIN sessions s ON s.id = sue.session_id
				LEFT JOIN tasks t ON t.id = s.task_id
				WHERE sue.organization_id = ${organizationId}
					AND sue.occurred_at >= ${startTimestamp}
					AND sue.occurred_at <= ${endTimestamp}
				GROUP BY 1, 2
			`)

			const data = (rows as Array<Record<string, unknown>>).map((row) => ({
				bucketStart: bucketKey(row.bucket_start as string | Date),
				mode: String(row.mode),
				costUsd: row.cost_usd === null || row.cost_usd === undefined ? 0 : Number(row.cost_usd),
			}))

			return { data, startDate, endDate }
		} catch (error) {
			// Base (apiBaseForAdvancedMetrics) also forwards to Sentry; log with
			// context + a procedure tag here so query failures are triageable.
			logger.error(
				{ error, organizationId, from: input.from, to: input.to, bucket: input.bucket },
				'metrics.modeSpendTrend query failed',
			)
			Sentry.captureException(error, { tags: { procedure: 'metrics.modeSpendTrend' } })
			throw error
		}
	},
)
