import { sessions } from '@humanlayer/db/tables/sessions'
import * as Sentry from '@sentry/node'
import { and, getTableColumns } from 'drizzle-orm'

import { buildSessionsSyncWhere } from '../../../db/sync-auth'
import { buildDrizzleOrderFromSorts, buildDrizzleWhereFromExpression, SyncFilterError } from '../../../db/sync-filters'
import { apiBaseOrgRequired } from '../../base'

/**
 * Sessions sync handler.
 *
 * Returns all sessions visible to the authenticated user, applying:
 * 1. Authorization filter via buildSessionsSyncWhere (org scoping + ACL)
 * 2. Client-supplied where expression via buildDrizzleWhereFromExpression
 * 3. Client-supplied sorts via buildDrizzleOrderFromSorts
 * 4. Optional limit + offset for pagination
 *
 * Uses .$dynamic() to enable conditional .orderBy()/.limit()/.offset() chaining
 * without losing type inference on the query result.
 */
export const syncSessionsProcedure = apiBaseOrgRequired.sync.sessions.handler(async ({ input, context, errors }) => {
	const { where, sorts, limit, offset } = input
	const { organizationId, userId } = context.auth
	const { db } = context.services

	try {
		const authWhere = buildSessionsSyncWhere({ organizationId, userId }, db)
		const clientWhere = buildDrizzleWhereFromExpression(getTableColumns(sessions), where, 'sessions')
		const orderBy = buildDrizzleOrderFromSorts(getTableColumns(sessions), sorts, 'sessions')

		let query = db.select().from(sessions).where(and(authWhere, clientWhere)).$dynamic()

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
			extra: { table: 'sessions', hasWhere: !!where },
		})
		throw error
	}
})
