import { sql } from 'drizzle-orm'

import { apiBaseOrgRequired } from '../../base'
import { calculateDateRange, formatDate, getIsWeekend } from './utils'

export const dailyActiveUsersProcedure = apiBaseOrgRequired.metrics.dailyActiveUsers.handler(
	async ({ context, input }) => {
		const { dbReadReplica } = context.services
		const { organizationId } = context.auth
		const offset = input.timezoneOffset ?? 0

		const { startDate, endDate, startTimestamp, endTimestamp } = calculateDateRange(input.range)

		// Use a single query with UNION ALL to combine sessions and tasks
		const results = await dbReadReplica.execute<{
			date: string
			users: string
		}>(sql`
			SELECT
				date,
				COUNT(DISTINCT user_id)::text as users
			FROM (
				SELECT
					DATE(to_timestamp(created_at / 1000) AT TIME ZONE 'UTC' - INTERVAL '1 minute' * ${offset}) as date,
					resource_owner_user_id as user_id
				FROM sessions
				WHERE organization_id = ${organizationId}
					AND created_at >= ${startTimestamp}
					AND created_at <= ${endTimestamp}
				UNION ALL
				SELECT
					DATE(to_timestamp(created_at / 1000) AT TIME ZONE 'UTC' - INTERVAL '1 minute' * ${offset}) as date,
					resource_owner_user_id as user_id
				FROM tasks
				WHERE organization_id = ${organizationId}
					AND created_at >= ${startTimestamp}
					AND created_at <= ${endTimestamp}
			) combined
			GROUP BY date
			ORDER BY date
		`)

		// Create a map from results for O(1) lookup
		const resultMap = new Map<string, number>(
			(results as Array<{ date: string | Date; users: string }>).map((row) => {
				const dateStr = row.date instanceof Date ? formatDate(row.date, 0) : String(row.date)
				return [dateStr, Number.parseInt(row.users, 10)]
			}),
		)

		// Generate all dates in the range, filling in 0 for missing dates
		const data: Array<{ date: string; users: number; isWeekend: boolean }> = []
		for (let d = new Date(startDate); d <= endDate; d.setUTCDate(d.getUTCDate() + 1)) {
			const dateStr = formatDate(d, offset)
			const isWeekend = getIsWeekend(d, offset)

			data.push({
				date: dateStr,
				users: resultMap.get(dateStr) ?? 0,
				isWeekend,
			})
		}

		// Calculate average for weekdays only
		const weekdayData = data.filter((d) => !d.isWeekend)
		const averageWeekday =
			weekdayData.length > 0
				? Math.round(weekdayData.reduce((sum, d) => sum + d.users, 0) / weekdayData.length)
				: 0

		return {
			data,
			averageWeekday,
			startDate: formatDate(startDate, offset),
			endDate: formatDate(endDate, offset),
		}
	},
)
