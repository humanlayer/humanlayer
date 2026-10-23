import { queuedMessages } from '@humanlayer/db/tables/queued-messages'
import type { SessionStatus } from '@humanlayer/db/tables/sessions'
import { sessions } from '@humanlayer/db/tables/sessions'
import { and, eq } from 'drizzle-orm'
import { Clock, Effect } from 'effect'
import { uuidv7 } from 'uuidv7'

import { getTxId } from '../../../db/get-tx-id'
import { ACTIVE_SESSION_STATUSES } from '../../../db/session-statuses'
import { mapPostgresErrorToResponse } from '../../../effects/services/postgres/error-mapping'
import { PostgresDb } from '../../../effects/services/postgres/postgres-db.service'
import { resolveUserDisplayName } from '../../../effects/services/workos/display-name'
import { Sentry } from '../../../instrument'
import {
	getSessionPromptingAccess,
	hasRequiredSessionAccess,
	SessionAccessControl,
} from '../../../lib/session-multiplayer-prompting-auth'
import { effectOrpcBaseOrganizationRequired } from '../../effect-base'
import { ORPCBadRequestError, ORPCForbiddenError, ORPCNotFoundError } from '../../effect-errors'

/**
 * Interrupt a running session, optionally with a new message.
 *
 * Authorization: User must be session creator AND have edit access (via task ACL or session ownership if no task)
 * Precondition: Session must be in an active status (running, needs_approval, launching, resuming)
 *
 * When `message` is provided, the procedure inserts a flagged queue row
 * (`deliver_on_interrupt = true`) instead of writing `sessions.prompt`.
 * The daemon report handler drains flagged rows with attribution when it
 * receives the `interrupted` report. A Sentry event tracks usage of the
 * legacy `message` param to gate its eventual removal from the contract.
 */
export const interruptSessionProcedure = effectOrpcBaseOrganizationRequired.sessions.interrupt.effect(function* ({
	input,
	context,
	errors,
}) {
	const postgres = yield* PostgresDb
	const nowMillis = yield* Clock.currentTimeMillis
	const { sessionId, message } = input
	const { userId, organizationId } = context.auth
	const operation = 'sessions.interrupt'
	const observabilityContext = { sessionId, userId }

	return yield* postgres
		.transaction((tx) =>
			Effect.gen(function* () {
				const [session] = yield* tx.query(
					tx.client
						.select({
							id: sessions.id,
							task_id: sessions.task_id,
							resource_owner_user_id: sessions.resource_owner_user_id,
							created_by: sessions.created_by,
							status: sessions.status,
						})
						.from(sessions)
						.where(and(eq(sessions.id, sessionId), eq(sessions.organization_id, organizationId)))
						.limit(1)
						.for('no key update'),
				)

				if (!session) return yield* new ORPCNotFoundError()

				if (!ACTIVE_SESSION_STATUSES.includes(session.status as SessionStatus)) {
					return yield* new ORPCBadRequestError()
				}

				const { accessLevel, multiplayerPromptingActive } = yield* getSessionPromptingAccess(
					tx,
					{ organizationId, sessionId, actorUserId: userId },
					nowMillis,
				)
				if (!hasRequiredSessionAccess(accessLevel, SessionAccessControl.prompt)) {
					return yield* new ORPCForbiddenError()
				}

				if (message) {
					const authorDisplayName = multiplayerPromptingActive ? yield* resolveUserDisplayName(userId) : null
					yield* tx.query(
						tx.client.insert(queuedMessages).values({
							id: uuidv7(),
							session_id: sessionId,
							task_id: session.task_id,
							organization_id: organizationId,
							resource_owner_user_id: session.resource_owner_user_id,
							user_id: userId,
							author_display_name: authorDisplayName,
							multiplayer_prompting_active: multiplayerPromptingActive,
							content: message,
							status: 'pending',
							deliver_on_interrupt: true,
						}),
					)
					yield* Effect.logWarning('legacy sessions.interrupt message param used').pipe(
						Effect.annotateLogs(observabilityContext),
					)
					yield* Effect.sync(() =>
						Sentry.captureMessage('legacy sessions.interrupt message param used', {
							tags: { operation },
							extra: observabilityContext,
						}),
					)
				}

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
				yield* Effect.logInfo('sessions.interrupt completed').pipe(
					Effect.annotateLogs({ ...observabilityContext, hasMessage: !!message }),
				)
				return { success: true, transactionId: txid }
			}),
		)
		.pipe(
			Effect.catchTags({
				PostgresDbQueryError: (error) =>
					Effect.logError('sessions.interrupt failed', error).pipe(
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
					Effect.logError('sessions.interrupt transaction failed', error).pipe(
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
			Effect.catchTag('SessionDoesNotExistError', () => Effect.fail(new ORPCNotFoundError())),
			Effect.catchTags({
				PostgresDbQueryError: (error) => mapPostgresErrorToResponse(error, errors),
				PostgresDbTransactionError: (error) => mapPostgresErrorToResponse(error, errors),
			}),
		)
})
