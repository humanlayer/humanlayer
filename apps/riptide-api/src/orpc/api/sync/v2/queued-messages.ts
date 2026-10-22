import { queuedMessages } from '@humanlayer/db/tables/queued-messages'
import * as Sentry from '@sentry/node'
import { and, getTableColumns } from 'drizzle-orm'

import { buildQueuedMessagesSyncWhereV2 } from '../../../../db/sync-auth'
import {
	buildDrizzleOrderFromSorts,
	buildDrizzleWhereFromExpression,
	SyncFilterError,
} from '../../../../db/sync-filters'
import { apiBaseSyncV2 } from '../../../base'

export const syncV2QueuedMessagesProcedure = apiBaseSyncV2.sync.v2.queuedMessages.handler(
	async ({ input, context, errors }) => {
		const { where, sorts, limit, offset } = input
		const { organizationId, userId } = context.auth
		const { db } = context.services

		try {
			const authWhere = buildQueuedMessagesSyncWhereV2({ organizationId, userId })
			const clientWhere = buildDrizzleWhereFromExpression(
				getTableColumns(queuedMessages),
				where,
				'queued_messages',
			)
			const orderBy = buildDrizzleOrderFromSorts(getTableColumns(queuedMessages), sorts, 'queued_messages')

			let query = db.select().from(queuedMessages).where(and(authWhere, clientWhere)).$dynamic()

			if (orderBy.length > 0) {
				query = query.orderBy(...orderBy)
			}
			query = query.limit(limit ?? 10000)
			if (offset !== undefined) {
				query = query.offset(offset)
			}

			return { rows: await query }
		} catch (error) {
			if (error instanceof SyncFilterError) {
				throw errors.BAD_REQUEST({ data: { message: error.message } })
			}
			Sentry.captureException(error, {
				tags: { error_type: 'sync_query' },
				extra: { table: 'queued_messages_v2', hasWhere: !!where },
			})
			throw error
		}
	},
)
