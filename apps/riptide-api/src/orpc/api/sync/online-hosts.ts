import { onlineHosts } from '@humanlayer/db/tables/online-hosts'
import * as Sentry from '@sentry/node'
import { and, getTableColumns } from 'drizzle-orm'

import { buildOnlineHostsSyncWhere } from '../../../db/sync-auth'
import { buildDrizzleOrderFromSorts, buildDrizzleWhereFromExpression, SyncFilterError } from '../../../db/sync-filters'
import { apiBaseOrgRequired } from '../../base'

export const syncOnlineHostsProcedure = apiBaseOrgRequired.sync.onlineHosts.handler(
	async ({ input, context, errors }) => {
		const { where, sorts, limit, offset } = input
		const { organizationId, userId } = context.auth
		const { db } = context.services

		try {
			const authWhere = buildOnlineHostsSyncWhere({ organizationId, userId })
			const clientWhere = buildDrizzleWhereFromExpression(getTableColumns(onlineHosts), where, 'online_hosts')
			const orderBy = buildDrizzleOrderFromSorts(getTableColumns(onlineHosts), sorts, 'online_hosts')

			let query = db.select().from(onlineHosts).where(and(authWhere, clientWhere)).$dynamic()

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
				extra: { table: 'online_hosts', hasWhere: !!where },
			})
			throw error
		}
	},
)
