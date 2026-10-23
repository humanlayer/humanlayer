import { approvals } from '@humanlayer/db/tables/approvals'
import { onlineHosts } from '@humanlayer/db/tables/online-hosts'
import { DAEMON_ACTIVE_SESSION_STATUSES, sessions } from '@humanlayer/db/tables/sessions'
import { and, asc, eq, inArray, lt, or } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'

export const STALE_DAEMON_AFTER_MS = 120_000
const BATCH_SIZE = 100

export type Database = PostgresJsDatabase<Record<string, never>>

export type StaleDaemonBatchResult = {
	registrationsMarkedOffline: number
	sessionsFailed: number
	approvalsRejected: number
}

export type StaleDaemonReconciliationResult = StaleDaemonBatchResult & {
	batchesCompleted: number
}

const emptyBatchResult = (): StaleDaemonBatchResult => ({
	registrationsMarkedOffline: 0,
	sessionsFailed: 0,
	approvalsRejected: 0,
})

function registrationCondition(registration: { hostId: string; organizationId: string; userId: string }) {
	return and(
		eq(onlineHosts.host_id, registration.hostId),
		eq(onlineHosts.organization_id, registration.organizationId),
		eq(onlineHosts.user_id, registration.userId),
	)
}

function sessionRegistrationCondition(registration: { hostId: string; organizationId: string; userId: string }) {
	return and(
		eq(sessions.host_id, registration.hostId),
		eq(sessions.organization_id, registration.organizationId),
		eq(sessions.created_by, registration.userId),
	)
}

export async function sweepStaleDaemonBatch(db: Database, cutoff: bigint): Promise<StaleDaemonBatchResult> {
	return db.transaction(async (tx) => {
		const candidates = await tx
			.select({
				hostId: onlineHosts.host_id,
				organizationId: onlineHosts.organization_id,
				userId: onlineHosts.user_id,
			})
			.from(onlineHosts)
			.where(and(eq(onlineHosts.status, 'online'), lt(onlineHosts.last_seen, cutoff)))
			.orderBy(
				asc(onlineHosts.last_seen),
				asc(onlineHosts.host_id),
				asc(onlineHosts.organization_id),
				asc(onlineHosts.user_id),
			)
			.limit(BATCH_SIZE)
			.for('update', { skipLocked: true })

		if (candidates.length === 0) {
			return emptyBatchResult()
		}

		const candidateFilter = or(...candidates.map(registrationCondition))
		if (!candidateFilter) {
			return emptyBatchResult()
		}

		const transitioned = await tx
			.update(onlineHosts)
			.set({ status: 'offline' })
			.where(and(candidateFilter, eq(onlineHosts.status, 'online'), lt(onlineHosts.last_seen, cutoff)))
			.returning({
				hostId: onlineHosts.host_id,
				organizationId: onlineHosts.organization_id,
				userId: onlineHosts.user_id,
			})

		if (transitioned.length === 0) {
			return emptyBatchResult()
		}

		const sessionFilter = or(...transitioned.map(sessionRegistrationCondition))
		if (!sessionFilter) {
			return { ...emptyBatchResult(), registrationsMarkedOffline: transitioned.length }
		}

		const now = BigInt(Date.now())
		const failedSessions = await tx
			.update(sessions)
			.set({
				status: 'failed',
				error_message: 'Session failed because the daemon timed out',
				updated_at: now,
			})
			.where(and(sessionFilter, inArray(sessions.status, DAEMON_ACTIVE_SESSION_STATUSES)))
			.returning({ id: sessions.id })

		const interruptedSessions = await tx
			.update(sessions)
			.set({ status: 'interrupted', updated_at: now })
			.where(and(sessionFilter, eq(sessions.status, 'interrupt_requested')))
			.returning({ id: sessions.id })

		let rejectedApprovals: { id: string }[] = []
		const affectedSessionIds = [...failedSessions, ...interruptedSessions].map((session) => session.id)
		if (affectedSessionIds.length > 0) {
			rejectedApprovals = await tx
				.update(approvals)
				.set({ status: 'denied', comment: 'Daemon timed out', responded_at: now })
				.where(and(inArray(approvals.session_id, affectedSessionIds), eq(approvals.status, 'pending')))
				.returning({ id: approvals.id })
		}

		return {
			registrationsMarkedOffline: transitioned.length,
			sessionsFailed: failedSessions.length,
			approvalsRejected: rejectedApprovals.length,
		}
	})
}

export async function reconcileStaleDaemons(
	db: Database,
	cutoff: bigint,
	sweepBatch: (db: Database, cutoff: bigint) => Promise<StaleDaemonBatchResult> = sweepStaleDaemonBatch,
): Promise<StaleDaemonReconciliationResult> {
	const result: StaleDaemonReconciliationResult = {
		...emptyBatchResult(),
		batchesCompleted: 0,
	}

	while (true) {
		const batch = await sweepBatch(db, cutoff)
		if (batch.registrationsMarkedOffline === 0) {
			return result
		}

		result.batchesCompleted += 1
		result.registrationsMarkedOffline += batch.registrationsMarkedOffline
		result.sessionsFailed += batch.sessionsFailed
		result.approvalsRejected += batch.approvalsRejected
	}
}
