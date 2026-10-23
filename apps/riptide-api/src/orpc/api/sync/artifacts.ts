import { artifacts } from '@humanlayer/db/tables/artifacts'
import * as Sentry from '@sentry/node'
import { and, getTableColumns } from 'drizzle-orm'

import { buildArtifactsSyncWhere } from '../../../db/sync-auth'
import { buildDrizzleOrderFromSorts, buildDrizzleWhereFromExpression, SyncFilterError } from '../../../db/sync-filters'
import { apiBaseOrgRequired } from '../../base'

export const syncArtifactsProcedure = apiBaseOrgRequired.sync.artifacts.handler(async ({ input, context, errors }) => {
	const { where, sorts, limit, offset } = input
	const { organizationId, userId } = context.auth
	const { db } = context.services

	try {
		const authWhere = buildArtifactsSyncWhere({ organizationId, userId }, db)
		const clientWhere = buildDrizzleWhereFromExpression(getTableColumns(artifacts), where, 'artifacts')
		const orderBy = buildDrizzleOrderFromSorts(getTableColumns(artifacts), sorts, 'artifacts')

		let query = db.select().from(artifacts).where(and(authWhere, clientWhere)).$dynamic()

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
			extra: { table: 'artifacts', hasWhere: !!where },
		})
		throw error
	}
})
