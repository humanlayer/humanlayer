import { approvals } from '@humanlayer/db/tables/approvals'
import * as Sentry from '@sentry/node'
import { and, getTableColumns } from 'drizzle-orm'

import { buildDaemonApprovalsSyncWhere } from '../../../db/sync-auth'
import { buildDrizzleOrderFromSorts, buildDrizzleWhereFromExpression, SyncFilterError } from '../../../db/sync-filters'
import { daemonBase } from '../../base'

/**
 * Daemon approvals sync handler.
 *
 * Returns approvals visible to the authenticated daemon for its host,
 * applying:
 * 1. Authorization filter via buildDaemonApprovalsSyncWhere (org scoping + host_id from auth token + ACL)
 * 2. Client-supplied where expression via buildDrizzleWhereFromExpression
 * 3. Client-supplied sorts via buildDrizzleOrderFromSorts
 * 4. Optional limit + offset for pagination
 *
 * Unlike the daemon sessions route, hostId comes from the daemon token
 * (context.auth.hostId) rather than from request input, so no IDOR guard
 * is needed — a daemon can only see approvals for its own host.
 *
 * Parallels the Electric proxy /v1/daemon/approvals route.
 *
 * Uses .$dynamic() to enable conditional .orderBy()/.limit()/.offset() chaining
 * without losing type inference on the query result.
 */
export const syncDaemonApprovalsProcedure = daemonBase.sync.approvals.handler(async ({ input, context, errors }) => {
	const { where, sorts, limit, offset } = input
	const { organizationId, userId, hostId } = context.auth
	const { db } = context.services

	try {
		const authWhere = buildDaemonApprovalsSyncWhere({ organizationId, userId, hostId }, db)
		const clientWhere = buildDrizzleWhereFromExpression(getTableColumns(approvals), where, 'approvals')
		const orderBy = buildDrizzleOrderFromSorts(getTableColumns(approvals), sorts, 'approvals')

		let query = db.select().from(approvals).where(and(authWhere, clientWhere)).$dynamic()

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
			extra: { table: 'approvals (daemon)', hasWhere: !!where, hostId },
		})
		throw error
	}
})
