import { artifacts } from '@humanlayer/db/tables/artifacts'
import { eq } from 'drizzle-orm'
import { Effect } from 'effect'

import { mapPostgresErrorToResponse } from '../../../effects/services/postgres/error-mapping'
import { getTransactionId, requireTaskEditPermission } from '../../../effects/services/postgres/helpers'
import { PostgresDb } from '../../../effects/services/postgres/postgres-db.service'
import { Sentry } from '../../../instrument'
import { effectOrpcBaseOrganizationRequired } from '../../effect-base'

export const updateArtifactDeletionStatusProcedure =
	effectOrpcBaseOrganizationRequired.artifacts.updateDeletionStatus.effect(function* ({ input, context, errors }) {
		const postgres = yield* PostgresDb
		const { userId, organizationId } = context.auth
		const action = input.isDeleted ? 'delete' : 'restore'

		return yield* postgres
			.transaction((tx) =>
				Effect.gen(function* () {
					const [artifact] = yield* tx.query(
						tx.client.select().from(artifacts).where(eq(artifacts.id, input.artifactId)).limit(1),
					)

					if (!artifact) {
						return yield* Effect.fail(errors.NOT_FOUND({ data: { message: 'Artifact not found' } }))
					}

					const taskId = artifact.task_id
					if (!taskId) {
						return yield* Effect.fail(errors.NOT_FOUND({ data: { message: 'Artifact not found' } }))
					}

					// Permission check: requires edit access on the owning task. Missing task
					// access fails with TaskNotFoundError (mapped to NOT_FOUND to avoid leaking
					// existence); insufficient permission fails with TaskPermissionDeniedError.
					yield* requireTaskEditPermission(tx, { taskId, userId, organizationId })

					// Idempotency guard
					if (artifact.is_deleted === input.isDeleted) {
						const transactionId = yield* getTransactionId(tx)
						return { success: true, transactionId }
					}

					yield* tx.query(
						tx.client
							.update(artifacts)
							.set({ is_deleted: input.isDeleted })
							.where(eq(artifacts.id, input.artifactId)),
					)

					const transactionId = yield* getTransactionId(tx)
					return { success: true, transactionId }
				}),
			)
			.pipe(
				Effect.tap(() =>
					Effect.logInfo(input.isDeleted ? 'Artifact deleted (tombstoned)' : 'Artifact restored').pipe(
						Effect.annotateLogs({ artifactId: input.artifactId, userId, isDeleted: input.isDeleted }),
					),
				),
				Effect.tapError((e) => Effect.logError(e)),
				Effect.tapError((e) => Effect.sync(() => Sentry.captureException(e))),
				Effect.catchTags({
					TaskNotFoundError: () => Effect.fail(errors.NOT_FOUND({ data: { message: 'Artifact not found' } })),
					TaskPermissionDeniedError: () =>
						Effect.fail(
							errors.FORBIDDEN({ data: { message: `Edit permission required to ${action} artifacts` } }),
						),
					PostgresDbQueryError: (error) => mapPostgresErrorToResponse(error, errors),
					PostgresDbTransactionError: (error) => mapPostgresErrorToResponse(error, errors),
				}),
			)
	})
