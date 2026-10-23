import { organizations } from '@humanlayer/db/tables/organizations'
import { tasks } from '@humanlayer/db/tables/tasks'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import { describe, expect, it } from 'vitest'

import { resetElectricTestDatabase } from '../src/electric-test-context'
import { formatPostgresDatabaseUrl, getExternalTestServicesConfig } from '../src/external-test-services'
import { migrationsFolder } from '../src/postgres'

describe('resetElectricTestDatabase', () => {
	it('truncates app tables and reseeds the default organization', async () => {
		const config = getExternalTestServicesConfig()
		const client = postgres(formatPostgresDatabaseUrl(config, 'electric'), { max: 1 })
		const db = drizzle(client)

		try {
			await db.execute('CREATE SCHEMA IF NOT EXISTS "drizzle";')
			await migrate(db, { migrationsFolder })

			const defaultOrg = await resetElectricTestDatabase(db)

			const [_task] = await db
				.insert(tasks)
				.values({
					organization_id: defaultOrg.id,
					resource_owner_user_id: 'user_owner',
					created_by: 'user_owner',
					default_working_directory: '/tmp/reset-test',
					setup_status: 'completed',
					slug: 'reset-electric-test-task',
					name: 'Reset Electric Test Task',
				})
				.returning()

			const reseededOrg = await resetElectricTestDatabase(db)

			const organizationsAfterReset = await db.select().from(organizations)
			const tasksAfterReset = await db.select().from(tasks)

			expect(organizationsAfterReset).toHaveLength(1)
			expect(organizationsAfterReset[0]?.id).toBe(reseededOrg.id)
			expect(organizationsAfterReset[0]?.id).not.toBe(defaultOrg.id)
			expect(tasksAfterReset).toHaveLength(0)
		} finally {
			await client.end({ timeout: 1 })
		}
	})
})
