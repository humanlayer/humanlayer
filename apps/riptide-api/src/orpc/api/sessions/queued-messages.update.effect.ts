import { queuedMessages } from '@humanlayer/db/tables/queued-messages'
import { sessions } from '@humanlayer/db/tables/sessions'
import { and, eq } from 'drizzle-orm'
import { Clock, Effect } from 'effect'

import { getTxId } from '../../../db/get-tx-id'
import { mapPostgresErrorToResponse } from '../../../effects/services/postgres/error-mapping'
import { PostgresDb } from '../../../effects/services/postgres/postgres-db.service'
import { Sentry } from '../../../instrument'
import {
	getSessionAccessControlLevel,
	hasRequiredSessionAccess,
	SessionAccessControl,
} from '../../../lib/session-multiplayer-prompting-auth'
import { effectOrpcBaseOrganizationRequired, requiresBillingEffectMiddleware } from '../../effect-base'
import { ORPCForbiddenError, ORPCNotFoundError, ORPCQueuedMessageUpdateFailedError } from '../../effect-errors'

export const updateQueuedMessageEffectProcedure = effectOrpcBaseOrganizationRequired.sessions.queuedMessages.update
	.use(requiresBillingEffectMiddleware)
	.effect(function* ({ input, context, errors }) {
		const postgres = yield* PostgresDb
		const nowMillis = yield* Clock.currentTimeMillis
		const { organizationId, userId } = context.auth
		const operation = 'queued_messages.update'
		const observabilityContext = {
			organizationId,
			sessionId: input.sessionId,
			queuedMessageId: input.queuedMessageId,
			userId,
		}

		const updateResult = yield* postgres
			.transaction((tx) =>
				Effect.gen(function* () {
					const [session] = yield* tx.query(
						tx.client
							.select({
								id: sessions.id,
								organization_id: sessions.organization_id,
								status: sessions.status,
								task_id: sessions.task_id,
								resource_owner_user_id: sessions.resource_owner_user_id,
								created_by: sessions.created_by,
							})
							.from(sessions)
							.where(and(eq(sessions.id, input.sessionId), eq(sessions.organization_id, organizationId)))
							.limit(1),
					)

					if (!session) return yield* new ORPCNotFoundError()

					// Editing a queued message is prompt-level, like interrupt: the session
					// creator, or any active Multiplayer Prompting collaborator, may manage the
					// shared queue. no_access stays a 404 to hide the session's existence.
					const accessLevel = yield* getSessionAccessControlLevel(
						tx,
						{ organizationId, sessionId: input.sessionId, actorUserId: userId },
						nowMillis,
					)
					if (accessLevel === SessionAccessControl.noAccess) return yield* new ORPCNotFoundError()
					if (!hasRequiredSessionAccess(accessLevel, SessionAccessControl.prompt)) {
						return yield* new ORPCForbiddenError()
					}

					const [updated] = yield* tx.query(
						tx.client
							.update(queuedMessages)
							.set({ content: input.text })
							.where(
								and(
									eq(queuedMessages.id, input.queuedMessageId),
									eq(queuedMessages.session_id, input.sessionId),
									eq(queuedMessages.organization_id, organizationId),
									eq(queuedMessages.status, 'pending'),
								),
							)
							.returning({ id: queuedMessages.id }),
					)

					if (!updated) {
						const [existing] = yield* tx.query(
							tx.client
								.select({ id: queuedMessages.id })
								.from(queuedMessages)
								.where(
									and(
										eq(queuedMessages.id, input.queuedMessageId),
										eq(queuedMessages.session_id, input.sessionId),
										eq(queuedMessages.organization_id, organizationId),
									),
								)
								.limit(1),
						)

						if (existing) {
							return yield* new ORPCQueuedMessageUpdateFailedError({
								data: { reason: 'already_delivered' },
							})
						}
						return yield* new ORPCNotFoundError()
					}

					const transactionId = yield* tx.run(() => getTxId(tx.client))
					yield* Effect.logInfo('Queued message updated').pipe(
						Effect.annotateLogs({ ...observabilityContext, operation }),
					)
					return { success: true, transactionId }
				}),
			)
			.pipe(
				Effect.catchTags({
					PostgresDbQueryError: (error) =>
						Effect.logError('Failed to update queued message', error).pipe(
							Effect.annotateLogs({ ...observabilityContext, operation }),
							Effect.andThen(
								Effect.sync(() =>
									Sentry.captureException(error, {
										tags: { error_type: 'postgres_query', operation },
										extra: observabilityContext,
									}),
								),
							),
							Effect.andThen(Effect.fail(error)),
						),
					PostgresDbTransactionError: (error) =>
						Effect.logError('Failed to update queued message transaction', error).pipe(
							Effect.annotateLogs({ ...observabilityContext, operation }),
							Effect.andThen(
								Effect.sync(() =>
									Sentry.captureException(error, {
										tags: { error_type: 'postgres_transaction', operation },
										extra: observabilityContext,
									}),
								),
							),
							Effect.andThen(Effect.fail(error)),
						),
				}),
				Effect.catchTags({
					SessionDoesNotExistError: () => Effect.fail(new ORPCNotFoundError()),
					PostgresDbQueryError: (error) => mapPostgresErrorToResponse(error, errors),
					PostgresDbTransactionError: (error) => mapPostgresErrorToResponse(error, errors),
				}),
			)

		return updateResult
	})
