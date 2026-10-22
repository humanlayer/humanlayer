import { Effect } from 'effect'

import { mapPostgresErrorToResponse } from '../../../effects/services/postgres/error-mapping'
import { requireTaskEditPermission } from '../../../effects/services/postgres/helpers'
import { PostgresDb } from '../../../effects/services/postgres/postgres-db.service'
import { S3 } from '../../../effects/services/s3/s3.service'
import { Sentry } from '../../../instrument'
import { normalizeSubpath } from '../../../lib/normalize-subpath'
import { buildS3Key } from '../../../lib/s3-key-builder'
import { effectOrpcBaseOrganizationRequired } from '../../effect-base'

export const getPresignedUrlProcedure = effectOrpcBaseOrganizationRequired.uploads.getPresignedUrl.effect(function* ({
	input,
	context,
	errors,
}) {
	const postgres = yield* PostgresDb
	const s3 = yield* S3

	const { taskId, fileName: rawFileName, contentType } = input
	const { organizationId, userId } = context.auth
	const fileName = yield* Effect.try({
		try: () => normalizeSubpath(rawFileName),
		catch: () => errors.BAD_REQUEST({ data: { message: 'Invalid file name' } }),
	})

	// get the task (user must have permissions)
	yield* postgres
		.transaction((tx) => requireTaskEditPermission(tx, { taskId, userId, organizationId }))
		.pipe(
			Effect.tapError((e) => Effect.logError(e)),
			Effect.tapError((e) => Effect.sync(() => Sentry.captureException(e))),
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

	const uploadUrl = yield* Effect.gen(function* () {
		const s3Key = buildS3Key(organizationId, taskId, fileName)
		return yield* s3.getPresignedUploadUrl(s3Key, contentType)
	}).pipe(
		Effect.tapError((e) => Effect.logError(e)),
		Effect.tapError((e) => Effect.sync(() => Sentry.captureException(e))),

		// Unfortunately we don't know what type of error thsi could be
		Effect.mapError(() => errors.SERVICE_UNAVAILABLE()),
	)

	yield* Effect.logInfo('Generated presigned upload url', 'taskId:', taskId, 'filename:', fileName)
	return { uploadUrl }
})
