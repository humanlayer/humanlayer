import { approvals } from '@humanlayer/db/tables/approvals'
import { and, eq, inArray } from 'drizzle-orm'
import type { PgDatabase } from 'drizzle-orm/pg-core'
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js'

interface RejectPendingApprovalsOptions {
	sessionId?: string
	sessionIds?: string[]
	organizationId: string
	hostId: string
	comment: string
}

/**
 * Reject all pending approvals matching the given criteria with a single UPDATE.
 * Use sessionId for single session, or sessionIds for multiple sessions (e.g., shutdown).
 */
export async function rejectPendingApprovals(
	tx: PgDatabase<PostgresJsQueryResultHKT>,
	options: RejectPendingApprovalsOptions,
): Promise<void> {
	const { sessionId, sessionIds, organizationId, hostId, comment } = options

	// Build session filter - either single session or multiple
	const sessionFilter = sessionId
		? eq(approvals.session_id, sessionId)
		: sessionIds?.length
			? inArray(approvals.session_id, sessionIds)
			: null

	if (!sessionFilter) return

	await tx
		.update(approvals)
		.set({
			status: 'denied',
			comment,
			responded_at: BigInt(Date.now()),
		})
		.where(
			and(
				sessionFilter,
				eq(approvals.organization_id, organizationId),
				eq(approvals.host_id, hostId),
				eq(approvals.status, 'pending'),
			),
		)
}
