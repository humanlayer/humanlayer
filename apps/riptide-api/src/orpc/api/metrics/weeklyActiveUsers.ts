import { sql } from 'drizzle-orm'

import { apiBaseOrgRequired } from '../../base'
import { calculateWeekRange, formatDate, getMonday } from './utils'

export const weeklyActiveUsersProcedure = apiBaseOrgRequired.metrics.weeklyActiveUsers.handler(
	async ({ context, input }) => {
		const { dbReadReplica } = context.services
		const { organizationId } = context.auth
		const offset = input.timezoneOffset ?? 0

		const { startDate, endDate, startTimestamp, endTimestamp } = calculateWeekRange(input.weeks)

		// Use a single query with UNION ALL to combine sessions and tasks, grouped by week
		const results = await dbReadReplica.execute<{
			week_start: string
			users: string
		}>(sql`
			SELECT
				week_start,
				COUNT(DISTINCT user_id)::text as users
			FROM (
				SELECT
					DATE_TRUNC('week', to_timestamp(created_at / 1000) AT TIME ZONE 'UTC' - INTERVAL '1 minute' * ${offset})::date as week_start,
					resource_owner_user_id as user_id
				FROM sessions
				WHERE organization_id = ${organizationId}
					AND created_at >= ${startTimestamp}
					AND created_at <= ${endTimestamp}
				UNION ALL
				SELECT
					DATE_TRUNC('week', to_timestamp(created_at / 1000) AT TIME ZONE 'UTC' - INTERVAL '1 minute' * ${offset})::date as week_start,
					resource_owner_user_id as user_id
				FROM tasks
				WHERE organization_id = ${organizationId}
					AND created_at >= ${startTimestamp}
					AND created_at <= ${endTimestamp}
			) combined
			GROUP BY week_start
			ORDER BY week_start
		`)

		// Create a map from query results keyed by week_start for O(1) lookup
		const resultMap = new Map<string, number>(
			(results as Array<{ week_start: string | Date; users: string }>).map((row) => [
				row.week_start instanceof Date ? formatDate(row.week_start, 0) : String(row.week_start),
				Number.parseInt(row.users, 10),
			]),
		)

		// Generate all weeks in the range, filling in 0 for missing weeks
		const data: Array<{ weekStart: string; users: number }> = []
		const startMonday = getMonday(startDate)
		const endMonday = getMonday(endDate)

		for (let d = new Date(startMonday); d <= endMonday; d.setDate(d.getDate() + 7)) {
			const weekStr = formatDate(d, 0)
			data.push({
				weekStart: weekStr,
				users: resultMap.get(weekStr) ?? 0,
			})
		}

		const averageWeekly = data.length > 0 ? Math.round(data.reduce((sum, d) => sum + d.users, 0) / data.length) : 0

		return {
			data,
			averageWeekly,
			startDate: formatDate(startMonday, 0),
			endDate: formatDate(endMonday, 0),
		}
	},
)
