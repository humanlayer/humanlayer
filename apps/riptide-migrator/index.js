import * as Sentry from '@sentry/node'

Sentry.init({
	// Unset means Sentry stays off, so builds from source report nowhere.
	dsn: process.env.SENTRY_DSN,
	enabled: process.env.SENTRY_DSN !== undefined && (process.env.SENTRY_ENVIRONMENT ?? 'local') !== 'local',
	environment: process.env.SENTRY_ENVIRONMENT ?? 'local',
	tracesSampleRate: 0.0001,
})

import fs from 'node:fs/promises'
import path from 'node:path'
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

const secretsManager = new SecretsManagerClient({})

async function getDatabaseUrl() {
	// Check if we have a direct DATABASE_URL (for local testing)
	if (process.env.DATABASE_URL) {
		return process.env.DATABASE_URL
	}

	// Otherwise fetch from Secrets Manager using the ARN
	const secretArn = process.env.DATABASE_URL_SECRET_ARN
	if (!secretArn) {
		throw new Error('Missing DATABASE_URL_SECRET_ARN environment variable')
	}

	const command = new GetSecretValueCommand({ SecretId: secretArn })
	const response = await secretsManager.send(command)

	if (!response.SecretString) {
		throw new Error('Secret has no string value')
	}

	return response.SecretString
}

export async function handler() {
	console.log('Starting database migration...')

	try {
		const databaseUrl = await getDatabaseUrl()
		console.log('Successfully retrieved database URL')

		const client = postgres(databaseUrl, { max: 1 })
		const db = drizzle(client)

		// Lambda extracts code to /var/task, use process.cwd() for runtime path
		const migrationsPath = path.join(process.cwd(), 'drizzle')
		console.log('Running migrations from:', migrationsPath)

		// List migration files for logging
		const contents = await fs.readdir(migrationsPath).catch(() => [])
		console.log(
			'Migration files:',
			contents.filter((f) => f.endsWith('.sql')),
		)

		await migrate(db, { migrationsFolder: migrationsPath })

		console.log('Migrations completed successfully at', new Date().toISOString())

		await Sentry.flush(2000)

		return {
			statusCode: 200,
			body: JSON.stringify({
				success: true,
				message: 'Migrations completed successfully',
				timestamp: new Date().toISOString(),
			}),
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unknown error'
		console.error('Error running migrations:', message)
		console.error(error)
		Sentry.captureException(error)
		await Sentry.flush(2000)

		return {
			statusCode: 500,
			body: JSON.stringify({
				success: false,
				message: `Migration failed: ${message}`,
				timestamp: new Date().toISOString(),
			}),
		}
	}
}
