import { artifacts } from '@humanlayer/db/tables/artifacts'
import { and, eq } from 'drizzle-orm'
import { Effect } from 'effect'

import { insertS3Artifact, updateArtifactForS3Storage } from '../../../effects/services/postgres/artifact.operations'
import { mapPostgresErrorToResponse } from '../../../effects/services/postgres/error-mapping'
import { getTransactionId, requireTaskEditPermission } from '../../../effects/services/postgres/helpers'
import { PostgresDb } from '../../../effects/services/postgres/postgres-db.service'
import { Sentry } from '../../../instrument'
import { normalizeSubpath } from '../../../lib/normalize-subpath'
import { buildS3Key } from '../../../lib/s3-key-builder'
import { effectOrpcBaseOrganizationRequired } from '../../effect-base'

const MAX_UPLOAD_SIZE_BYTES = 50 * 1024 * 1024 // 50 MB

export const createUploadProcedure = effectOrpcBaseOrganizationRequired.uploads.create.effect(function* ({
	input,
	context,
	errors,
}) {
	const postgres = yield* PostgresDb
	const { userId, organizationId } = context.auth
	const { taskId, contentType, contentHash, fileSizeBytes } = input

	const normalizedFileName = normalizeSubpath(input.fileName)

	if (fileSizeBytes > MAX_UPLOAD_SIZE_BYTES) {
		throw errors.BAD_REQUEST({
			data: { message: `File size exceeds maximum of ${MAX_UPLOAD_SIZE_BYTES / 1024 / 1024} MB` },
		})
	}

	const { artifactId, transactionId } = yield* postgres
		.transaction((tx) =>
			Effect.gen(function* () {
				const task = yield* requireTaskEditPermission(tx, { taskId, userId, organizationId })
				const s3Key = buildS3Key(organizationId, taskId, normalizedFileName)

				const [existingArtifact] = yield* tx.query(
					tx.client
						.select({ id: artifacts.id })
						.from(artifacts)
						.where(and(eq(artifacts.task_id, taskId), eq(artifacts.file_name, normalizedFileName)))
						.limit(1),
				)

				const artifactId = yield* existingArtifact
					? updateArtifactForS3Storage(tx, {
							artifactId: existingArtifact.id,
							s3Key,
							contentHash,
							contentType,
							fileSizeBytes,
							taskSlug: task.slug,
						})
					: insertS3Artifact(tx, {
							taskId,
							taskSlug: task.slug,
							fileName: normalizedFileName,
							s3Key,
							contentHash,
							contentType,
							fileSizeBytes,
							resourceOwnerUserId: task.resource_owner_user_id ?? userId,
							organizationId,
							createdByUserId: userId,
						})

				const transactionId = yield* getTransactionId(tx)
				return { artifactId, transactionId }
			}),
		)
		.pipe(
			Effect.tapError((e) => Effect.logError(e)),
			Effect.tapError((e) => Effect.sync(() => Sentry.captureException(e))),
			Effect.catchTags({
				TaskNotFoundError: () => Effect.fail(errors.NOT_FOUND()),
				TaskPermissionDeniedError: () =>
					Effect.fail(errors.FORBIDDEN({ data: { message: 'Edit permission required to upload files' } })),
				PostgresDbQueryError: (error) => mapPostgresErrorToResponse(error, errors),
				PostgresDbTransactionError: (error) => mapPostgresErrorToResponse(error, errors),
			}),
		)

	yield* Effect.logInfo('Upload created').pipe(
		Effect.annotateLogs({ taskId, fileName: normalizedFileName, artifactId, contentType, fileSizeBytes }),
	)

	return { artifactId, transactionId }
})
