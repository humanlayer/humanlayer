import { taskWorkspaceSetupForHost } from '@humanlayer/db/tables/task-workspace-setup-for-host'
import * as Sentry from '@sentry/node'
import { and, getTableColumns } from 'drizzle-orm'

import { buildTaskWorkspaceSetupForHostSyncWhereV2 } from '../../../../db/sync-auth'
import {
	buildDrizzleOrderFromSorts,
	buildDrizzleWhereFromExpression,
	SyncFilterError,
} from '../../../../db/sync-filters'
import { apiBaseSyncV2 } from '../../../base'

export const syncV2TaskWorkspaceSetupForHostProcedure = apiBaseSyncV2.sync.v2.taskWorkspaceSetupForHost.handler(
	async ({ input, context, errors }) => {
		const { where, sorts, limit, offset } = input
		const { organizationId, userId } = context.auth
		const { db } = context.services

		try {
			const authWhere = buildTaskWorkspaceSetupForHostSyncWhereV2({ organizationId, userId })
			const clientWhere = buildDrizzleWhereFromExpression(
				getTableColumns(taskWorkspaceSetupForHost),
				where,
				'task_workspace_setup_for_host',
			)
			const orderBy = buildDrizzleOrderFromSorts(
				getTableColumns(taskWorkspaceSetupForHost),
				sorts,
				'task_workspace_setup_for_host',
			)
			let query = db.select().from(taskWorkspaceSetupForHost).where(and(authWhere, clientWhere)).$dynamic()
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
				extra: { table: 'task_workspace_setup_for_host_v2', hasWhere: !!where },
			})
			throw error
		}
	},
)
