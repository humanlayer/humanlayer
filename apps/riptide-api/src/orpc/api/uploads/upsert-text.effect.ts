import { artifacts } from '@humanlayer/db/tables/artifacts'
import { and, eq } from 'drizzle-orm'
import { Clock, Effect } from 'effect'
import { hash } from 'ohash'

import { getTxId } from '../../../db/get-tx-id'
import { mapPostgresErrorToResponse } from '../../../effects/services/postgres/error-mapping'
import { requireTaskEditPermission } from '../../../effects/services/postgres/helpers'
import { PostgresDb } from '../../../effects/services/postgres/postgres-db.service'
import { Sentry } from '../../../instrument'
import { MAX_TEXT_CONTENT_BYTES } from '../../../lib/constants'
import { normalizeSubpath } from '../../../lib/normalize-subpath'
import { effectOrpcBaseOrganizationRequired } from '../../effect-base'

export const upsertTextArtifactProcedure = effectOrpcBaseOrganizationRequired.uploads.upsertText.effect(function* ({
	input,
	context,
	errors,
}) {
	const postgres = yield* PostgresDb
	const { taskId, fileName: rawFileName, content } = input
	const { organizationId, userId } = context.auth

	const fileName = yield* Effect.try({
		try: () => normalizeSubpath(rawFileName),
		catch: () => errors.BAD_REQUEST({ data: { message: 'Invalid file name' } }),
	})

	// Validate content size (UTF-8 byte length) - handles multi-byte characters
	const contentBytes = Buffer.byteLength(content, 'utf8')
	if (contentBytes > MAX_TEXT_CONTENT_BYTES) {
		yield* Effect.fail(
			errors.BAD_REQUEST({
				data: { message: `Content size (${Math.round(contentBytes / 1024 / 1024)}MB) exceeds maximum of 10MB` },
			}),
		)
	}

	const contentHash = yield* Effect.sync(() => hash(content))

	const txResult = yield* postgres
		.transaction((tx) =>
			Effect.gen(function* () {
				const task = yield* requireTaskEditPermission(tx, { taskId, userId, organizationId })

				const taskSlug = task.slug
				const resourceOwnerUserId = task.resource_owner_user_id ?? userId

				const [existingArtifactToUpdate] = yield* tx.query(
					tx.client
						.select()
						.from(artifacts)
						.where(and(eq(artifacts.task_id, taskId), eq(artifacts.file_name, fileName)))
						.limit(1),
				)

				// update existing artifact
				if (existingArtifactToUpdate) {
					yield* tx.query(
						tx.client
							.update(artifacts)
							.set({
								storage_type: 'postgres',
								s3_key: null,
								content,
								content_hash: contentHash,
								content_type: 'text/plain',
								file_size_bytes: BigInt(Buffer.byteLength(content, 'utf8')),
								task_slug: taskSlug,
								last_updated_at: BigInt(yield* Clock.currentTimeMillis),
							})
							.where(eq(artifacts.id, existingArtifactToUpdate.id)),
					)
					const transactionId = yield* tx.run(() => getTxId(tx.client))
					return { artifactId: existingArtifactToUpdate.id, txid: transactionId, created: false }
				} else {
					const [newArtifact] = yield* tx.query(
						tx.client
							.insert(artifacts)
							.values({
								task_id: taskId,
								task_slug: taskSlug,
								file_name: fileName,
								content,
								content_hash: contentHash,
								content_type: 'text/plain',
								file_size_bytes: BigInt(Buffer.byteLength(content, 'utf8')),
								storage_type: 'postgres',
								s3_key: null,
								resource_owner_user_id: resourceOwnerUserId,
								organization_id: organizationId,
								created_by: userId,
							})
							.returning(),
					)

					if (!newArtifact) {
						yield* Effect.logError('Failed to get new artifact back from insertion.')
					}
					const transactionId = yield* tx.run(() => getTxId(tx.client))
					return { artifactId: newArtifact?.id ?? '', txid: transactionId, created: true }
				}
			}),
		)
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

	yield* Effect.logInfo(
		'Successfully inserted text artifact. task ID:',
		taskId,
		'fileName:',
		fileName,
		'created:',
		txResult.created,
		'artifact ID:',
		txResult.artifactId,
	)
	return { artifactId: txResult.artifactId, created: txResult.created, transactionId: txResult.txid }
})
