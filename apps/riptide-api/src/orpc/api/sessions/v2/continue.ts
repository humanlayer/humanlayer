import { conversationEvents } from '@humanlayer/db/tables/conversation-events'
import { queuedMessages } from '@humanlayer/db/tables/queued-messages'
import { sessions } from '@humanlayer/db/tables/sessions'
import { userSettings } from '@humanlayer/db/tables/user-settings'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { Clock, Effect } from 'effect'
import { uuidv7 } from 'uuidv7'

import { getTxId } from '../../../../db/get-tx-id'
import { isSessionActive } from '../../../../db/session-statuses'
import { mapPostgresErrorToResponse } from '../../../../effects/services/postgres/error-mapping'
import { PostgresDb } from '../../../../effects/services/postgres/postgres-db.service'
import { resolveUserDisplayName } from '../../../../effects/services/workos/display-name'
import { Sentry } from '../../../../instrument'
import {
	getSessionPromptingAccess,
	hasRequiredSessionAccess,
	SessionAccessControl,
} from '../../../../lib/session-multiplayer-prompting-auth'
import { buildAttributedPrompt } from '../../../../lib/session-prompt-attribution'
import { effectOrpcBaseOrganizationRequired, requiresBillingEffectMiddleware } from '../../../effect-base'

export const continueSessionV2Procedure = effectOrpcBaseOrganizationRequired.sessions.v2.continue
	.use(requiresBillingEffectMiddleware)
	.effect(function* ({ input, context, errors }) {
		const postgres = yield* PostgresDb
		const nowMillis = yield* Clock.currentTimeMillis
		const { organizationId, userId } = context.auth
		const { sessionId, messageId, eventId, text, intent } = input
		const operation = 'sessions.v2.continue'
		const observabilityContext = { sessionId, userId, intent }

		return yield* postgres
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
							.where(and(eq(sessions.id, sessionId), eq(sessions.organization_id, organizationId)))
							.limit(1)
							.for('no key update'),
					)

					if (!session) {
						yield* Effect.logInfo('sessions.v2.continue rejected').pipe(
							Effect.annotateLogs({ ...observabilityContext, sessionStatus: null, reason: 'not_found' }),
						)
						return { kind: 'rejected' as const, reason: 'not_found' as const }
					}

					const { accessLevel, multiplayerPromptingActive } = yield* getSessionPromptingAccess(
						tx,
						{ organizationId, sessionId, actorUserId: userId },
						nowMillis,
					)
					if (!hasRequiredSessionAccess(accessLevel, SessionAccessControl.prompt)) {
						yield* Effect.logInfo('sessions.v2.continue rejected').pipe(
							Effect.annotateLogs({
								...observabilityContext,
								sessionStatus: session.status,
								reason: 'forbidden',
							}),
						)
						return { kind: 'rejected' as const, reason: 'forbidden' as const }
					}
					const authorDisplayName = multiplayerPromptingActive ? yield* resolveUserDisplayName(userId) : null

					// Active session with interrupt-and-send: insert a flagged queue row
					// and flip status to interrupt_requested. The drain in daemon
					// sessions.update delivers the flagged row with attribution when the
					// daemon reports 'interrupted'.
					if (intent === 'interrupt_and_send' && isSessionActive(session.status)) {
						yield* tx.query(
							tx.client.insert(queuedMessages).values({
								id: messageId ?? uuidv7(),
								session_id: sessionId,
								task_id: session.task_id,
								organization_id: organizationId,
								resource_owner_user_id: session.resource_owner_user_id,
								user_id: userId,
								author_display_name: authorDisplayName,
								multiplayer_prompting_active: multiplayerPromptingActive,
								content: text,
								status: 'pending',
								deliver_on_interrupt: true,
							}),
						)
						yield* tx.query(
							tx.client
								.update(sessions)
								.set({
									status: 'interrupt_requested',
									archived: false,
									last_activity_at: BigInt(nowMillis),
								})
								.where(eq(sessions.id, sessionId)),
						)
						const txid = yield* tx.run(() => getTxId(tx.client))
						yield* Effect.logInfo('sessions.v2.continue interrupt_and_send via queue').pipe(
							Effect.annotateLogs(observabilityContext),
						)
						return { kind: 'continued' as const, transactionId: txid }
					}

					// Session is still working — both 'queue' and 'send' just append to the
					// queue and let the daemon drain it on completion. Only 'interrupt_and_send'
					// on an active session triggers the early-return above.
					const shouldEnqueueMessage =
						(intent === 'queue' || intent === 'send') && isSessionActive(session.status)

					if (shouldEnqueueMessage) {
						yield* tx.query(
							tx.client.insert(queuedMessages).values({
								id: messageId ?? uuidv7(),
								session_id: sessionId,
								task_id: session.task_id,
								organization_id: organizationId,
								resource_owner_user_id: session.resource_owner_user_id,
								user_id: userId,
								author_display_name: authorDisplayName,
								multiplayer_prompting_active: multiplayerPromptingActive,
								content: text,
								status: 'pending',
							}),
						)
						const txid = yield* tx.run(() => getTxId(tx.client))
						yield* Effect.logInfo('sessions.v2.continue queued').pipe(
							Effect.annotateLogs(observabilityContext),
						)
						return { kind: 'queued' as const, transactionId: txid }
					}

					// --- Idle-session drain path (resuming) ---
					// Honor the user's queue-delivery preference: batch (default) drains all
					// pending messages into a single resuming prompt; one-at-a-time sends
					// only the user's new text and leaves pending messages for the daemon to
					// drain one per ready_for_input cycle.
					const [userSettingsRow] = yield* tx.query(
						tx.client
							.select({ prefer_batch_queue_delivery: userSettings.prefer_batch_queue_delivery })
							.from(userSettings)
							.where(
								and(
									eq(userSettings.user_id, session.resource_owner_user_id),
									eq(userSettings.organization_id, organizationId),
								),
							)
							.limit(1),
					)

					const batchDelivery = userSettingsRow?.prefer_batch_queue_delivery ?? true

					const pending = batchDelivery
						? yield* tx.query(
								tx.client
									.select({
										id: queuedMessages.id,
										content: queuedMessages.content,
										user_id: queuedMessages.user_id,
										author_display_name: queuedMessages.author_display_name,
										multiplayer_prompting_active: queuedMessages.multiplayer_prompting_active,
									})
									.from(queuedMessages)
									.where(
										and(
											eq(queuedMessages.organization_id, organizationId),
											eq(queuedMessages.resource_owner_user_id, session.resource_owner_user_id),
											eq(queuedMessages.session_id, sessionId),
											eq(queuedMessages.status, 'pending'),
										),
									)
									.orderBy(asc(queuedMessages.created_at)),
							)
						: []

					// Event ids match the client's optimistic row and each drained queued row, so the
					// UI can reconcile them before the sessions and queued-messages shapes catch up.
					const allMessages = [
						{
							eventId: eventId ?? uuidv7(),
							content: text,
							authorUserId: userId,
							authorDisplayName,
							multiplayerPromptingActive,
						},
						...pending.map((message) => ({
							eventId: message.id,
							content: message.content,
							authorUserId: message.user_id,
							authorDisplayName: message.author_display_name,
							multiplayerPromptingActive: message.multiplayer_prompting_active,
						})),
					]
					const concatenatedPrompt = buildAttributedPrompt(allMessages)

					if (pending.length > 0) {
						yield* tx.query(
							tx.client
								.update(queuedMessages)
								.set({ status: 'delivered', updated_at: BigInt(nowMillis) })
								.where(
									inArray(
										queuedMessages.id,
										pending.map((message) => message.id),
									),
								),
						)
					}

					// Drained events reuse older queued ids, so created_at alone carries the prompt order.
					for (const [position, message] of allMessages.entries()) {
						yield* tx.query(
							tx.client.insert(conversationEvents).values({
								id: message.eventId,
								created_at: BigInt(nowMillis + position),
								session_id: sessionId,
								organization_id: organizationId,
								resource_owner_user_id: session.resource_owner_user_id,
								task_id: session.task_id,
								event_type: 'message',
								role: 'user',
								content: message.content,
								user_id: message.authorUserId,
							}),
						)
					}

					yield* tx.query(
						tx.client
							.update(sessions)
							.set({
								status: 'resuming',
								error_message: session.status === 'lost' ? null : sql`${sessions.error_message}`,
								error_reason: session.status === 'lost' ? null : sql`${sessions.error_reason}`,
								prompt: concatenatedPrompt,
								archived: false,
								last_activity_at: BigInt(nowMillis),
								num_events: sql`${sessions.num_events} + ${allMessages.length}`,
							})
							.where(eq(sessions.id, sessionId)),
					)

					const txid = yield* tx.run(() => getTxId(tx.client))
					yield* Effect.logInfo('Auto-continuing session with queued messages').pipe(
						Effect.annotateLogs({
							...observabilityContext,
							messageCount: pending.length,
							newPromptIncluded: true,
							batchDelivery,
						}),
					)
					return { kind: 'continued' as const, transactionId: txid }
				}),
			)
			.pipe(
				Effect.catchTags({
					PostgresDbQueryError: (error) =>
						Effect.logError('sessions.v2.continue failed', error).pipe(
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
						Effect.logError('sessions.v2.continue transaction failed', error).pipe(
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
				// SessionDoesNotExistError from the access-control query can surface
				// when the session vanishes between the FOR UPDATE lock and the ACL
				// join (rare but possible under concurrent deletes). Treat as not_found.
				Effect.catchTag('SessionDoesNotExistError', () =>
					Effect.succeed({ kind: 'rejected' as const, reason: 'not_found' as const }),
				),
				Effect.catchTags({
					PostgresDbQueryError: (error) => mapPostgresErrorToResponse(error, errors),
					PostgresDbTransactionError: (error) => mapPostgresErrorToResponse(error, errors),
				}),
			)
	})
