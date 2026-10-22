import { providerLoginRequests } from '@humanlayer/db/tables/provider-login-requests'
import * as Sentry from '@sentry/node'
import { and, getTableColumns } from 'drizzle-orm'

import { buildProviderLoginRequestsSyncWhereV2 } from '../../../../db/sync-auth'
import {
	buildDrizzleOrderFromSorts,
	buildDrizzleWhereFromExpression,
	SyncFilterError,
} from '../../../../db/sync-filters'
import { apiBaseSyncV2 } from '../../../base'

export const syncV2ProviderLoginRequestsProcedure = apiBaseSyncV2.sync.v2.providerLoginRequests.handler(
	async ({ input, context, errors }) => {
		const { where, sorts, limit, offset } = input
		const { organizationId, userId } = context.auth
		const { db } = context.services

		try {
			const authWhere = buildProviderLoginRequestsSyncWhereV2({ organizationId, userId })
			const clientWhere = buildDrizzleWhereFromExpression(
				getTableColumns(providerLoginRequests),
				where,
				'provider_login_requests',
			)
			const orderBy = buildDrizzleOrderFromSorts(
				getTableColumns(providerLoginRequests),
				sorts,
				'provider_login_requests',
			)
			let query = db.select().from(providerLoginRequests).where(and(authWhere, clientWhere)).$dynamic()
			if (orderBy.length > 0) query = query.orderBy(...orderBy)
			query = query.limit(limit ?? 10000)
			if (offset !== undefined) query = query.offset(offset)
			return { rows: await query }
		} catch (error) {
			if (error instanceof SyncFilterError) {
				throw errors.BAD_REQUEST({ data: { message: error.message } })
			}
			Sentry.captureException(error, {
				tags: { error_type: 'sync_query' },
				extra: { table: 'provider_login_requests_v2', hasWhere: !!where },
			})
			throw error
		}
	},
)
