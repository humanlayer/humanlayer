import { sessions } from '@humanlayer/db/tables/sessions'
import * as Sentry from '@sentry/node'
import { and, getTableColumns } from 'drizzle-orm'

import { buildSessionsSyncWhereV2 } from '../../../../db/sync-auth'
import {
	buildDrizzleOrderFromSorts,
	buildDrizzleWhereFromExpression,
	SyncFilterError,
} from '../../../../db/sync-filters'
import { apiBaseSyncV2 } from '../../../base'

export const syncV2SessionsProcedure = apiBaseSyncV2.sync.v2.sessions.handler(async ({ input, context, errors }) => {
	const { where, sorts, limit, offset } = input
	const { organizationId, userId } = context.auth
	const { db } = context.services

	try {
		const authWhere = buildSessionsSyncWhereV2({ organizationId, userId })
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
			extra: { table: 'sessions_v2', hasWhere: !!where },
		})
		throw error
	}
})
