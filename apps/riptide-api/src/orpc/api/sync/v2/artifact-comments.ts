import { artifactComments } from '@humanlayer/db/tables/artifact-comments'
import * as Sentry from '@sentry/node'
import { and, getTableColumns } from 'drizzle-orm'

import { buildArtifactCommentsSyncWhereV2 } from '../../../../db/sync-auth'
import {
	buildDrizzleOrderFromSorts,
	buildDrizzleWhereFromExpression,
	SyncFilterError,
} from '../../../../db/sync-filters'
import { apiBaseSyncV2 } from '../../../base'

export const syncV2ArtifactCommentsProcedure = apiBaseSyncV2.sync.v2.artifactComments.handler(
	async ({ input, context, errors }) => {
		const { where, sorts, limit, offset } = input
		const { organizationId, userId } = context.auth
		const { db } = context.services

		try {
			const authWhere = buildArtifactCommentsSyncWhereV2({ organizationId, userId })
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
				tags: { procedure: 'syncArtifactCommentsV2' },
				extra: { organizationId, userId },
			})
			throw error
		}
	},
)
