import { tasks } from '@humanlayer/db/tables/tasks'
import * as Sentry from '@sentry/node'
import { and, getTableColumns } from 'drizzle-orm'

import { buildDaemonTasksSyncWhere } from '../../../db/sync-auth'
import { buildDrizzleOrderFromSorts, buildDrizzleWhereFromExpression, SyncFilterError } from '../../../db/sync-filters'
import { daemonBase } from '../../base'

/**
 * Daemon tasks sync handler.
 *
 * Returns all tasks visible to the authenticated daemon, applying:
 * 1. Authorization filter via buildDaemonTasksSyncWhere (org scoping + ACL on tasks.id)
 * 2. Client-supplied where expression via buildDrizzleWhereFromExpression
 * 3. Client-supplied sorts via buildDrizzleOrderFromSorts
 * 4. Optional limit + offset for pagination
 *
 * Unlike daemon sessions and approvals, tasks are NOT host-scoped.
 * A daemon can see all tasks accessible to the user/org it's authenticated as,
 * matching the same ACL as the UI-facing tasks route.
 *
 * No IDOR guard is needed since hostId is not part of the request input.
 *
 * Parallels the Electric proxy /v1/tasks route (UI-facing, same shape).
 *
 * Uses .$dynamic() to enable conditional .orderBy()/.limit()/.offset() chaining
 * without losing type inference on the query result.
 */
export const syncDaemonTasksProcedure = daemonBase.sync.tasks.handler(async ({ input, context, errors }) => {
	const { where, sorts, limit, offset } = input
	const { organizationId, userId, hostId } = context.auth
	const { db } = context.services

	try {
		const authWhere = buildDaemonTasksSyncWhere({ organizationId, userId, hostId }, db)
		const clientWhere = buildDrizzleWhereFromExpression(getTableColumns(tasks), where, 'tasks')
		const orderBy = buildDrizzleOrderFromSorts(getTableColumns(tasks), sorts, 'tasks')

		let query = db.select().from(tasks).where(and(authWhere, clientWhere)).$dynamic()

		if (orderBy.length > 0) query = query.orderBy(...orderBy)
		if (limit !== undefined) query = query.limit(limit)
		if (offset !== undefined) query = query.offset(offset)

		const rows = await query
		return { rows }
	} catch (error) {
		if (error instanceof SyncFilterError) {
			throw errors.BAD_REQUEST({ data: { message: error.message } })
		}
		Sentry.captureException(error, {
			tags: { error_type: 'sync_query' },
			extra: { table: 'tasks (daemon)', hasWhere: !!where },
		})
		throw error
	}
})
