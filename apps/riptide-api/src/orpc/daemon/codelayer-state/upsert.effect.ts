import { codelayerAgentState } from '@humanlayer/db/tables/codelayer-agent-state'
import { codelayerAgentStateSnapshots } from '@humanlayer/db/tables/codelayer-agent-state-snapshots'
import { conversationEvents } from '@humanlayer/db/tables/conversation-events'
import { sessions } from '@humanlayer/db/tables/sessions'
import { and, desc, eq, isNull, not, or, sql } from 'drizzle-orm'
import { Clock, Effect } from 'effect'

import { mapPostgresErrorToResponse } from '../../../effects/services/postgres/error-mapping'
import { PostgresDb } from '../../../effects/services/postgres/postgres-db.service'
import { nullByteReplacer } from '../../../lib/strip-null-bytes'
import { effectOrpcDaemonBase, requiresDaemonBillingEffectMiddleware } from '../../effect-base'

const SYNTHETIC_SKILL_PROMPT_PREFIX = 'Base directory for this skill:'
const REQUEST_INTERRUPTED_BY_USER_MARKER = 'request interrupted by user'

/**
 * Upsert codelayer agent state for a session.
 *
 * Authorization:
 * - Daemon must be authenticated (effectOrpcDaemonBase middleware handles this)
 * - Inserts a new row or updates the existing one on session_id conflict
 */
export const upsertCodelayerStateEffectProcedure = effectOrpcDaemonBase.codelayerState.upsert
	.use(requiresDaemonBillingEffectMiddleware)
	.effect(function* ({ input, context, errors }) {
		const postgres = yield* PostgresDb
		const { organizationId, userId, hostId } = context.auth

		yield* postgres
			.transaction((tx) =>
				Effect.gen(function* () {
					const [session] = yield* tx.query(
						tx.client
							.select({
								id: sessions.id,
								task_id: sessions.task_id,
								organization_id: sessions.organization_id,
								resource_owner_user_id: sessions.resource_owner_user_id,
								created_by: sessions.created_by,
								host_id: sessions.host_id,
							})
							.from(sessions)
							.where(and(eq(sessions.id, input.sessionId), eq(sessions.organization_id, organizationId)))
							.limit(1)
							.for('no key update'),
					)

					if (!session) return yield* Effect.fail(errors.NOT_FOUND())
					if (!session.organization_id) return yield* Effect.fail(errors.NOT_FOUND())
					if (session.created_by !== userId || session.host_id !== hostId) {
						return yield* Effect.fail(errors.FORBIDDEN())
					}

					const sanitizedStateJson = JSON.stringify(input.state, nullByteReplacer)

					yield* tx.query(
						tx.client
							.insert(codelayerAgentState)
							.values({
								session_id: input.sessionId,
								organization_id: session.organization_id,
								resource_owner_user_id: session.resource_owner_user_id,
								task_id: session.task_id,
								state: sql`${sanitizedStateJson}::jsonb` as never,
							})
							.onConflictDoUpdate({
								target: codelayerAgentState.session_id,
								set: {
									organization_id: session.organization_id,
									resource_owner_user_id: session.resource_owner_user_id,
									task_id: session.task_id,
									// Reuse the inserted JSONB value instead of serializing large state a second time.
									state: sql.raw('excluded.state'),
									updated_at: BigInt(yield* Clock.currentTimeMillis),
								},
							}),
					)

					const [rootUserEvent] = yield* tx.query(
						tx.client
							.select({ id: conversationEvents.id })
							.from(conversationEvents)
							.where(
								and(
									eq(conversationEvents.session_id, input.sessionId),
									eq(conversationEvents.event_type, 'message'),
									eq(conversationEvents.role, 'user'),
									isNull(conversationEvents.parent_tool_use_id),
									isNull(conversationEvents.run_index),
									or(
										isNull(conversationEvents.content),
										not(sql`${conversationEvents.content} ~ '^\\s*<local-command-stdout>'`),
									),
									or(
										isNull(conversationEvents.content),
										not(
											sql`${conversationEvents.content} LIKE ${`${SYNTHETIC_SKILL_PROMPT_PREFIX}%`}`,
										),
									),
									or(
										isNull(conversationEvents.content),
										not(
											sql`lower(${conversationEvents.content}) LIKE ${`%${REQUEST_INTERRUPTED_BY_USER_MARKER}%`}`,
										),
									),
								),
							)
							.orderBy(desc(conversationEvents.created_at), desc(conversationEvents.id))
							.limit(1),
					)

					if (!rootUserEvent) return { snapshotCreated: false }

					const [previousSnapshot] = yield* tx.query(
						tx.client
							.select({ runIndex: codelayerAgentStateSnapshots.run_index })
							.from(codelayerAgentStateSnapshots)
							.where(eq(codelayerAgentStateSnapshots.session_id, input.sessionId))
							.orderBy(desc(codelayerAgentStateSnapshots.run_index))
							.limit(1),
					)

					const runIndex = (previousSnapshot?.runIndex ?? -1) + 1

					yield* tx.query(
						tx.client.insert(codelayerAgentStateSnapshots).values({
							session_id: input.sessionId,
							organization_id: session.organization_id,
							resource_owner_user_id: session.resource_owner_user_id,
							task_id: session.task_id,
							run_index: runIndex,
							root_user_event_id: rootUserEvent.id,
							state: sql`${sanitizedStateJson}::jsonb` as never,
							tombstoned_at: null,
							tombstone_reason: null,
						}),
					)

					yield* tx.query(
						tx.client
							.update(conversationEvents)
							.set({ run_index: runIndex })
							.where(eq(conversationEvents.id, rootUserEvent.id)),
					)

					return { snapshotCreated: true }
				}),
			)
			.pipe(
				Effect.tap((result) =>
					Effect.logInfo('Codelayer agent state upserted').pipe(
						Effect.annotateLogs({
							sessionId: input.sessionId,
							userId,
							snapshotCreated: result.snapshotCreated,
						}),
					),
				),
				Effect.tapError((e) => Effect.logError(e)),
				Effect.catchTags({
					PostgresDbQueryError: (error) => mapPostgresErrorToResponse(error, errors),
					PostgresDbTransactionError: (error) => mapPostgresErrorToResponse(error, errors),
				}),
			)

		return {}
	})
