import { agentSlashCommands } from '@humanlayer/db/tables/agent-slash-commands'
import { hostAliases } from '@humanlayer/db/tables/host-aliases'
import { onlineHosts } from '@humanlayer/db/tables/online-hosts'
import { and, asc, eq, lt, or, sql } from 'drizzle-orm'

import type { Database } from './stale-daemons'

export const EPHEMERAL_HOST_AFTER_MS = 10 * 60 * 1_000
export const OFFLINE_HOST_AFTER_MS = 90 * 24 * 60 * 60 * 1_000
const BATCH_SIZE = 100

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]
export type RegistrationKey = { hostId: string; organizationId: string; userId: string }
export type ExpiredHostPolicy = 'ephemeral' | 'offline'
export type ExpiredHostBatchResult = { registrationsDeleted: number }
export type ExpiredHostReconciliationResult = ExpiredHostBatchResult & { batchesCompleted: number }

// These query builders are also used by real-DB query-plan coverage, so it exercises
// the actual candidate and deletion statements rather than approximations of them.
export function expiredHostCandidates(tx: Transaction, cutoff: bigint, policy: ExpiredHostPolicy) {
	return tx
		.select({
			hostId: onlineHosts.host_id,
			organizationId: onlineHosts.organization_id,
			userId: onlineHosts.user_id,
		})
		.from(onlineHosts)
		.where(
			and(
				policy === 'ephemeral' ? sql`${onlineHosts.ephemeral}` : eq(onlineHosts.status, 'offline'),
				lt(onlineHosts.last_seen, cutoff),
			),
		)
		.orderBy(
			asc(onlineHosts.last_seen),
			asc(onlineHosts.host_id),
			asc(onlineHosts.organization_id),
			asc(onlineHosts.user_id),
		)
		.limit(BATCH_SIZE)
		.for('update', { skipLocked: true })
}

export function hostRegistrationDeletes(tx: Transaction, keys: readonly RegistrationKey[]) {
	if (keys.length === 0) return [] as const
	const tables = [onlineHosts, hostAliases, agentSlashCommands] as const
	return tables.map((table) =>
		tx
			.delete(table)
			.where(
				or(
					...keys.map((key) =>
						and(
							eq(table.host_id, key.hostId),
							eq(table.organization_id, key.organizationId),
							eq(table.user_id, key.userId),
						),
					),
				),
			),
	)
}

export async function deleteHostRegistrations(tx: Transaction, keys: readonly RegistrationKey[]): Promise<void> {
	// Await each bulk delete; never issue concurrent statements on the transaction.
	for (const deletion of hostRegistrationDeletes(tx, keys)) await deletion
}

export async function sweepExpiredHostBatch(
	db: Database,
	cutoff: bigint,
	policy: ExpiredHostPolicy,
): Promise<ExpiredHostBatchResult> {
	return db.transaction(async (tx) => {
		const keys = await expiredHostCandidates(tx, cutoff, policy)
		await deleteHostRegistrations(tx, keys)
		return { registrationsDeleted: keys.length }
	})
}

async function reconcileExpiredHosts(
	db: Database,
	cutoff: bigint,
	policy: ExpiredHostPolicy,
): Promise<ExpiredHostReconciliationResult> {
	const result = { registrationsDeleted: 0, batchesCompleted: 0 }
	while (true) {
		const batch = await sweepExpiredHostBatch(db, cutoff, policy)
		if (batch.registrationsDeleted === 0) return result
		result.registrationsDeleted += batch.registrationsDeleted
		result.batchesCompleted += 1
	}
}

export function reconcileExpiredEphemeralHosts(db: Database, cutoff: bigint) {
	return reconcileExpiredHosts(db, cutoff, 'ephemeral')
}

export function reconcileExpiredOfflineHosts(db: Database, cutoff: bigint) {
	return reconcileExpiredHosts(db, cutoff, 'offline')
}
