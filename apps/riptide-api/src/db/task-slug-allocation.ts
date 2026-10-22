import { tasks } from '@humanlayer/db/tables/tasks'
import { and, eq, ne, sql } from 'drizzle-orm'
import type { PgDatabase } from 'drizzle-orm/pg-core'
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js'

type TaskSlugDatabase = PgDatabase<PostgresJsQueryResultHKT>

type TaskSlugIdentity = {
	readonly slug: string
	readonly taskId: string
	readonly organizationId: string
}

type TaskSlugLockIdentity = Omit<TaskSlugIdentity, 'taskId'>

export async function activeTaskSlugIsAllocated(
	db: TaskSlugDatabase,
	{ slug, taskId, organizationId }: TaskSlugIdentity,
): Promise<boolean> {
	const [conflict] = await db
		.select({ id: tasks.id })
		.from(tasks)
		.where(
			and(
				eq(tasks.organization_id, organizationId),
				eq(tasks.slug, slug),
				eq(tasks.is_draft, false),
				ne(tasks.id, taskId),
			),
		)
		.limit(1)
	return conflict !== undefined
}

/**
 * Serialize active-task slug allocation for one organization and slug.
 *
 * Draft slugs are intentionally non-unique, so this transaction-scoped lock
 * closes the gap between checking an active slug and materializing the task.
 */
export async function lockActiveTaskSlugAllocation(
	tx: TaskSlugDatabase,
	{ slug, organizationId }: TaskSlugLockIdentity,
): Promise<void> {
	await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${organizationId}:${slug}`}, 0::bigint))`)
}
