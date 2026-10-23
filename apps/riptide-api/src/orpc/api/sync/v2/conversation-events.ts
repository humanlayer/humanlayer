import { conversationEvents } from '@humanlayer/db/tables/conversation-events'
import * as Sentry from '@sentry/node'
import { and, getTableColumns } from 'drizzle-orm'

import { buildConversationEventsSyncWhereV2 } from '../../../../db/sync-auth'
import {
	buildDrizzleOrderFromSorts,
	buildDrizzleWhereFromExpression,
	requireScopeFields,
	SyncFilterError,
} from '../../../../db/sync-filters'
import { apiBaseSyncV2 } from '../../../base'

export const syncV2ConversationEventsProcedure = apiBaseSyncV2.sync.v2.conversationEvents.handler(
	async ({ input, context, errors }) => {
		const { where, sorts, limit, offset } = input
		const { organizationId, userId } = context.auth
		const { db } = context.services

		try {
			requireScopeFields(where, ['session_id', 'task_id', 'id'], 'conversation_events')
			const authWhere = buildConversationEventsSyncWhereV2({ organizationId, userId })
			const clientWhere = buildDrizzleWhereFromExpression(
				getTableColumns(conversationEvents),
				where,
				'conversation_events',
			)
			const orderBy = buildDrizzleOrderFromSorts(
				getTableColumns(conversationEvents),
				sorts,
				'conversation_events',
			)

			let query = db.select().from(conversationEvents).where(and(authWhere, clientWhere)).$dynamic()

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
				extra: { table: 'conversation_events_v2', hasWhere: !!where },
			})
			throw error
		}
	},
)
