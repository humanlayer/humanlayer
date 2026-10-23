import { diffComments } from '@humanlayer/db/tables/diff-comments'
import * as Sentry from '@sentry/node'
import { and, getTableColumns } from 'drizzle-orm'

import { buildDiffCommentsSyncWhereV2 } from '../../../../db/sync-auth'
import {
	buildDrizzleOrderFromSorts,
	buildDrizzleWhereFromExpression,
	SyncFilterError,
} from '../../../../db/sync-filters'
import { apiBaseSyncV2 } from '../../../base'

export const syncV2DiffCommentsProcedure = apiBaseSyncV2.sync.v2.diffComments.handler(
	async ({ input, context, errors }) => {
		const { where, sorts, limit, offset } = input
		const { organizationId, userId } = context.auth
		const { db } = context.services

		try {
			const authWhere = buildDiffCommentsSyncWhereV2({ organizationId, userId })
			const clientWhere = buildDrizzleWhereFromExpression(getTableColumns(diffComments), where, 'diff_comments')
			const orderBy = buildDrizzleOrderFromSorts(getTableColumns(diffComments), sorts, 'diff_comments')

			let query = db.select().from(diffComments).where(and(authWhere, clientWhere)).$dynamic()
			if (orderBy.length > 0) query = query.orderBy(...orderBy)
			query = query.limit(limit ?? 10000)
			if (offset !== undefined) query = query.offset(offset)

			return { rows: await query }
		} catch (error) {
			if (error instanceof SyncFilterError) {
				throw errors.BAD_REQUEST({ data: { message: error.message } })
			}
			Sentry.captureException(error, {
				tags: { procedure: 'syncDiffCommentsV2' },
				extra: { organizationId, userId },
			})
			throw error
		}
	},
)
