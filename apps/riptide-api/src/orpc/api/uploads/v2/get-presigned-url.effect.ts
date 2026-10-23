import { tasks } from '@humanlayer/db/tables/tasks'
import { eq } from 'drizzle-orm'
import { Effect } from 'effect'

import { mapPostgresErrorToResponse } from '../../../../effects/services/postgres/error-mapping'
import { requireTaskEditPermission } from '../../../../effects/services/postgres/helpers'
import { PostgresDb } from '../../../../effects/services/postgres/postgres-db.service'
import { S3 } from '../../../../effects/services/s3/s3.service'
import { Sentry } from '../../../../instrument'
import { normalizeSubpath } from '../../../../lib/normalize-subpath'
import { buildS3Key } from '../../../../lib/s3-key-builder'
import { effectOrpcBaseOrganizationRequired } from '../../../effect-base'

export const getPresignedUrlV2Procedure = effectOrpcBaseOrganizationRequired.uploads.v2.getPresignedUrl.effect(
	function* ({ input, context, errors }) {
		const postgres = yield* PostgresDb
		const s3 = yield* S3

		const { taskId, fileName: rawFileName, contentType } = input
		const { organizationId, userId } = context.auth
		const fileName = yield* Effect.try({
			try: () => normalizeSubpath(rawFileName),
			catch: () => errors.BAD_REQUEST({ data: { message: 'Invalid file name' } }),
		})

		yield* postgres
			.transaction((tx) =>
				Effect.gen(function* () {
					const [existingTask] = yield* tx.query(
						tx.client
							.select({ organizationId: tasks.organization_id })
							.from(tasks)
							.where(eq(tasks.id, taskId))
							.limit(1),
					)

					if (existingTask === undefined) return
					if (existingTask.organizationId !== organizationId) {
						return yield* Effect.fail(errors.NOT_FOUND())
					}

					yield* requireTaskEditPermission(tx, { taskId, userId, organizationId })
				}),
			)
			.pipe(
				Effect.tapError((error) => Effect.logError(error)),
				Effect.tapError((error) => Effect.sync(() => Sentry.captureException(error))),
				Effect.catchTags({
					TaskNotFoundError: () => Effect.fail(errors.NOT_FOUND()),
					TaskPermissionDeniedError: () =>
						Effect.fail(
							errors.FORBIDDEN({
								data: { message: 'You do not have permission to upload artifacts to this task' },
							}),
						),
					PostgresDbQueryError: (error) => mapPostgresErrorToResponse(error, errors),
					PostgresDbTransactionError: (error) => mapPostgresErrorToResponse(error, errors),
				}),
			)

		const uploadUrl = yield* s3
			.getPresignedUploadUrl(buildS3Key(organizationId, taskId, fileName), contentType)
			.pipe(
				Effect.tapError((error) => Effect.logError(error)),
				Effect.tapError((error) => Effect.sync(() => Sentry.captureException(error))),
				Effect.mapError(() => errors.SERVICE_UNAVAILABLE()),
			)

		yield* Effect.logInfo('Generated future-task presigned upload url', 'taskId:', taskId, 'filename:', fileName)
		return { uploadUrl }
	},
)
