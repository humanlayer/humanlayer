import { artifacts } from '@humanlayer/db/tables/artifacts'
import { eq } from 'drizzle-orm'
import { Effect } from 'effect'

import { mapPostgresErrorToResponse } from '../../../effects/services/postgres/error-mapping'
import { requireTaskReadPermission } from '../../../effects/services/postgres/helpers'
import { PostgresDb } from '../../../effects/services/postgres/postgres-db.service'
import { S3 } from '../../../effects/services/s3/s3.service'
import { Sentry } from '../../../instrument'
import { effectOrpcBaseOrganizationRequired } from '../../effect-base'

export const getDownloadUrlProcedure = effectOrpcBaseOrganizationRequired.uploads.downloadUrl.effect(function* ({
	input,
	context,
	errors,
}) {
	const postgres = yield* PostgresDb
	const s3 = yield* S3

	const { artifactId } = input
	const { organizationId, userId } = context.auth

	const artifactRecord = yield* postgres
		.transaction((tx) =>
			Effect.gen(function* () {
				const [foundArtifact] = yield* tx.query(
					tx.client.select().from(artifacts).where(eq(artifacts.id, artifactId)),
				)

				if (!foundArtifact) {
					return yield* Effect.fail(errors.NOT_FOUND())
				}

				// Security boundary - ensure the artifact belongs to the organization
				if (foundArtifact.organization_id !== organizationId) {
					return yield* Effect.fail(errors.NOT_FOUND())
				}

				// If artifact is associated with a task, verify read permission
				if (foundArtifact.task_id) {
					yield* requireTaskReadPermission(tx, {
						taskId: foundArtifact.task_id,
						userId,
						organizationId,
					})
				}

				if (foundArtifact.storage_type !== 's3' || !foundArtifact.s3_key) {
					return yield* Effect.fail(errors.BAD_REQUEST({ data: { message: 'Artifact is not stored in S3' } }))
				}

				return foundArtifact
			}),
		)
		.pipe(
			Effect.tapError((e) => Effect.logError(e)),
			Effect.tapError((e) => Effect.sync(() => Sentry.captureException(e))),
			Effect.catchTags({
				TaskNotFoundError: () => Effect.fail(errors.NOT_FOUND()),
				PostgresDbQueryError: (error) => mapPostgresErrorToResponse(error, errors),
				PostgresDbTransactionError: (error) => mapPostgresErrorToResponse(error, errors),
			}),
		)

	const s3Key = artifactRecord.s3_key
	if (!s3Key) {
		yield* Effect.logError(`Artifact ${artifactId} is missing S3 key!`)
		Sentry.captureException('Failed to get download URL for artifact: missing S3 key')
		return yield* Effect.fail(errors.INTERNAL_SERVER_ERROR())
	}

	const downloadUrl = yield* s3
		.getPresignedDownloadUrl(s3Key)
		.pipe(Effect.mapError(() => errors.SERVICE_UNAVAILABLE({ data: { message: 'Failed to create download URL' } })))

	return { downloadUrl }
})
