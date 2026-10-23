import { randomUUID } from 'node:crypto'

import {
	formatPostgresDatabaseUrl,
	getExternalTestServicesConfig,
	verifyExternalTestServices,
} from '@humanlayer/test-fixtures/external-test-services'
import type { Logger } from 'drizzle-orm/logger'
import { drizzle } from 'drizzle-orm/postgres-js'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

import { migrationsFolder } from './postgres'

export type TestDb = {
	db: PostgresJsDatabase
	databaseName: string
	cleanup: () => Promise<void>
}

export async function createTestDb(
	scope = 'riptide_api',
	options?: { migrationsFolder?: string; logger?: Logger },
): Promise<TestDb> {
	const config = getExternalTestServicesConfig()
	const templateDatabase = options?.migrationsFolder ? undefined : process.env.RIPTIDE_API_TEST_TEMPLATE_DATABASE
	if (!templateDatabase) {
		await verifyExternalTestServices(config)
	}

	const databaseName = createDatabaseName(scope)
	const adminClient = postgres(config.postgresAdminUrl, { max: 1 })

	await createDatabase(adminClient, databaseName, templateDatabase)

	const databaseUrl = formatPostgresDatabaseUrl(config, databaseName)
	const client = postgres(databaseUrl, { max: 5 })
	const db = drizzle(client, { logger: options?.logger })

	try {
		if (!templateDatabase) {
			await db.execute(`CREATE SCHEMA IF NOT EXISTS "drizzle";`)
			await migrate(db, { migrationsFolder: options?.migrationsFolder ?? migrationsFolder })
		}
	} catch (error) {
		await client.end({ timeout: 5 }).catch(() => undefined)
		await dropDatabase(adminClient, databaseName).catch(() => undefined)
		await adminClient.end({ timeout: 5 }).catch(() => undefined)
		throw error
	}

	await adminClient.end({ timeout: 5 })

	let isCleanedUp = false

	return {
		db,
		databaseName,
		cleanup: async () => {
			if (isCleanedUp) {
				return
			}

			isCleanedUp = true
			await client.end({ timeout: 5 }).catch(() => undefined)

			const cleanupAdminClient = postgres(config.postgresAdminUrl, { max: 1 })
			try {
				await dropDatabase(cleanupAdminClient, databaseName)
			} finally {
				await cleanupAdminClient.end({ timeout: 5 }).catch(() => undefined)
			}
		},
	}
}

function createDatabaseName(scope: string): string {
	const scopeName = scope.replace(/[^a-zA-Z0-9_]+/g, '_').replace(/^_+|_+$/g, '')
	const prefix = scopeName.length > 0 ? scopeName.toLowerCase() : 'riptide_api'
	const suffix = randomUUID().replaceAll('-', '').slice(0, 12)
	return `${prefix}_${suffix}`
}

async function createDatabase(
	adminClient: postgres.Sql,
	databaseName: string,
	templateDatabase?: string,
): Promise<void> {
	const templateClause = templateDatabase ? ` TEMPLATE ${quoteIdentifier(templateDatabase)}` : ''
	await adminClient.unsafe(`CREATE DATABASE ${quoteIdentifier(databaseName)}${templateClause}`)
}

async function dropDatabase(adminClient: postgres.Sql, databaseName: string): Promise<void> {
	await adminClient`
		SELECT pg_terminate_backend(pid)
		FROM pg_stat_activity
		WHERE datname = ${databaseName}
			AND pid <> pg_backend_pid()
	`
	await adminClient.unsafe(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)}`)
}

function quoteIdentifier(value: string): string {
	return `"${value.replaceAll('"', '""')}"`
}
