import { taskUserAcl } from '@humanlayer/db/tables/task-user-acl'
import * as Sentry from '@sentry/node'
import { and, getTableColumns } from 'drizzle-orm'

import { buildTaskUserAclsSyncWhere } from '../../../db/sync-auth'
import { buildDrizzleOrderFromSorts, buildDrizzleWhereFromExpression, SyncFilterError } from '../../../db/sync-filters'
import { apiBaseOrgRequired } from '../../base'

export const syncTaskUserAclsProcedure = apiBaseOrgRequired.sync.taskUserAcls.handler(
	async ({ input, context, errors }) => {
		const { where, sorts, limit, offset } = input
		const { organizationId, userId } = context.auth
		const { db } = context.services

		try {
			const authWhere = buildTaskUserAclsSyncWhere({ organizationId, userId })
			const clientWhere = buildDrizzleWhereFromExpression(getTableColumns(taskUserAcl), where, 'task_user_acl')
			const orderBy = buildDrizzleOrderFromSorts(getTableColumns(taskUserAcl), sorts, 'task_user_acl')

			let query = db.select().from(taskUserAcl).where(and(authWhere, clientWhere)).$dynamic()

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
				extra: { table: 'task_user_acl', hasWhere: !!where },
			})
			throw error
		}
	},
)
