import { sql } from 'drizzle-orm'
import { Effect } from 'effect'

import { mapPostgresErrorToResponse } from '../../../effects/services/postgres/error-mapping'
import { PostgresReadReplicaDb } from '../../../effects/services/postgres/postgres-read-replica.service'
import { Sentry } from '../../../instrument'
import { effectOrpcBaseOrganizationRequired } from '../../effect-base'
import { calculateDateRange, formatDate } from './utils'

export const usageTrendEffectProcedure = effectOrpcBaseOrganizationRequired.metrics.usageTrend.effect(function* ({
	context,
	input,
	errors,
}) {
	const postgres = yield* PostgresReadReplicaDb
	const { organizationId } = context.auth
	const offset = input.timezoneOffset ?? 0

	const { startDate, endDate, startTimestamp, endTimestamp } = calculateDateRange(input.range)

	// Query session and message counts per day in a single query
	const results = yield* postgres
		.query(
			postgres.client.execute<{
				date: string
				sessions: string
				messages: string
			}>(sql`
				SELECT
					DATE(to_timestamp(created_at / 1000) AT TIME ZONE 'UTC' - INTERVAL '1 minute' * ${offset}) as date,
					COUNT(*)::text as sessions,
					COALESCE(SUM(num_events), 0)::text as messages
				FROM sessions
				WHERE organization_id = ${organizationId}
					AND created_at >= ${startTimestamp}
					AND created_at <= ${endTimestamp}
				GROUP BY date
				ORDER BY date
			`),
		)
		.pipe(
			Effect.tap(() =>
				Effect.logInfo('Usage trend query completed').pipe(
					Effect.annotateLogs({ organizationId, range: input.range, offset }),
				),
			),
			Effect.tapError((e) => Effect.logError(e)),
			Effect.tapError((e) => Effect.sync(() => Sentry.captureException(e))),
			Effect.catchTags({
				PostgresDbQueryError: (error) => mapPostgresErrorToResponse(error, errors),
			}),
		)

	// Create a map from results for O(1) lookup
	const resultMap = new Map<
		string,
		{
			sessions: number
			messages: number
		}
	>(
		(results as Array<{ date: string | Date; sessions: string; messages: string }>).map((row) => {
			const dateStr = row.date instanceof Date ? formatDate(row.date, 0) : String(row.date)
			return [
				dateStr,
				{
					sessions: Number.parseInt(row.sessions, 10),
					messages: Number.parseInt(row.messages, 10),
				},
			]
		}),
	)

	// Generate all dates in the range, filling in 0 for missing dates
	const data: Array<{ date: string; sessions: number; messages: number }> = []
	for (let d = new Date(startDate); d <= endDate; d.setUTCDate(d.getUTCDate() + 1)) {
		const dateStr = formatDate(d, offset)
		const counts = resultMap.get(dateStr) ?? { sessions: 0, messages: 0 }

		data.push({
			date: dateStr,
			sessions: counts.sessions,
			messages: counts.messages,
		})
	}

	return {
		data,
		startDate: formatDate(startDate, offset),
		endDate: formatDate(endDate, offset),
	}
})
