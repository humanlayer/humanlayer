import { NO_STAGE_KEY } from '@humanlayer/riptide-api-contract/api/metrics/stageSpendTrend'
import * as Sentry from '@sentry/node'
import { sql } from 'drizzle-orm'

import { mostProgressedStageSql } from '../../../effects/services/metrics/stage-attribution'
import { logger } from '../../../logger'
import { apiBaseForAdvancedMetrics } from '../../base'
import { bucketKey, bucketKeySql, resolveMetricsRange } from './utils'

/**
 * Token spend split by RPI workflow stage, one row per bucket. Same shape and
 * bucket keys as modelSpendTrend; the stage comes from `sessions.labels` (appended
 * server-side from the literal Skill tool call — see
 * daemon/sessions/events/create.ts), so this is measured attribution with no
 * modelled split. Spend on sessions with no RPI label lands under the
 * `no_stage` sentinel instead of silently disappearing.
 *
 * The label unnest runs once per session with usage in the range (the
 * `session_stage` CTE), not per usage row. Served by the existing
 * (organization_id, occurred_at) index prefix — no new index.
 *
 * Sparse (bucket, stage) rows; the client pivots, densifies, and applies its
 * own top-N fold.
 *
 * Access: plan entitlement + the page's audience, both enforced by
 * apiBaseForAdvancedMetrics.
 */
export const stageSpendTrendProcedure = apiBaseForAdvancedMetrics.metrics.stageSpendTrend.handler(
	async ({ context, input }) => {
		const { dbReadReplica } = context.services
		const { organizationId } = context.auth

		try {
			const { startTimestamp, endTimestamp, bucket, offsetMinutes, startDate, endDate } =
				resolveMetricsRange(input)

			const rows = await dbReadReplica.execute<{
				bucket_start: string | Date
				stage: string
				cost_usd: number | null
			}>(sql`
				WITH usage_rows AS (
					SELECT
						session_id,
						${bucketKeySql(sql`occurred_at`, bucket, offsetMinutes)} AS bucket_start,
						cost_usd
					FROM session_usage_events
					WHERE organization_id = ${organizationId}
						AND occurred_at >= ${startTimestamp}
						AND occurred_at <= ${endTimestamp}
				),
				session_stage AS (
					SELECT s.id, ${mostProgressedStageSql()} AS stage
					FROM sessions s
					WHERE s.id IN (SELECT DISTINCT session_id FROM usage_rows)
				)
				SELECT
					u.bucket_start,
					COALESCE(ss.stage, ${NO_STAGE_KEY}) AS stage,
					SUM(u.cost_usd) AS cost_usd
				FROM usage_rows u
				JOIN session_stage ss ON ss.id = u.session_id
				GROUP BY 1, 2
			`)

			const data = (rows as Array<Record<string, unknown>>).map((row) => ({
				bucketStart: bucketKey(row.bucket_start as string | Date),
				stage: String(row.stage),
				costUsd: row.cost_usd === null || row.cost_usd === undefined ? 0 : Number(row.cost_usd),
			}))

			return { data, startDate, endDate }
		} catch (error) {
			// Base (apiBaseForAdvancedMetrics) also forwards to Sentry; log with
			// context + a procedure tag here so query failures are triageable.
			logger.error(
				{ error, organizationId, from: input.from, to: input.to, bucket: input.bucket },
				'metrics.stageSpendTrend query failed',
			)
			Sentry.captureException(error, { tags: { procedure: 'metrics.stageSpendTrend' } })
			throw error
		}
	},
)
