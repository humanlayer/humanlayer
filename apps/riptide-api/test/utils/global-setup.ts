import { randomUUID } from 'node:crypto'

import {
	formatPostgresDatabaseUrl,
	getExternalTestServicesConfig,
	verifyExternalTestServices,
} from '@humanlayer/test-fixtures/external-test-services'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

import { migrationsFolder } from './postgres'

const TEMPLATE_DATABASE_ENV = 'RIPTIDE_API_TEST_TEMPLATE_DATABASE'

export default async function setup() {
	const config = getExternalTestServicesConfig()
	await verifyExternalTestServices(config)

	const templateDatabase = `riptide_api_template_${randomUUID().replaceAll('-', '').slice(0, 12)}`
	const adminClient = postgres(config.postgresAdminUrl, { max: 1 })
	await adminClient.unsafe(`CREATE DATABASE ${quoteIdentifier(templateDatabase)}`)

	const templateClient = postgres(formatPostgresDatabaseUrl(config, templateDatabase), { max: 1 })
	try {
		const db = drizzle(templateClient)
		await db.execute(`CREATE SCHEMA IF NOT EXISTS "drizzle";`)
		await migrate(db, { migrationsFolder })
	} catch (error) {
		await templateClient.end({ timeout: 5 }).catch(() => undefined)
		await dropDatabase(adminClient, templateDatabase).catch(() => undefined)
		await adminClient.end({ timeout: 5 }).catch(() => undefined)
		throw error
	}

	await templateClient.end({ timeout: 5 })
	await adminClient.end({ timeout: 5 })
	process.env[TEMPLATE_DATABASE_ENV] = templateDatabase

	return async () => {
		delete process.env[TEMPLATE_DATABASE_ENV]
		const cleanupClient = postgres(config.postgresAdminUrl, { max: 1 })
		try {
			await dropDatabase(cleanupClient, templateDatabase)
		} finally {
			await cleanupClient.end({ timeout: 5 }).catch(() => undefined)
		}
	}
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
