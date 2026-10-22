import { sql } from 'drizzle-orm'

import { apiBaseOrgRequired } from '../../base'
import { calculateDateRange, formatDate, getIsWeekend } from './utils'

export const sessionsPerDayProcedure = apiBaseOrgRequired.metrics.sessionsPerDay.handler(async ({ context, input }) => {
	const { dbReadReplica } = context.services
	const { organizationId } = context.auth
	const offset = input.timezoneOffset ?? 0

	const { startDate, endDate, startTimestamp, endTimestamp } = calculateDateRange(input.range)

	// Query session counts per day
	const results = await dbReadReplica.execute<{
		date: string
		sessions: string
	}>(sql`
			SELECT
				DATE(to_timestamp(created_at / 1000) AT TIME ZONE 'UTC' - INTERVAL '1 minute' * ${offset}) as date,
				COUNT(*)::text as sessions
			FROM sessions
			WHERE organization_id = ${organizationId}
				AND created_at >= ${startTimestamp}
				AND created_at <= ${endTimestamp}
			GROUP BY date
			ORDER BY date
		`)

	// Create a map from results for O(1) lookup
	const resultMap = new Map<string, number>(
		(results as Array<{ date: string | Date; sessions: string }>).map((row) => {
			const dateStr = row.date instanceof Date ? formatDate(row.date, 0) : String(row.date)
			return [dateStr, Number.parseInt(row.sessions, 10)]
		}),
	)

	// Generate all dates in the range, filling in 0 for missing dates
	const data: Array<{ date: string; sessions: number; isWeekend: boolean }> = []
	let total = 0
	for (let d = new Date(startDate); d <= endDate; d.setUTCDate(d.getUTCDate() + 1)) {
		const dateStr = formatDate(d, offset)
		const isWeekend = getIsWeekend(d, offset)
		const sessionCount = resultMap.get(dateStr) ?? 0
		total += sessionCount

		data.push({
			date: dateStr,
			sessions: sessionCount,
			isWeekend,
		})
	}

	return {
		data,
		total,
		startDate: formatDate(startDate, offset),
		endDate: formatDate(endDate, offset),
	}
})
