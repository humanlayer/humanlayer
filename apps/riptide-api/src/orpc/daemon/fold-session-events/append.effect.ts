import { isDeepStrictEqual } from 'node:util'

import { foldSessionEvents } from '@humanlayer/db/tables/fold-session-events'
import { sessions } from '@humanlayer/db/tables/sessions'
import { and, desc, eq } from 'drizzle-orm'
import { Effect } from 'effect'

import { canWriteTaskForSession } from '../../../db/task-auth'
import { mapPostgresErrorToResponse } from '../../../effects/services/postgres/error-mapping'
import { PostgresDb } from '../../../effects/services/postgres/postgres-db.service'
import { stripNullBytes } from '../../../lib/strip-null-bytes'
import { effectOrpcDaemonBase, requiresDaemonBillingEffectMiddleware } from '../../effect-base'

/**
 * Appends one Fold event only when it is the session's exact next sequence.
 * Locking the parent session serializes daemon replacement races without exposing
 * direct database access to the daemon.
 */
export const appendFoldSessionEventProcedure = effectOrpcDaemonBase.foldSessionEvents.append
	.use(requiresDaemonBillingEffectMiddleware)
	.effect(function* ({ input, context, errors }) {
		const postgres = yield* PostgresDb
		const { userId, organizationId, hostId } = context.auth

		// Postgres JSONB rejects U+0000. Strip on values, not on serialized text: coding
		// agents legitimately emit the literal text `backslash-u0000` in tool output (see
		// lib/strip-null-bytes.ts). Sanitize once up front so the replay comparison below
		// sees the same shape that was persisted.
		const sanitizedEvent = stripNullBytes(input.entry.event)

		const appendResult = yield* postgres
			.transaction((tx) =>
				Effect.gen(function* () {
					const [session] = yield* tx.query(
						tx.client
							.select({
								id: sessions.id,
								task_id: sessions.task_id,
								created_by: sessions.created_by,
								resource_owner_user_id: sessions.resource_owner_user_id,
								host_id: sessions.host_id,
							})
							.from(sessions)
							.where(and(eq(sessions.id, input.sessionId), eq(sessions.organization_id, organizationId)))
							.limit(1)
							.for('no key update'),
					)

					if (!session) {
						return yield* Effect.fail(errors.NOT_FOUND())
					}
					if (session.host_id !== hostId || session.created_by !== userId) {
						return yield* Effect.fail(errors.FORBIDDEN())
					}

					// canWriteTaskForSession is the shared legacy ACL seam and performs selects only.
					const canWrite = yield* tx.run(() =>
						canWriteTaskForSession(tx.client, session, userId, organizationId),
					)
					if (!canWrite) {
						return yield* Effect.fail(errors.FORBIDDEN())
					}

					const [latestEntry] = yield* tx.query(
						tx.client
							.select({ seq: foldSessionEvents.seq })
							.from(foldSessionEvents)
							.where(eq(foldSessionEvents.session_id, input.sessionId))
							.orderBy(desc(foldSessionEvents.seq))
							.limit(1),
					)

					const nextSequence = (latestEntry?.seq ?? -1) + 1
					if (input.entry.seq !== nextSequence) {
						let existingEntry:
							| { seq: number; eventId: string; ts: number; event: typeof input.entry.event }
							| undefined
						if (input.entry.seq < nextSequence) {
							const [matchingEntry] = yield* tx.query(
								tx.client
									.select({
										seq: foldSessionEvents.seq,
										eventId: foldSessionEvents.event_id,
										ts: foldSessionEvents.ts,
										event: foldSessionEvents.event,
									})
									.from(foldSessionEvents)
									.where(
										and(
											eq(foldSessionEvents.session_id, input.sessionId),
											eq(foldSessionEvents.seq, input.entry.seq),
										),
									)
									.limit(1),
							)
							existingEntry = matchingEntry
						}
						if (
							existingEntry?.eventId === input.entry.eventId &&
							existingEntry.ts === input.entry.ts &&
							isDeepStrictEqual(existingEntry.event, sanitizedEvent)
						) {
							return { entry: existingEntry.event, alreadyPersisted: true }
						}
						yield* Effect.logWarning('Fold session event append sequence mismatch').pipe(
							Effect.annotateLogs({
								organizationId,
								sessionId: input.sessionId,
								submittedSeq: input.entry.seq,
								expectedSeq: nextSequence,
								submittedEventId: input.entry.eventId,
								existingEventId: existingEntry?.eventId,
								isReplay: existingEntry !== undefined,
							}),
						)
						return yield* Effect.fail(
							errors.BAD_REQUEST({ data: { message: `Expected Fold event sequence ${nextSequence}` } }),
						)
					}

					yield* tx.query(
						tx.client.insert(foldSessionEvents).values({
							session_id: input.sessionId,
							seq: input.entry.seq,
							event_id: input.entry.eventId,
							ts: input.entry.ts,
							event: sanitizedEvent,
						}),
					)

					return { entry: sanitizedEvent, alreadyPersisted: false }
				}),
			)
			.pipe(
				Effect.tap((result) =>
					Effect.logInfo(
						result.alreadyPersisted
							? 'Fold session event append replay accepted'
							: 'Fold session event appended',
					).pipe(
						Effect.annotateLogs({
							organizationId,
							sessionId: input.sessionId,
							seq: input.entry.seq,
							eventId: input.entry.eventId,
						}),
					),
				),
				Effect.tapError((error) => Effect.logError(error)),
				Effect.catchTags({
					PostgresDbQueryError: (error) => mapPostgresErrorToResponse(error, errors),
					PostgresDbTransactionError: (error) => mapPostgresErrorToResponse(error, errors),
				}),
			)

		return { entry: appendResult.entry }
	})
