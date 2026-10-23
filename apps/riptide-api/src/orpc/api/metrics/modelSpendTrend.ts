import * as Sentry from '@sentry/node'
import { sql } from 'drizzle-orm'

import { logger } from '../../../logger'
import { apiBaseForAdvancedMetrics } from '../../base'
import { bucketKey, bucketKeySql, resolveMetricsRange } from './utils'

/**
 * Token spend split by model, one row per bucket. One grouped query over
 * `session_usage_events` — each usage row carries its own `model`, so every
 * dollar lands under the model that actually billed it, with none of the
 * session-dominance attribution that costPerKlocByModel needs for its
 * ratios. Served by the existing (organization_id, …, occurred_at) index
 * prefix — no new index.
 *
 * Sparse (bucket, model) rows; the client pivots, densifies, and applies its
 * own top-N fold. Bucket keys follow the request and match unitCostTrend, so
 * every card on the page shares one x-axis.
 *
 * Access: plan entitlement + the page's audience, both enforced by
 * apiBaseForAdvancedMetrics.
 */
export const modelSpendTrendProcedure = apiBaseForAdvancedMetrics.metrics.modelSpendTrend.handler(
	async ({ context, input }) => {
		const { dbReadReplica } = context.services
		const { organizationId } = context.auth

		try {
			const { startTimestamp, endTimestamp, bucket, offsetMinutes, startDate, endDate } =
				resolveMetricsRange(input)

			const rows = await dbReadReplica.execute<{
				bucket_start: string | Date
				model: string
				cost_usd: number | null
			}>(sql`
				SELECT
					${bucketKeySql(sql`occurred_at`, bucket, offsetMinutes)} AS bucket_start,
					model,
					SUM(cost_usd) AS cost_usd
				FROM session_usage_events
				WHERE organization_id = ${organizationId}
					AND occurred_at >= ${startTimestamp}
					AND occurred_at <= ${endTimestamp}
				GROUP BY 1, 2
			`)

			const data = (rows as Array<Record<string, unknown>>).map((row) => ({
				bucketStart: bucketKey(row.bucket_start as string | Date),
				model: String(row.model),
				costUsd: row.cost_usd === null || row.cost_usd === undefined ? 0 : Number(row.cost_usd),
			}))

			return { data, startDate, endDate }
		} catch (error) {
			// Base (apiBaseForAdvancedMetrics) also forwards to Sentry; log with
			// context + a procedure tag here so query failures are triageable.
			logger.error(
				{ error, organizationId, from: input.from, to: input.to, bucket: input.bucket },
				'metrics.modelSpendTrend query failed',
			)
			Sentry.captureException(error, { tags: { procedure: 'metrics.modelSpendTrend' } })
			throw error
		}
	},
)
