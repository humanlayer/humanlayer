import * as Sentry from '@sentry/node'
import { type SQL, sql } from 'drizzle-orm'

import { apiBaseOrgRequired } from '../../base'
import { calculateWeekRange, formatDate, getMonday } from './utils'

type WeeklyMetricRow = {
	week_start: string | Date
	user_id: string
	count: string
	total: string
}

type ActiveUsersChartHandlerArgs = Parameters<
	Parameters<typeof apiBaseOrgRequired.metrics.activeUsersSessions.handler>[0]
>[0]

function activeUsersSessionsQuery(
	organizationId: string,
	startTimestamp: bigint,
	endTimestamp: bigint,
	offset: number,
	limit: number,
) {
	return sql`
		WITH weekly AS (
			SELECT
				DATE_TRUNC('week', to_timestamp(created_at / 1000) AT TIME ZONE 'UTC' - INTERVAL '1 minute' * ${offset})::date as week_start,
				created_by as user_id,
				COUNT(*)::bigint as count
			FROM sessions
			WHERE organization_id = ${organizationId}
				AND created_at >= ${startTimestamp}
				AND created_at <= ${endTimestamp}
			GROUP BY week_start, created_by
		), top_users AS (
			SELECT user_id, SUM(count)::bigint as total
			FROM weekly
			GROUP BY user_id
			ORDER BY total DESC, user_id ASC
			LIMIT ${limit}
		)
		SELECT weekly.week_start, weekly.user_id, weekly.count::text, top_users.total::text
		FROM weekly
		JOIN top_users ON top_users.user_id = weekly.user_id
		ORDER BY top_users.total DESC, weekly.user_id ASC, weekly.week_start ASC
	`
}

function activeUsersCommentsQuery(
	organizationId: string,
	startTimestamp: bigint,
	endTimestamp: bigint,
	offset: number,
	limit: number,
) {
	return sql`
		WITH weekly AS (
			SELECT
				DATE_TRUNC('week', to_timestamp(created_at / 1000) AT TIME ZONE 'UTC' - INTERVAL '1 minute' * ${offset})::date as week_start,
				created_by_user_id as user_id,
				COUNT(*)::bigint as count
			FROM artifact_comments
			WHERE organization_id = ${organizationId}
				AND is_deleted = false
				AND created_at >= ${startTimestamp}
				AND created_at <= ${endTimestamp}
			GROUP BY week_start, created_by_user_id
		), top_users AS (
			SELECT user_id, SUM(count)::bigint as total
			FROM weekly
			GROUP BY user_id
			ORDER BY total DESC, user_id ASC
			LIMIT ${limit}
		)
		SELECT weekly.week_start, weekly.user_id, weekly.count::text, top_users.total::text
		FROM weekly
		JOIN top_users ON top_users.user_id = weekly.user_id
		ORDER BY top_users.total DESC, weekly.user_id ASC, weekly.week_start ASC
	`
}

function activeUsersCollaborationOutboundQuery(
	organizationId: string,
	startTimestamp: bigint,
	endTimestamp: bigint,
	offset: number,
	limit: number,
) {
	return sql`
		WITH weekly AS (
			SELECT
				DATE_TRUNC('week', to_timestamp(created_at / 1000) AT TIME ZONE 'UTC' - INTERVAL '1 minute' * ${offset})::date as week_start,
				created_by_user_id as user_id,
				COUNT(*)::bigint as count
			FROM artifact_comments
			WHERE organization_id = ${organizationId}
				AND is_deleted = false
				AND created_by_user_id != resource_owner_user_id
				AND created_at >= ${startTimestamp}
				AND created_at <= ${endTimestamp}
			GROUP BY week_start, created_by_user_id
		), top_users AS (
			SELECT user_id, SUM(count)::bigint as total
			FROM weekly
			GROUP BY user_id
			ORDER BY total DESC, user_id ASC
			LIMIT ${limit}
		)
		SELECT weekly.week_start, weekly.user_id, weekly.count::text, top_users.total::text
		FROM weekly
		JOIN top_users ON top_users.user_id = weekly.user_id
		ORDER BY top_users.total DESC, weekly.user_id ASC, weekly.week_start ASC
	`
}

function activeUsersCollaborationInboundQuery(
	organizationId: string,
	startTimestamp: bigint,
	endTimestamp: bigint,
	offset: number,
	limit: number,
) {
	return sql`
		WITH weekly AS (
			SELECT
				DATE_TRUNC('week', to_timestamp(created_at / 1000) AT TIME ZONE 'UTC' - INTERVAL '1 minute' * ${offset})::date as week_start,
				resource_owner_user_id as user_id,
				COUNT(*)::bigint as count
			FROM artifact_comments
			WHERE organization_id = ${organizationId}
				AND is_deleted = false
				AND created_by_user_id != resource_owner_user_id
				AND created_at >= ${startTimestamp}
				AND created_at <= ${endTimestamp}
			GROUP BY week_start, resource_owner_user_id
		), top_users AS (
			SELECT user_id, SUM(count)::bigint as total
			FROM weekly
			GROUP BY user_id
			ORDER BY total DESC, user_id ASC
			LIMIT ${limit}
		)
		SELECT weekly.week_start, weekly.user_id, weekly.count::text, top_users.total::text
		FROM weekly
		JOIN top_users ON top_users.user_id = weekly.user_id
		ORDER BY top_users.total DESC, weekly.user_id ASC, weekly.week_start ASC
	`
}

async function getActiveUsersChartData({ context, input }: ActiveUsersChartHandlerArgs, query: SQL) {
	const { dbReadReplica, workos } = context.services
	const { workosOrganizationId } = context.auth

	const [metricsResult, workosResult] = await Promise.allSettled([
		dbReadReplica.execute<WeeklyMetricRow>(query),
		workos.userManagement.listUsers({ organizationId: workosOrganizationId }).then((r) => r.autoPagination()),
	])

	if (metricsResult.status === 'rejected') throw metricsResult.reason

	const { startDate, endDate } = calculateWeekRange(input.weeks)
	const startMonday = getMonday(startDate)
	const endMonday = getMonday(endDate)
	const weekStarts: string[] = []
	const weekIndex = new Map<string, number>()
	for (let d = new Date(startMonday); d <= endMonday; d.setDate(d.getDate() + 7)) {
		const weekStr = formatDate(d, 0)
		weekIndex.set(weekStr, weekStarts.length)
		weekStarts.push(weekStr)
	}

	let allWorkosUsers: typeof workosResult extends PromiseSettledResult<infer T> ? T : never
	if (workosResult.status === 'fulfilled') {
		allWorkosUsers = workosResult.value
	} else {
		Sentry.captureException(workosResult.reason)
		allWorkosUsers = []
	}

	const userProfileMap = new Map<string, { displayName: string; profilePictureUrl: string | undefined }>()
	for (const user of allWorkosUsers) {
		const displayName = user.firstName && user.lastName ? `${user.firstName} ${user.lastName}` : user.email
		userProfileMap.set(user.id, { displayName, profilePictureUrl: user.profilePictureUrl ?? undefined })
	}

	const userMap = new Map<string, { values: number[]; total: number }>()
	for (const row of metricsResult.value as WeeklyMetricRow[]) {
		const weekStr = row.week_start instanceof Date ? formatDate(row.week_start, 0) : String(row.week_start)
		const idx = weekIndex.get(weekStr)
		if (idx === undefined) continue
		let entry = userMap.get(row.user_id)
		if (!entry) {
			entry = { values: new Array(weekStarts.length).fill(0), total: Number.parseInt(row.total, 10) }
			userMap.set(row.user_id, entry)
		}
		entry.values[idx] = Number.parseInt(row.count, 10)
	}

	const users = Array.from(userMap.entries()).map(([userId, entry]) => {
		const profile = userProfileMap.get(userId)
		return {
			userId,
			displayName: profile?.displayName ?? 'Unknown User',
			profilePictureUrl: profile?.profilePictureUrl,
			values: entry.values,
			total: entry.total,
		}
	})

	return { generatedAt: new Date().toISOString(), weekStarts, users }
}

export const activeUsersSessionsProcedure = apiBaseOrgRequired.metrics.activeUsersSessions.handler((args) => {
	const offset = args.input.timezoneOffset ?? 0
	const limit = args.input.limit ?? 10
	const { organizationId } = args.context.auth
	const { startTimestamp, endTimestamp } = calculateWeekRange(args.input.weeks)
	return getActiveUsersChartData(
		args,
		activeUsersSessionsQuery(organizationId, startTimestamp, endTimestamp, offset, limit),
	)
})

export const activeUsersCommentsProcedure = apiBaseOrgRequired.metrics.activeUsersComments.handler((args) => {
	const offset = args.input.timezoneOffset ?? 0
	const limit = args.input.limit ?? 10
	const { organizationId } = args.context.auth
	const { startTimestamp, endTimestamp } = calculateWeekRange(args.input.weeks)
	return getActiveUsersChartData(
		args,
		activeUsersCommentsQuery(organizationId, startTimestamp, endTimestamp, offset, limit),
	)
})

export const activeUsersCollaborationOutboundProcedure =
	apiBaseOrgRequired.metrics.activeUsersCollaborationOutbound.handler((args) => {
		const offset = args.input.timezoneOffset ?? 0
		const limit = args.input.limit ?? 10
		const { organizationId } = args.context.auth
		const { startTimestamp, endTimestamp } = calculateWeekRange(args.input.weeks)
		return getActiveUsersChartData(
			args,
			activeUsersCollaborationOutboundQuery(organizationId, startTimestamp, endTimestamp, offset, limit),
		)
	})

export const activeUsersCollaborationInboundProcedure =
	apiBaseOrgRequired.metrics.activeUsersCollaborationInbound.handler((args) => {
		const offset = args.input.timezoneOffset ?? 0
		const limit = args.input.limit ?? 10
		const { organizationId } = args.context.auth
		const { startTimestamp, endTimestamp } = calculateWeekRange(args.input.weeks)
		return getActiveUsersChartData(
			args,
			activeUsersCollaborationInboundQuery(organizationId, startTimestamp, endTimestamp, offset, limit),
		)
	})
