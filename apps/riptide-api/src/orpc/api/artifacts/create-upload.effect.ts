import { artifacts } from '@humanlayer/db/tables/artifacts'
import { and, eq } from 'drizzle-orm'
import { Effect } from 'effect'

import { insertS3Artifact, updateArtifactForS3Storage } from '../../../effects/services/postgres/artifact.operations'
import { mapPostgresErrorToResponse } from '../../../effects/services/postgres/error-mapping'
import { getTransactionId, requireTaskEditPermission } from '../../../effects/services/postgres/helpers'
import { PostgresDb } from '../../../effects/services/postgres/postgres-db.service'
import { S3 } from '../../../effects/services/s3/s3.service'
import { normalizeSubpath } from '../../../lib/normalize-subpath'
import { buildS3Key } from '../../../lib/s3-key-builder'
import { effectOrpcBaseOrganizationRequired, requiresBillingEffectMiddleware } from '../../effect-base'

export const createUploadApiArtifactProcedure = effectOrpcBaseOrganizationRequired.artifacts.createUpload
	.use(requiresBillingEffectMiddleware)
	.effect(function* ({ input, context, errors }) {
		const postgres = yield* PostgresDb
		const s3 = yield* S3
		const { organizationId, userId } = context.auth
		const { taskId, contentHash, contentType, fileSizeBytes } = input

		const normalizedFileName = normalizeSubpath(input.fileName)

		const { artifactId, transactionId, s3Key } = yield* postgres
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
					return { artifactId, transactionId, s3Key }
				}),
			)
			.pipe(
				Effect.catchTags({
					TaskNotFoundError: () => Effect.fail(errors.NOT_FOUND()),
					TaskPermissionDeniedError: () =>
						Effect.fail(errors.FORBIDDEN({ data: { message: 'Edit permission required' } })),
					PostgresDbQueryError: (error) => mapPostgresErrorToResponse(error, errors),
					PostgresDbTransactionError: (error) => mapPostgresErrorToResponse(error, errors),
				}),
			)

		const uploadUrl = yield* s3
			.getPresignedUploadUrl(s3Key, contentType)
			.pipe(
				Effect.mapError(() => errors.SERVICE_UNAVAILABLE({ data: { message: 'Failed to create upload URL' } })),
			)

		return { artifactId, uploadUrl, transactionId }
	})
