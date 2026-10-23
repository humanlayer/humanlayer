import { artifacts } from '@humanlayer/db/tables/artifacts'
import { and, eq } from 'drizzle-orm'
import { Effect } from 'effect'

import { mapPostgresErrorToResponse } from '../../../effects/services/postgres/error-mapping'
import { requireTaskReadPermission } from '../../../effects/services/postgres/helpers'
import { PostgresDb } from '../../../effects/services/postgres/postgres-db.service'
import { S3 } from '../../../effects/services/s3/s3.service'
import { effectOrpcBaseOrganizationRequired } from '../../effect-base'

export const getArtifactProcedure = effectOrpcBaseOrganizationRequired.artifacts.get.effect(function* ({
	input,
	context,
	errors,
}) {
	const postgres = yield* PostgresDb
	const s3 = yield* S3
	const { userId, organizationId } = context.auth
	const { taskId, fileName } = input

	const artifactRecord = yield* postgres
		.transaction((tx) =>
			Effect.gen(function* () {
				yield* requireTaskReadPermission(tx, { taskId, userId, organizationId })

				const [foundArtifact] = yield* tx.query(
					tx.client
						.select({
							content: artifacts.content,
							contentHash: artifacts.content_hash,
							storageType: artifacts.storage_type,
							s3Key: artifacts.s3_key,
						})
						.from(artifacts)
						.where(
							and(
								eq(artifacts.task_id, taskId),
								eq(artifacts.organization_id, organizationId),
								eq(artifacts.file_name, fileName),
								eq(artifacts.is_deleted, false),
							),
						)
						.limit(1),
				)

				if (!foundArtifact) {
					return yield* Effect.fail(errors.NOT_FOUND({ data: { message: 'Artifact not found' } }))
				}
				return foundArtifact
			}),
		)
		.pipe(
			Effect.catchTags({
				TaskNotFoundError: () => Effect.fail(errors.NOT_FOUND({ data: { message: 'Task not found' } })),
				PostgresDbQueryError: (error) => mapPostgresErrorToResponse(error, errors),
				PostgresDbTransactionError: (error) => mapPostgresErrorToResponse(error, errors),
			}),
		)

	if (artifactRecord.storageType === 's3') {
		if (!artifactRecord.s3Key) {
			return yield* Effect.fail(errors.NOT_FOUND({ data: { message: 'Artifact not found' } }))
		}
		const downloadUrl = yield* s3
			.getPresignedDownloadUrl(artifactRecord.s3Key)
			.pipe(
				Effect.mapError(() =>
					errors.SERVICE_UNAVAILABLE({ data: { message: 'Failed to create download URL' } }),
				),
			)
		return { storageType: 's3' as const, contentHash: artifactRecord.contentHash, downloadUrl }
	}

	return {
		storageType: 'postgres' as const,
		content: artifactRecord.content,
		contentHash: artifactRecord.contentHash,
	}
})
