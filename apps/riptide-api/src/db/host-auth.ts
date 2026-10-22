import { onlineHosts } from '@humanlayer/db/tables/online-hosts'
import { and, eq } from 'drizzle-orm'
import type { PgDatabase } from 'drizzle-orm/pg-core'
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js'

/**
 * Validate that a host_id belongs to the given user in the given organization.
 * Checks the online_hosts table for an active record matching all three columns.
 *
 * @returns true if the host exists and belongs to the user, false otherwise
 */
export async function validateHostOwnership(
	tx: PgDatabase<PostgresJsQueryResultHKT>,
	hostId: string,
	userId: string,
	organizationId: string,
): Promise<boolean> {
	const [host] = await tx
		.select({ host_id: onlineHosts.host_id })
		.from(onlineHosts)
		.where(
			and(
				eq(onlineHosts.host_id, hostId),
				eq(onlineHosts.user_id, userId),
				eq(onlineHosts.organization_id, organizationId),
				eq(onlineHosts.status, 'online'),
			),
		)
		.limit(1)

	return !!host
}
