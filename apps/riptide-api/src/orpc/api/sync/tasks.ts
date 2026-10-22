import { tasks } from '@humanlayer/db/tables/tasks'
import * as Sentry from '@sentry/node'
import { and, getTableColumns } from 'drizzle-orm'

import { buildTasksSyncWhere } from '../../../db/sync-auth'
import { buildDrizzleOrderFromSorts, buildDrizzleWhereFromExpression, SyncFilterError } from '../../../db/sync-filters'
import { apiBaseOrgRequired } from '../../base'

/**
 * Tasks sync handler.
 *
 * Returns all tasks visible to the authenticated user, applying:
 * 1. Authorization filter via buildTasksSyncWhere (org scoping + ACL on tasks.id)
 * 2. Client-supplied where expression via buildDrizzleWhereFromExpression
 * 3. Client-supplied sorts via buildDrizzleOrderFromSorts
 * 4. Optional limit + offset for pagination
 *
 * Uses .$dynamic() to enable conditional .orderBy()/.limit()/.offset() chaining
 * without losing type inference on the query result.
 *
 * NOTE: Tasks ACL uses tasks.id (not task_id) — see buildTasksSyncWhere.
 */
export const syncTasksProcedure = apiBaseOrgRequired.sync.tasks.handler(async ({ input, context, errors }) => {
	const { where, sorts, limit, offset } = input
	const { organizationId, userId } = context.auth
	const { db } = context.services

	try {
		const authWhere = buildTasksSyncWhere({ organizationId, userId }, db)
		const clientWhere = buildDrizzleWhereFromExpression(getTableColumns(tasks), where, 'tasks')
		const orderBy = buildDrizzleOrderFromSorts(getTableColumns(tasks), sorts, 'tasks')

		let query = db.select().from(tasks).where(and(authWhere, clientWhere)).$dynamic()

		if (orderBy.length > 0) query = query.orderBy(...orderBy)
		query = query.limit(limit ?? 10000)
		if (offset !== undefined) query = query.offset(offset)

		const rows = await query
		return { rows }
	} catch (error) {
		if (error instanceof SyncFilterError) {
			throw errors.BAD_REQUEST({ data: { message: error.message } })
		}
		Sentry.captureException(error, {
			tags: { error_type: 'sync_query' },
			extra: { table: 'tasks', hasWhere: !!where },
		})
		throw error
	}
})
