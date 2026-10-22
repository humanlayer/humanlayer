import { sql } from 'drizzle-orm'

import { apiBaseOrgRequired } from '../../base'
import { calculateWeekRange, formatDate, getMonday } from './utils'

export const sessionsPerWeekProcedure = apiBaseOrgRequired.metrics.sessionsPerWeek.handler(
	async ({ context, input }) => {
		const { dbReadReplica } = context.services
		const { organizationId } = context.auth
		const offset = input.timezoneOffset ?? 0

		const { startDate, endDate, startTimestamp, endTimestamp } = calculateWeekRange(input.weeks)

		// Count sessions per Monday-anchored week (no DISTINCT, sessions-only)
		const results = await dbReadReplica.execute<{
			week_start: string
			sessions: string
		}>(sql`
			SELECT
				DATE_TRUNC('week', to_timestamp(created_at / 1000) AT TIME ZONE 'UTC' - INTERVAL '1 minute' * ${offset})::date as week_start,
				COUNT(*)::text as sessions
			FROM sessions
			WHERE organization_id = ${organizationId}
				AND created_at >= ${startTimestamp}
				AND created_at <= ${endTimestamp}
			GROUP BY week_start
			ORDER BY week_start
		`)

		// Create a map from query results keyed by week_start for O(1) lookup
		const resultMap = new Map<string, number>(
			(results as Array<{ week_start: string | Date; sessions: string }>).map((row) => [
				row.week_start instanceof Date ? formatDate(row.week_start, 0) : String(row.week_start),
				Number.parseInt(row.sessions, 10),
			]),
		)

		// Generate all weeks in the range, filling in 0 for missing weeks
		const data: Array<{ weekStart: string; sessions: number }> = []
		const startMonday = getMonday(startDate)
		const endMonday = getMonday(endDate)

		for (let d = new Date(startMonday); d <= endMonday; d.setDate(d.getDate() + 7)) {
			const weekStr = formatDate(d, 0)
			data.push({
				weekStart: weekStr,
				sessions: resultMap.get(weekStr) ?? 0,
			})
		}

		const total = data.reduce((sum, d) => sum + d.sessions, 0)

		return {
			data,
			total,
			startDate: formatDate(startMonday, 0),
			endDate: formatDate(endMonday, 0),
		}
	},
)
