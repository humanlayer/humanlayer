import { taskWorkspaceSetupForHost } from '@humanlayer/db/tables/task-workspace-setup-for-host'
import * as Sentry from '@sentry/node'
import { and, getTableColumns } from 'drizzle-orm'

import { buildDaemonWorkspaceSetupSyncWhere } from '../../../db/sync-auth'
import { buildDrizzleOrderFromSorts, buildDrizzleWhereFromExpression, SyncFilterError } from '../../../db/sync-filters'
import logger from '../../../logger'
import { daemonBase } from '../../base'

export const syncDaemonTaskWorkspaceSetupForHostProcedure = daemonBase.sync.taskWorkspaceSetupForHost.handler(
	async ({ input, context, errors }) => {
		const { where, sorts, limit, offset } = input
		const { organizationId, userId, hostId } = context.auth
		const { db } = context.services

		try {
			const authWhere = buildDaemonWorkspaceSetupSyncWhere({ organizationId, userId, hostId })
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
			if (limit !== undefined) query = query.limit(limit)
			if (offset !== undefined) query = query.offset(offset)
			return { rows: await query }
		} catch (error) {
			if (error instanceof SyncFilterError) {
				throw errors.BAD_REQUEST({ data: { message: error.message } })
			}
			Sentry.captureException(error, {
				tags: { error_type: 'sync_query' },
				extra: { table: 'task_workspace_setup_for_host (daemon)', hasWhere: !!where, hostId },
			})
			logger.error(
				{ err: error, organizationId, hostId, hasWhere: !!where },
				'Failed to sync daemon task workspace setup rows',
			)
			throw error
		}
	},
)
