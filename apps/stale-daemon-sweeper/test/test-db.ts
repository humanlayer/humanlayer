import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

import {
	formatPostgresDatabaseUrl,
	getExternalTestServicesConfig,
} from '@humanlayer/test-fixtures/external-test-services'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

const migrationsFolder = fileURLToPath(new URL('../../../packages/db/drizzle', import.meta.url))

export async function createTestDb(scope = 'stale_daemon_sweeper') {
	const config = getExternalTestServicesConfig()
	const databaseName = `${scope}_${randomUUID().replaceAll('-', '').slice(0, 12)}`
	const admin = postgres(config.postgresAdminUrl, { max: 1 })
	await admin.unsafe(`CREATE DATABASE "${databaseName}"`)
	const databaseUrl = formatPostgresDatabaseUrl(config, databaseName)
	const client = postgres(databaseUrl, { max: 5 })
	const db = drizzle(client)

	try {
		await db.execute('CREATE SCHEMA IF NOT EXISTS "drizzle";')
		await migrate(db, { migrationsFolder })
	} catch (error) {
		await client.end({ timeout: 5 }).catch(() => undefined)
		await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}"`).catch(() => undefined)
		await admin.end({ timeout: 5 }).catch(() => undefined)
		throw error
	}

	await admin.end({ timeout: 5 })
	return {
		db,
		client,
		databaseUrl,
		cleanup: async () => {
			await client.end({ timeout: 5 }).catch(() => undefined)
			const cleanupAdmin = postgres(config.postgresAdminUrl, { max: 1 })
			try {
				await cleanupAdmin`
					SELECT pg_terminate_backend(pid)
					FROM pg_stat_activity
					WHERE datname = ${databaseName} AND pid <> pg_backend_pid()
				`
				await cleanupAdmin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}"`)
			} finally {
				await cleanupAdmin.end({ timeout: 5 }).catch(() => undefined)
			}
		},
	}
}
