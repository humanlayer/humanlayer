import { foldSessionEvents } from '@humanlayer/db/tables/fold-session-events'
import { sessions } from '@humanlayer/db/tables/sessions'
import { FoldSessionEventEntrySchema } from '@humanlayer/riptide-api-contract/daemon/fold-session-events'
import { and, asc, eq } from 'drizzle-orm'
import { Effect } from 'effect'

import { canWriteTaskForSession } from '../../../db/task-auth'
import { mapPostgresErrorToResponse } from '../../../effects/services/postgres/error-mapping'
import { PostgresDb } from '../../../effects/services/postgres/postgres-db.service'
import { Sentry } from '../../../instrument'
import { effectOrpcDaemonBase, requiresDaemonBillingEffectMiddleware } from '../../effect-base'

/** Lists one authorized session's canonical Fold entries in replay order. */
export const listFoldSessionEventsProcedure = effectOrpcDaemonBase.foldSessionEvents.list
	.use(requiresDaemonBillingEffectMiddleware)
	.effect(function* ({ input, context, errors }) {
		const postgres = yield* PostgresDb
		const { userId, organizationId, hostId } = context.auth

		const entries = yield* postgres
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
							.limit(1),
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

					const rows = yield* tx.query(
						tx.client
							.select({
								seq: foldSessionEvents.seq,
								eventId: foldSessionEvents.event_id,
								ts: foldSessionEvents.ts,
								event: foldSessionEvents.event,
							})
							.from(foldSessionEvents)
							.where(eq(foldSessionEvents.session_id, input.sessionId))
							.orderBy(asc(foldSessionEvents.seq)),
					)

					return rows.map((row) => FoldSessionEventEntrySchema.parse(row).event)
				}),
			)
			.pipe(
				Effect.tap((events) =>
					Effect.logInfo('Fold session events listed').pipe(
						Effect.annotateLogs({ organizationId, sessionId: input.sessionId, count: events.length }),
					),
				),
				Effect.tapError((error) => Effect.logError(error)),
				Effect.tapError((error) => Effect.sync(() => Sentry.captureException(error))),
				Effect.catchTags({
					PostgresDbQueryError: (error) => mapPostgresErrorToResponse(error, errors),
					PostgresDbTransactionError: (error) => mapPostgresErrorToResponse(error, errors),
				}),
			)

		return { entries }
	})
