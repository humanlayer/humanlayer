import { sessionUsageEvents } from '@humanlayer/db/tables/session-usage-events'
import { sessions } from '@humanlayer/db/tables/sessions'
import { and, eq } from 'drizzle-orm'
import { Effect } from 'effect'

import { canWriteTaskForSession } from '../../../../db/task-auth'
import { mapPostgresErrorToResponse } from '../../../../effects/services/postgres/error-mapping'
import { PostgresDb } from '../../../../effects/services/postgres/postgres-db.service'
import { Sentry } from '../../../../instrument'
import {
	effectOrpcDaemonBase,
	isExpectedClientError,
	requiresDaemonBillingEffectMiddleware,
} from '../../../effect-base'

/**
 * Conventional token-map keys hoisted into integer columns for indexed SQL
 * aggregation (see the session_usage_events table doc). Non-conventional keys
 * (e.g. reasoning_tokens) stay in the jsonb map only.
 */
const hoist = (tokens: Record<string, number>) => ({
	input_tokens: tokens.input_tokens ?? 0,
	output_tokens: tokens.output_tokens ?? 0,
	cache_read_tokens: tokens.cache_read_input_tokens ?? 0,
	cache_creation_tokens: tokens.cache_creation_input_tokens ?? 0,
})

/**
 * Record one run's token usage as append-only rows (one per model).
 *
 * Idempotent on (session_id, report_key, model): the daemon's oRPC client
 * retries with an identical payload, so replays insert nothing and return
 * recorded: 0. Rows are immutable — this procedure never updates.
 *
 * Authorization matches events/create: daemon must be running the session
 * (host_id), and the user must have write permission via the task ACL.
 *
 * Deliberately does NOT touch last_activity_at/num_events — usage reports
 * are not conversation activity. No transactionId in the output — the table
 * is not Electric-synced.
 */
export const recordSessionUsageEffectProcedure = effectOrpcDaemonBase.sessions.usage.record
	.use(requiresDaemonBillingEffectMiddleware)
	.effect(function* ({ input, context, errors }) {
		const postgres = yield* PostgresDb
		const { userId, organizationId, hostId } = context.auth

		const recorded = yield* postgres
			.transaction((tx) =>
				Effect.gen(function* () {
					// 1. Fetch session with auth-relevant fields (+ denormalization fields)
					const [session] = yield* tx.query(
						tx.client
							.select({
								id: sessions.id,
								task_id: sessions.task_id,
								created_by: sessions.created_by,
								resource_owner_user_id: sessions.resource_owner_user_id,
								host_id: sessions.host_id,
								coding_agent: sessions.coding_agent,
							})
							.from(sessions)
							.where(and(eq(sessions.id, input.sessionId), eq(sessions.organization_id, organizationId)))
							.limit(1)
							.for('no key update'),
					)

					if (!session) {
						return yield* Effect.fail(errors.NOT_FOUND())
					}

					// 2. Verify daemon is running this session (host_id check)
					if (session.host_id !== hostId || session.created_by !== userId) {
						return yield* Effect.fail(errors.FORBIDDEN())
					}

					// 3. Task ACL / ownership
					const canWrite = yield* tx.run(() =>
						canWriteTaskForSession(tx.client, session, userId, organizationId),
					)
					if (!canWrite) {
						return yield* Effect.fail(errors.FORBIDDEN())
					}

					// 4. Append-only insert, idempotent on (session_id, report_key, model)
					const inserted = yield* tx.query(
						tx.client
							.insert(sessionUsageEvents)
							.values(
								input.entries.map((entry) => ({
									session_id: input.sessionId,
									organization_id: organizationId,
									resource_owner_user_id: session.resource_owner_user_id,
									session_creator_user_id: session.created_by,
									task_id: session.task_id,
									coding_agent: session.coding_agent,
									source: input.source,
									report_key: input.reportKey,
									model: entry.model,
									tokens: entry.tokens,
									...hoist(entry.tokens),
									cost_usd: entry.costUsd,
									occurred_at: BigInt(input.occurredAt),
								})),
							)
							.onConflictDoNothing()
							.returning({ id: sessionUsageEvents.id }),
					)

					return inserted.length
				}),
			)
			.pipe(
				Effect.tap((count) =>
					Effect.logInfo('Session usage recorded').pipe(
						Effect.annotateLogs({ sessionId: input.sessionId, userId, recorded: count }),
					),
				),
				// Only log/report genuine server faults; expected client errors (NOT_FOUND,
				// FORBIDDEN) are handled by the base and must not reach Sentry.
				Effect.tapError((e) => (isExpectedClientError(e) ? Effect.void : Effect.logError(e))),
				Effect.tapError((e) =>
					isExpectedClientError(e) ? Effect.void : Effect.sync(() => Sentry.captureException(e)),
				),
				Effect.catchTags({
					PostgresDbQueryError: (error) => mapPostgresErrorToResponse(error, errors),
					PostgresDbTransactionError: (error) => mapPostgresErrorToResponse(error, errors),
				}),
			)

		return { recorded }
	})
