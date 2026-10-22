import * as Sentry from '@sentry/node'
import { sql } from 'drizzle-orm'

import { logger } from '../../../logger'
import { apiBaseForAdvancedMetrics } from '../../base'
import { calculateDateRange, formatDate } from './utils'

/**
 * Token usage + cost per model over time, from the append-only
 * session_usage_events table. Buckets on occurred_at (event time).
 * Sparse rows — no zero-fill; clients pivot (see contract).
 *
 * Access: plan entitlement + the page's audience, both enforced by
 * apiBaseForAdvancedMetrics.
 */
export const usageByModelProcedure = apiBaseForAdvancedMetrics.metrics.usageByModel.handler(
	async ({ context, input }) => {
		const { dbReadReplica } = context.services
		const { organizationId } = context.auth
		const offset = input.timezoneOffset ?? 0

		try {
			const { startDate, endDate, startTimestamp, endTimestamp } = calculateDateRange(input.range)

			const bucketExpr =
				input.bucket === 'hour'
					? sql`to_char(date_trunc('hour', to_timestamp(occurred_at / 1000) AT TIME ZONE 'UTC' - INTERVAL '1 minute' * ${offset}), 'YYYY-MM-DD"T"HH24:00')`
					: sql`DATE(to_timestamp(occurred_at / 1000) AT TIME ZONE 'UTC' - INTERVAL '1 minute' * ${offset})::text`

			const results = await dbReadReplica.execute<{
				bucket: string
				model: string
				input_tokens: string
				output_tokens: string
				cache_read_tokens: string
				cache_creation_tokens: string
				cost_usd: number | null
			}>(sql`
				SELECT
					${bucketExpr} AS bucket,
					model,
					SUM(input_tokens)::text AS input_tokens,
					SUM(output_tokens)::text AS output_tokens,
					SUM(cache_read_tokens)::text AS cache_read_tokens,
					SUM(cache_creation_tokens)::text AS cache_creation_tokens,
					SUM(cost_usd) AS cost_usd
				FROM session_usage_events
				WHERE organization_id = ${organizationId}
					AND occurred_at >= ${startTimestamp}
					AND occurred_at <= ${endTimestamp}
					${input.userId ? sql`AND session_creator_user_id = ${input.userId}` : sql``}
				GROUP BY 1, 2
				ORDER BY 1, 2
			`)

			const data = (results as Array<Record<string, unknown>>).map((row) => ({
				bucket: String(row.bucket),
				model: String(row.model),
				inputTokens: Number.parseInt(String(row.input_tokens), 10),
				outputTokens: Number.parseInt(String(row.output_tokens), 10),
				cacheReadTokens: Number.parseInt(String(row.cache_read_tokens), 10),
				cacheCreationTokens: Number.parseInt(String(row.cache_creation_tokens), 10),
				costUsd: row.cost_usd === null || row.cost_usd === undefined ? null : Number(row.cost_usd),
			}))

			return {
				data,
				startDate: formatDate(startDate, offset),
				endDate: formatDate(endDate, offset),
			}
		} catch (error) {
			// Base (apiBaseForAdvancedMetrics) also forwards to Sentry; log with
			// context + a procedure tag here so query failures are triageable.
			logger.error({ error, organizationId, range: input.range }, 'metrics.usageByModel query failed')
			Sentry.captureException(error, { tags: { procedure: 'metrics.usageByModel' } })
			throw error
		}
	},
)
