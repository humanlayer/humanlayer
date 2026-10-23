import { sessions } from '@humanlayer/db/tables/sessions'
import * as Sentry from '@sentry/node'
import { and, getTableColumns } from 'drizzle-orm'

import { buildDaemonSessionsSyncWhere } from '../../../db/sync-auth'
import { buildDrizzleOrderFromSorts, buildDrizzleWhereFromExpression, SyncFilterError } from '../../../db/sync-filters'
import { daemonBase } from '../../base'

/**
 * Daemon sessions sync handler.
 *
 * Returns sessions visible to the authenticated daemon for the specified host,
 * applying:
 * 1. IDOR guard: input.hostId must match context.auth.hostId from the daemon token
 * 2. Authorization filter via buildDaemonSessionsSyncWhere (org scoping + host_id + ACL)
 * 3. Client-supplied where expression via buildDrizzleWhereFromExpression
 * 4. Client-supplied sorts via buildDrizzleOrderFromSorts
 * 5. Optional limit + offset for pagination
 *
 * Parallels the Electric proxy /v1/sessions/:hostId route.
 *
 * Uses .$dynamic() to enable conditional .orderBy()/.limit()/.offset() chaining
 * without losing type inference on the query result.
 */
export const syncDaemonSessionsProcedure = daemonBase.sync.sessions.handler(async ({ input, context, errors }) => {
	const { where, sorts, limit, offset, hostId } = input
	const { organizationId, userId, hostId: authHostId } = context.auth
	const { db } = context.services

	// IDOR guard: the hostId in the request must match the daemon token's hostId
	if (hostId !== authHostId) {
		throw errors.FORBIDDEN()
	}

	try {
		const authWhere = buildDaemonSessionsSyncWhere({ organizationId, userId, hostId }, db)
		const clientWhere = buildDrizzleWhereFromExpression(getTableColumns(sessions), where, 'sessions')
		const orderBy = buildDrizzleOrderFromSorts(getTableColumns(sessions), sorts, 'sessions')

		let query = db.select().from(sessions).where(and(authWhere, clientWhere)).$dynamic()

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
			extra: { table: 'sessions (daemon)', hasWhere: !!where, hostId },
		})
		throw error
	}
})
