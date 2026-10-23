import { organizationSettings, type DefaultTaskShareLevel } from '@humanlayer/db/tables/organization-settings'
import { eq } from 'drizzle-orm'
import type { PgDatabase } from 'drizzle-orm/pg-core'
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js'

export const DEFAULT_TASK_SHARE_LEVEL = 'edit' satisfies DefaultTaskShareLevel

export async function resolveOrgDefaultTaskShareLevel(
	db: PgDatabase<PostgresJsQueryResultHKT>,
	organizationId: string,
): Promise<DefaultTaskShareLevel> {
	const [row] = await db
		.select({ defaultTaskShareLevel: organizationSettings.default_task_share_level })
		.from(organizationSettings)
		.where(eq(organizationSettings.organization_id, organizationId))
		.limit(1)

	return row?.defaultTaskShareLevel ?? DEFAULT_TASK_SHARE_LEVEL
}
