import { queuedMessages } from '@humanlayer/db/tables/queued-messages'
import { sessions } from '@humanlayer/db/tables/sessions'
import { and, eq } from 'drizzle-orm'
import { Clock, Effect } from 'effect'
import { uuidv7 } from 'uuidv7'

import { getTxId } from '../../../db/get-tx-id'
import { ACTIVE_SESSION_STATUSES } from '../../../db/session-statuses'
import { canWriteTaskForSession } from '../../../db/task-auth'
import { mapPostgresErrorToResponse } from '../../../effects/services/postgres/error-mapping'
import { PostgresDb } from '../../../effects/services/postgres/postgres-db.service'
import { resolveUserDisplayName } from '../../../effects/services/workos/display-name'
import { Sentry } from '../../../instrument'
import {
	getSessionAccessControlLevel,
	getSessionPromptingAccess,
	hasRequiredSessionAccess,
	SessionAccessControl,
} from '../../../lib/session-multiplayer-prompting-auth'
import { effectOrpcBaseOrganizationRequired, requiresBillingEffectMiddleware } from '../../effect-base'
import { ORPCBadRequestError, ORPCForbiddenError, ORPCNotFoundError } from '../../effect-errors'

const QUEUE_ALLOWED_STATUSES = [...ACTIVE_SESSION_STATUSES] as const

export const createQueuedMessageEffectProcedure = effectOrpcBaseOrganizationRequired.sessions.queuedMessages.create
	.use(requiresBillingEffectMiddleware)
	.effect(function* ({ input, context, errors }) {
		const postgres = yield* PostgresDb
		const nowMillis = yield* Clock.currentTimeMillis
		const { userId, organizationId } = context.auth
		const operation = 'queued_messages.create'
		const observabilityContext = { organizationId, sessionId: input.sessionId, userId }

		yield* Effect.logWarning(
			'Legacy queuedMessages.create called — clients should migrate to sessions.v2.continue',
		).pipe(Effect.annotateLogs(observabilityContext))

		const result = yield* postgres
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
							.limit(1)
							.for('no key update'),
					)

					if (!session) {
						return yield* new ORPCNotFoundError()
					}

					// canWriteSession requires session.created_by === userId AND task write access
					if (session.created_by !== userId) {
						return yield* new ORPCForbiddenError()
					}

					const hasTaskWriteAccess = yield* tx.run(() =>
						canWriteTaskForSession(tx.client, session, userId, organizationId),
					)
					if (!hasTaskWriteAccess) {
						return yield* new ORPCForbiddenError()
					}

					if (!QUEUE_ALLOWED_STATUSES.includes(session.status as (typeof QUEUE_ALLOWED_STATUSES)[number])) {
						return yield* new ORPCBadRequestError({
							message: `Cannot queue message for session in status '${session.status}'`,
						})
					}

					const { multiplayerPromptingActive } = yield* getSessionPromptingAccess(
						tx,
						{ organizationId, sessionId: input.sessionId, actorUserId: userId },
						nowMillis,
					)
					const authorDisplayName = multiplayerPromptingActive ? yield* resolveUserDisplayName(userId) : null

					yield* tx.query(
						tx.client.insert(queuedMessages).values({
							id: input.messageId ?? uuidv7(),
							session_id: input.sessionId,
							task_id: session.task_id,
							organization_id: organizationId,
							resource_owner_user_id: session.resource_owner_user_id,
							user_id: userId,
							author_display_name: authorDisplayName,
							multiplayer_prompting_active: multiplayerPromptingActive,
							content: input.text,
							status: 'pending',
						}),
					)

					const transactionId = yield* tx.run(() => getTxId(tx.client))
					yield* Effect.logInfo('Queued message created').pipe(
						Effect.annotateLogs({ ...observabilityContext, operation }),
					)
					return { success: true, transactionId }
				}),
			)
			.pipe(
				Effect.tapError((e) => Effect.logError(e)),
				Effect.tapError((e) => Effect.sync(() => Sentry.captureException(e))),
				Effect.catchTags({
					SessionDoesNotExistError: () =>
						Effect.fail(errors.NOT_FOUND({ data: { message: 'Session not found' } })),
					ORPCNotFoundError: () => Effect.fail(errors.NOT_FOUND({ data: { message: 'Session not found' } })),
					ORPCForbiddenError: () =>
						Effect.fail(
							errors.FORBIDDEN({ data: { message: 'You do not have write access to this session' } }),
						),
					ORPCBadRequestError: (error) =>
						Effect.fail(errors.BAD_REQUEST({ data: { message: error.message } })),
					PostgresDbQueryError: (error) => mapPostgresErrorToResponse(error, errors),
					PostgresDbTransactionError: (error) => mapPostgresErrorToResponse(error, errors),
				}),
			)

		return result
	})

export const deleteQueuedMessageEffectProcedure = effectOrpcBaseOrganizationRequired.sessions.queuedMessages.delete
	.use(requiresBillingEffectMiddleware)
	.effect(function* ({ input, context, errors }) {
		const postgres = yield* PostgresDb
		const nowMillis = yield* Clock.currentTimeMillis
		const { userId, organizationId } = context.auth
		const operation = 'queued_messages.delete'
		const observabilityContext = {
			organizationId,
			sessionId: input.sessionId,
			queuedMessageId: input.queuedMessageId,
			userId,
		}

		const result = yield* postgres
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

					if (!session) {
						return yield* new ORPCNotFoundError()
					}

					// Removing a queued message is prompt-level, like interrupt: the session
					// creator, or any active Multiplayer Prompting collaborator, may manage the
					// shared queue. no_access stays a 404 to hide the session's existence.
					const accessLevel = yield* getSessionAccessControlLevel(
						tx,
						{ organizationId, sessionId: input.sessionId, actorUserId: userId },
						Number(nowMillis),
					)
					if (accessLevel === SessionAccessControl.noAccess) {
						return yield* new ORPCNotFoundError()
					}
					if (!hasRequiredSessionAccess(accessLevel, SessionAccessControl.prompt)) {
						return yield* new ORPCForbiddenError()
					}

					const [deleted] = yield* tx.query(
						tx.client
							.delete(queuedMessages)
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

					if (!deleted) {
						return yield* new ORPCNotFoundError()
					}

					const transactionId = yield* tx.run(() => getTxId(tx.client))
					yield* Effect.logInfo('Queued message deleted').pipe(
						Effect.annotateLogs({ ...observabilityContext, operation }),
					)
					return { success: true, transactionId }
				}),
			)
			.pipe(
				Effect.tapError((e) => Effect.logError(e)),
				Effect.tapError((e) => Effect.sync(() => Sentry.captureException(e))),
				Effect.catchTags({
					ORPCNotFoundError: () =>
						Effect.fail(
							errors.NOT_FOUND({ data: { message: 'Queued message not found or already delivered' } }),
						),
					ORPCForbiddenError: () =>
						Effect.fail(
							errors.FORBIDDEN({ data: { message: 'You do not have write access to this session' } }),
						),
					SessionDoesNotExistError: () =>
						Effect.fail(errors.NOT_FOUND({ data: { message: 'Session not found' } })),
					PostgresDbQueryError: (error) => mapPostgresErrorToResponse(error, errors),
					PostgresDbTransactionError: (error) => mapPostgresErrorToResponse(error, errors),
				}),
			)

		return result
	})
