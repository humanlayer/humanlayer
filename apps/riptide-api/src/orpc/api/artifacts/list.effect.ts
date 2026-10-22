import { artifacts } from '@humanlayer/db/tables/artifacts'
import { and, eq } from 'drizzle-orm'
import { Effect } from 'effect'

import { mapPostgresErrorToResponse } from '../../../effects/services/postgres/error-mapping'
import { requireTaskReadPermission } from '../../../effects/services/postgres/helpers'
import { PostgresDb } from '../../../effects/services/postgres/postgres-db.service'
import { effectOrpcBaseOrganizationRequired } from '../../effect-base'

export const listArtifactsProcedure = effectOrpcBaseOrganizationRequired.artifacts.list.effect(function* ({
	input,
	context,
	errors,
}) {
	const postgres = yield* PostgresDb
	const { userId, organizationId } = context.auth
	const { taskId } = input

	return yield* postgres
		.transaction((tx) =>
			Effect.gen(function* () {
				yield* requireTaskReadPermission(tx, { taskId, userId, organizationId })

				const artifactRows = yield* tx.query(
					tx.client
						.select({
							fileName: artifacts.file_name,
							contentHash: artifacts.content_hash,
							storageType: artifacts.storage_type,
							fileSizeBytes: artifacts.file_size_bytes,
						})
						.from(artifacts)
						.where(
							and(
								eq(artifacts.task_id, taskId),
								eq(artifacts.organization_id, organizationId),
								eq(artifacts.is_deleted, false),
							),
						),
				)

				return {
					artifacts: artifactRows.map((row) => ({
						fileName: row.fileName,
						contentHash: row.contentHash,
						storageType: (row.storageType === 's3' ? 's3' : 'postgres') as 's3' | 'postgres',
						fileSizeBytes: row.fileSizeBytes == null ? null : Number(row.fileSizeBytes),
					})),
				}
			}),
		)
		.pipe(
			Effect.catchTags({
				TaskNotFoundError: () => Effect.fail(errors.NOT_FOUND({ data: { message: 'Task not found' } })),
				PostgresDbQueryError: (error) => mapPostgresErrorToResponse(error, errors),
				PostgresDbTransactionError: (error) => mapPostgresErrorToResponse(error, errors),
			}),
		)
})
