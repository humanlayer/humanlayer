import { artifactComments } from '@humanlayer/db/tables/artifact-comments'
import * as Sentry from '@sentry/node'
import { and, getTableColumns } from 'drizzle-orm'

import { buildArtifactCommentsSyncWhere } from '../../../db/sync-auth'
import { buildDrizzleOrderFromSorts, buildDrizzleWhereFromExpression, SyncFilterError } from '../../../db/sync-filters'
import { apiBaseOrgRequired } from '../../base'

export const syncArtifactCommentsProcedure = apiBaseOrgRequired.sync.artifactComments.handler(
	async ({ input, context, errors }) => {
		const { where, sorts, limit, offset } = input
		const { organizationId, userId } = context.auth
		const { db } = context.services

		try {
			const authWhere = buildArtifactCommentsSyncWhere({ organizationId, userId }, db)
			const clientWhere = buildDrizzleWhereFromExpression(
				getTableColumns(artifactComments),
				where,
				'artifact_comments',
			)
			const orderBy = buildDrizzleOrderFromSorts(getTableColumns(artifactComments), sorts, 'artifact_comments')

			let query = db.select().from(artifactComments).where(and(authWhere, clientWhere)).$dynamic()

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
				tags: { procedure: 'syncArtifactComments' },
				extra: { organizationId, userId },
			})
			throw error
		}
	},
)
