import { conversationEvents } from '@humanlayer/db/tables/conversation-events'
import { queuedMessages } from '@humanlayer/db/tables/queued-messages'
import { sessions } from '@humanlayer/db/tables/sessions'
import { userSettings } from '@humanlayer/db/tables/user-settings'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { Clock, Effect } from 'effect'

import { getTxId } from '../../../db/get-tx-id'
import { isSessionActive } from '../../../db/session-statuses'
import { mapPostgresErrorToResponse } from '../../../effects/services/postgres/error-mapping'
import { PostgresDb } from '../../../effects/services/postgres/postgres-db.service'
import { Sentry } from '../../../instrument'
import {
	getSessionAccessControlLevel,
	hasRequiredSessionAccess,
	SessionAccessControl,
} from '../../../lib/session-multiplayer-prompting-auth'
import { buildAttributedPrompt } from '../../../lib/session-prompt-attribution'
import { effectOrpcBaseOrganizationRequired, requiresBillingEffectMiddleware } from '../../effect-base'
import { ORPCForbiddenError, ORPCNotFoundError, ORPCQueuedMessageSendFailedError } from '../../effect-errors'

export const sendNowQueuedMessageEffectProcedure = effectOrpcBaseOrganizationRequired.sessions.queuedMessages.sendNow
	.use(requiresBillingEffectMiddleware)
	.effect(function* ({ input, context, errors }) {
		const postgres = yield* PostgresDb
		const nowMillis = yield* Clock.currentTimeMillis
		const { userId, organizationId } = context.auth
		const operation = 'queued_messages.send_now'
		const observabilityContext = {
			organizationId,
			sessionId: input.sessionId,
			queuedMessageId: input.queuedMessageId,
			userId,
		}

		const sendNowResult = yield* postgres
			.transaction((tx) =>
				Effect.gen(function* () {
					// pull the session so we can ensure that it exists & the user has access
					const [sessionToSendQueuedMessagesInto] = yield* tx.query(
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

					// no read access -> 404
					if (!sessionToSendQueuedMessagesInto) return yield* new ORPCNotFoundError()

					// Interrupt-and-send-now is prompt-level, like interrupt: the session
					// creator, or any active Multiplayer Prompting collaborator, may deliver a
					// queued message. Read-but-not-prompt is a 403; no read access stays a 404.
					const accessLevel = yield* getSessionAccessControlLevel(
						tx,
						{ organizationId, sessionId: input.sessionId, actorUserId: userId },
						nowMillis,
					)
					if (accessLevel === SessionAccessControl.noAccess) return yield* new ORPCNotFoundError()
					if (!hasRequiredSessionAccess(accessLevel, SessionAccessControl.prompt)) {
						return yield* new ORPCForbiddenError()
					}

					// pull user settings so we can respect the user's batch-delivery preferences
					const [userSettingsRow] = yield* tx.query(
						tx.client
							.select({ prefer_batch_queue_delivery: userSettings.prefer_batch_queue_delivery })
							.from(userSettings)
							.where(
								and(
									eq(userSettings.user_id, sessionToSendQueuedMessagesInto.resource_owner_user_id),
									eq(userSettings.organization_id, organizationId),
								),
							)
							.limit(1),
					)
					const batchDelivery = userSettingsRow?.prefer_batch_queue_delivery ?? true
					const queuedMessageConditions = [
						eq(queuedMessages.organization_id, organizationId),
						eq(
							queuedMessages.resource_owner_user_id,
							sessionToSendQueuedMessagesInto.resource_owner_user_id,
						),
						eq(queuedMessages.session_id, input.sessionId),
						eq(queuedMessages.status, 'pending'),
					]
					if (!batchDelivery) queuedMessageConditions.push(eq(queuedMessages.id, input.queuedMessageId))

					// look up the queued message(s) to deliver
					const queuedMessagesToDeliver = yield* tx.query(
						tx.client
							.select({
								id: queuedMessages.id,
								content: queuedMessages.content,
								user_id: queuedMessages.user_id,
								author_display_name: queuedMessages.author_display_name,
								multiplayer_prompting_active: queuedMessages.multiplayer_prompting_active,
								created_at: queuedMessages.created_at,
							})
							.from(queuedMessages)
							.where(and(...queuedMessageConditions))
							.orderBy(asc(queuedMessages.created_at)),
					)

					if (queuedMessagesToDeliver.length === 0) {
						return yield* new ORPCQueuedMessageSendFailedError({ data: { reason: 'already_delivered' } })
					}

					// join messages if there are multiple based on batch delivery preferences
					const isSessionCurrentlyActive = isSessionActive(sessionToSendQueuedMessagesInto.status)
					const now = BigInt(nowMillis)

					if (isSessionCurrentlyActive) {
						// Flag rows for interrupt delivery — the daemon report handler's
						// interrupt drain will deliver them as attributed conversation events.
						// No prompt write, no num_events bump; the drain handles both.
						yield* tx.query(
							tx.client
								.update(queuedMessages)
								.set({ deliver_on_interrupt: true })
								.where(
									inArray(
										queuedMessages.id,
										queuedMessagesToDeliver.map((r) => r.id),
									),
								),
						)
						yield* tx.query(
							tx.client
								.update(sessions)
								.set({
									status: 'interrupt_requested',
									archived: false,
									last_activity_at: now,
								})
								.where(eq(sessions.id, input.sessionId)),
						)
					} else {
						// Idle/interrupted/lost session: deliver directly with attributed events.
						const promptForDaemonResume = buildAttributedPrompt(
							queuedMessagesToDeliver.map((row) => ({
								content: row.content,
								authorDisplayName: row.author_display_name,
								multiplayerPromptingActive: row.multiplayer_prompting_active,
							})),
						)

						yield* tx.query(
							tx.client.insert(conversationEvents).values(
								queuedMessagesToDeliver.map((queuedMessageToDeliver) => ({
									id: queuedMessageToDeliver.id,
									session_id: input.sessionId,
									organization_id: organizationId,
									resource_owner_user_id: sessionToSendQueuedMessagesInto.resource_owner_user_id,
									task_id: sessionToSendQueuedMessagesInto.task_id,
									event_type: 'message' as const,
									role: 'user' as const,
									content: queuedMessageToDeliver.content,
									user_id: queuedMessageToDeliver.user_id,
								})),
							),
						)

						yield* tx.query(
							tx.client
								.update(sessions)
								.set({
									status: 'resuming',
									error_message:
										sessionToSendQueuedMessagesInto.status === 'lost'
											? null
											: sql`${sessions.error_message}`,
									prompt: promptForDaemonResume,
									archived: false,
									last_activity_at: now,
									num_events: sql`${sessions.num_events} + ${queuedMessagesToDeliver.length}`,
								})
								.where(eq(sessions.id, input.sessionId)),
						)

						yield* tx.query(
							tx.client
								.update(queuedMessages)
								.set({ status: 'delivered', updated_at: now })
								.where(
									inArray(
										queuedMessages.id,
										queuedMessagesToDeliver.map(
											(queuedMessageToDeliver) => queuedMessageToDeliver.id,
										),
									),
								),
						)
					}

					const transactionId = yield* tx.run(() => getTxId(tx.client))
					yield* Effect.logInfo('Queued message sent now').pipe(
						Effect.annotateLogs({
							...observabilityContext,
							batchDelivery,
							operation,
							branch: isSessionCurrentlyActive ? 'flaggedForInterrupt' : 'deliveredNow',
						}),
					)
					return { success: true, transactionId }
				}),
			)
			.pipe(
				Effect.catchTags({
					PostgresDbQueryError: (error) =>
						Effect.logError('Failed to send queued message now', error).pipe(
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
						Effect.logError('Failed to send queued message now transaction', error).pipe(
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

		return sendNowResult
	})
