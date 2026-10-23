import { onlineHosts } from '@humanlayer/db/tables/online-hosts'
import { sessions } from '@humanlayer/db/tables/sessions'
import { and, eq, inArray } from 'drizzle-orm'
import { Effect } from 'effect'

import { rejectPendingApprovals } from '../../../db/reject-pending-approvals'
import { ACTIVE_SESSION_STATUSES } from '../../../db/session-statuses'
import { mapPostgresErrorToResponse } from '../../../effects/services/postgres/error-mapping'
import { PostgresDb } from '../../../effects/services/postgres/postgres-db.service'
import { Sentry } from '../../../instrument'
import { effectOrpcDaemonBase, requiresDaemonBillingEffectMiddleware } from '../../effect-base'

export const shutdownEffectProcedure = effectOrpcDaemonBase.hosts.shutdown
	.use(requiresDaemonBillingEffectMiddleware)
	.effect(function* ({ input, context, errors }) {
		const postgres = yield* PostgresDb
		const { hostId, reason } = input
		const { userId, organizationId, hostId: authHostId } = context.auth

		if (hostId !== authHostId) {
			return yield* Effect.fail(errors.FORBIDDEN())
		}

		const now = BigInt(Date.now())
		const errorMessage = reason ?? 'Session failed due to daemon shutdown'

		return yield* postgres
			.transaction((tx) =>
				Effect.gen(function* () {
					// Mark active sessions on this host as failed
					const failedSessions = yield* tx.query(
						tx.client
							.update(sessions)
							.set({
								status: 'failed',
								error_message: errorMessage,
								updated_at: now,
							})
							.where(
								and(
									eq(sessions.organization_id, organizationId),
									eq(sessions.host_id, hostId),
									eq(sessions.created_by, userId),
									inArray(sessions.status, ACTIVE_SESSION_STATUSES),
								),
							)
							.returning({ id: sessions.id }),
					)
					const interruptedSessions = yield* tx.query(
						tx.client
							.update(sessions)
							.set({ status: 'interrupted', updated_at: now })
							.where(
								and(
									eq(sessions.organization_id, organizationId),
									eq(sessions.host_id, hostId),
									eq(sessions.created_by, userId),
									eq(sessions.status, 'interrupt_requested'),
								),
							)
							.returning({ id: sessions.id }),
					)

					// Reject pending approvals for all affected sessions
					const affectedSessionIds = [...failedSessions, ...interruptedSessions].map((s) => s.id)
					if (affectedSessionIds.length > 0) {
						yield* tx.run(() =>
							rejectPendingApprovals(tx.client as never, {
								sessionIds: affectedSessionIds,
								organizationId,
								hostId,
								comment: 'Daemon shutdown',
							}),
						)
					}

					// Keep the registration visible while recording that the daemon stopped.
					yield* tx.query(
						tx.client
							.update(onlineHosts)
							.set({ status: 'offline' })
							.where(
								and(
									eq(onlineHosts.host_id, hostId),
									eq(onlineHosts.organization_id, organizationId),
									eq(onlineHosts.user_id, userId),
								),
							),
					)

					return {
						success: true as const,
						sessionsUpdated: failedSessions.length + interruptedSessions.length,
					}
				}),
			)
			.pipe(
				Effect.tap((result) =>
					Effect.logInfo('Host shutdown processed').pipe(
						Effect.annotateLogs({
							hostId,
							organizationId,
							sessionsUpdated: result.sessionsUpdated,
						}),
					),
				),
				Effect.tapError((e) => Effect.logError(e)),
				Effect.tapError((e) => Effect.sync(() => Sentry.captureException(e))),
				Effect.catchTags({
					PostgresDbQueryError: (error) => mapPostgresErrorToResponse(error, errors),
					PostgresDbTransactionError: (error) => mapPostgresErrorToResponse(error, errors),
				}),
			)
	})
