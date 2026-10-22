import { artifacts } from '@humanlayer/db/tables/artifacts'
import * as Sentry from '@sentry/node'
import { and, getTableColumns } from 'drizzle-orm'

import { buildArtifactsSyncWhere } from '../../../db/sync-auth'
import { buildDrizzleOrderFromSorts, buildDrizzleWhereFromExpression, SyncFilterError } from '../../../db/sync-filters'
import { apiBaseOrgRequired } from '../../base'

// Build the metadata columns object once (all columns except 'content')
const { content: _content, ...metadataColumns } = getTableColumns(artifacts)

export const syncArtifactsMetadataProcedure = apiBaseOrgRequired.sync.artifactsMetadata.handler(
	async ({ input, context, errors }) => {
		const { where, sorts, limit, offset } = input
		const { organizationId, userId } = context.auth
		const { db } = context.services

		try {
			const authWhere = buildArtifactsSyncWhere({ organizationId, userId }, db)
			// Only filter on metadata columns (content is excluded from the select)
			const clientWhere = buildDrizzleWhereFromExpression(metadataColumns, where, 'artifacts_metadata')
			const orderBy = buildDrizzleOrderFromSorts(metadataColumns, sorts, 'artifacts_metadata')

			let query = db.select(metadataColumns).from(artifacts).where(and(authWhere, clientWhere)).$dynamic()

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
				extra: { table: 'artifacts_metadata', hasWhere: !!where },
			})
			throw error
		}
	},
)
