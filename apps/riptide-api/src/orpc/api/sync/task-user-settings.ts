import { taskUserSettings } from '@humanlayer/db/tables/task-user-settings'
import * as Sentry from '@sentry/node'
import { and, getTableColumns } from 'drizzle-orm'

import { buildTaskUserSettingsSyncWhere } from '../../../db/sync-auth'
import { buildDrizzleOrderFromSorts, buildDrizzleWhereFromExpression, SyncFilterError } from '../../../db/sync-filters'
import { apiBaseOrgRequired } from '../../base'

export const syncTaskUserSettingsProcedure = apiBaseOrgRequired.sync.taskUserSettings.handler(
	async ({ input, context, errors }) => {
		const { where, sorts, limit, offset } = input
		const { organizationId, userId } = context.auth
		const { db } = context.services

		try {
			const authWhere = buildTaskUserSettingsSyncWhere({ organizationId, userId })
			const clientWhere = buildDrizzleWhereFromExpression(
				getTableColumns(taskUserSettings),
				where,
				'task_user_settings',
			)
			const orderBy = buildDrizzleOrderFromSorts(getTableColumns(taskUserSettings), sorts, 'task_user_settings')

			let query = db.select().from(taskUserSettings).where(and(authWhere, clientWhere)).$dynamic()

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
				extra: { table: 'task_user_settings', hasWhere: !!where },
			})
			throw error
		}
	},
)
