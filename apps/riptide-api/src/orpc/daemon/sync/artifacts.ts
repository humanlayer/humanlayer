import { artifacts } from '@humanlayer/db/tables/artifacts'
import * as Sentry from '@sentry/node'
import { and, getTableColumns } from 'drizzle-orm'

import { buildDaemonArtifactsSyncWhere } from '../../../db/sync-auth'
import { buildDrizzleOrderFromSorts, buildDrizzleWhereFromExpression, SyncFilterError } from '../../../db/sync-filters'
import { daemonBase } from '../../base'

/**
 * Daemon artifacts sync handler.
 *
 * Returns artifacts for the specified task visible to the authenticated daemon,
 * applying:
 * 1. Authorization filter via buildDaemonArtifactsSyncWhere (org scoping + task_id +
 *    ACL subquery for user/org access)
 * 2. Client-supplied where expression via buildDrizzleWhereFromExpression
 * 3. Client-supplied sorts via buildDrizzleOrderFromSorts
 * 4. Optional limit + offset for pagination
 *
 * Parallels the Electric proxy /v1/tasks/:taskId/artifacts route.
 *
 * The taskId in the input scopes results to a specific task. Unlike daemon sessions
 * (which have an IDOR guard for hostId), taskId is not a sensitive daemon-identity
 * field — the ACL WHERE clause already ensures the daemon can only see artifacts
 * it has access to for the given task.
 *
 * Uses .$dynamic() to enable conditional .orderBy()/.limit()/.offset() chaining
 * without losing type inference on the query result.
 */
export const syncDaemonArtifactsProcedure = daemonBase.sync.artifacts.handler(async ({ input, context, errors }) => {
	const { where, sorts, limit, offset, taskId } = input
	const { organizationId, userId, hostId } = context.auth
	const { db } = context.services

	try {
		const authWhere = buildDaemonArtifactsSyncWhere({ organizationId, userId, hostId, taskId }, db)
		const clientWhere = buildDrizzleWhereFromExpression(getTableColumns(artifacts), where, 'artifacts')
		const orderBy = buildDrizzleOrderFromSorts(getTableColumns(artifacts), sorts, 'artifacts')

		let query = db.select().from(artifacts).where(and(authWhere, clientWhere)).$dynamic()

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
			extra: { table: 'artifacts (daemon)', hasWhere: !!where, taskId },
		})
		throw error
	}
})
