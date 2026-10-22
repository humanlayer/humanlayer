import 'zod/compile'
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager'
import * as Sentry from '@sentry/node'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

import {
	EPHEMERAL_HOST_AFTER_MS,
	OFFLINE_HOST_AFTER_MS,
	reconcileExpiredEphemeralHosts,
	reconcileExpiredOfflineHosts,
	type ExpiredHostReconciliationResult,
} from './expired-hosts'
import {
	reconcileLostSessions,
	type LostSessionBatchResult,
	type LostSessionLogger,
	type LostSessionReconciliationResult,
} from './lost-sessions'
import {
	reconcileStaleDaemons,
	STALE_DAEMON_AFTER_MS,
	sweepStaleDaemonBatch,
	type Database,
	type StaleDaemonBatchResult,
	type StaleDaemonReconciliationResult,
} from './stale-daemons'

const SENTRY_FLUSH_TIMEOUT_MS = 5_000
const secretsManager = new SecretsManagerClient({})

export type { Database, StaleDaemonBatchResult as BatchResult }
export { sweepStaleDaemonBatch }

export type DatabaseConnection = {
	db: Database
	close: () => Promise<void>
}

export type SweepResult = {
	success: true
	invocationTime: bigint
	staleDaemonCutoff: bigint
	ephemeralHostCutoff: bigint
	offlineHostCutoff: bigint
	staleDaemons: StaleDaemonReconciliationResult
	lostSessions: LostSessionReconciliationResult
	expiredEphemeralHosts: ExpiredHostReconciliationResult
	expiredOfflineHosts: ExpiredHostReconciliationResult
}

export type SweepOptions = {
	now?: () => number
	loadDatabaseUrl?: () => Promise<string>
	createDatabaseConnection?: (databaseUrl: string) => Promise<DatabaseConnection>
	reconcileStaleDaemons?: (db: Database, cutoff: bigint) => Promise<StaleDaemonReconciliationResult>
	reconcileLostSessions?: (db: Database, now: bigint) => Promise<LostSessionReconciliationResult>
	reconcileExpiredEphemeralHosts?: (db: Database, cutoff: bigint) => Promise<ExpiredHostReconciliationResult>
	reconcileExpiredOfflineHosts?: (db: Database, cutoff: bigint) => Promise<ExpiredHostReconciliationResult>
	captureException?: (error: unknown) => void
	flushSentry?: () => Promise<unknown>
	logSummary?: (result: SweepResult) => void
}

async function getDatabaseUrl(): Promise<string> {
	if (process.env.DATABASE_URL) {
		return process.env.DATABASE_URL
	}

	const secretArn = process.env.DATABASE_URL_SECRET_ARN
	if (!secretArn) {
		throw new Error('Missing DATABASE_URL or DATABASE_URL_SECRET_ARN environment variable')
	}

	const response = await secretsManager.send(new GetSecretValueCommand({ SecretId: secretArn }))
	if (!response.SecretString) {
		throw new Error('Database URL secret has no string value')
	}

	return response.SecretString
}

export async function createDatabaseConnection(databaseUrl: string): Promise<DatabaseConnection> {
	const client = postgres(databaseUrl, {
		max: 1,
		connect_timeout: 5,
		// The installed Postgres.js types accept milliseconds, not duration strings.
		connection: { statement_timeout: 10_000, lock_timeout: 1_000 },
	})
	return {
		db: drizzle(client),
		close: () => client.end({ timeout: 5 }),
	}
}

export async function runStaleDaemonSweep(options: SweepOptions = {}): Promise<SweepResult> {
	const invocationTime = BigInt((options.now ?? Date.now)())
	const staleDaemonCutoff = invocationTime - BigInt(STALE_DAEMON_AFTER_MS)
	const ephemeralHostCutoff = invocationTime - BigInt(EPHEMERAL_HOST_AFTER_MS)
	const offlineHostCutoff = invocationTime - BigInt(OFFLINE_HOST_AFTER_MS)
	const loadDatabaseUrl = options.loadDatabaseUrl ?? getDatabaseUrl
	const connect = options.createDatabaseConnection ?? createDatabaseConnection
	const runDaemonPass = options.reconcileStaleDaemons ?? reconcileStaleDaemons
	const runLostPass = options.reconcileLostSessions ?? reconcileLostSessions
	const runEphemeralPass = options.reconcileExpiredEphemeralHosts ?? reconcileExpiredEphemeralHosts
	const runOfflinePass = options.reconcileExpiredOfflineHosts ?? reconcileExpiredOfflineHosts
	const captureException = options.captureException ?? Sentry.captureException
	const flushSentry = options.flushSentry ?? (() => Sentry.flush(SENTRY_FLUSH_TIMEOUT_MS))
	const logSummary =
		options.logSummary ?? ((result) => console.log({ event: 'session_reconciliation_completed', ...result }))
	let connection: DatabaseConnection | undefined

	try {
		const databaseUrl = await loadDatabaseUrl()
		connection = await connect(databaseUrl)
		const staleDaemons = await runDaemonPass(connection.db, staleDaemonCutoff)
		const lostSessions = await runLostPass(connection.db, invocationTime)
		const expiredEphemeralHosts = await runEphemeralPass(connection.db, ephemeralHostCutoff)
		const expiredOfflineHosts = await runOfflinePass(connection.db, offlineHostCutoff)
		const result: SweepResult = {
			success: true,
			invocationTime,
			staleDaemonCutoff,
			ephemeralHostCutoff,
			offlineHostCutoff,
			staleDaemons,
			lostSessions,
			expiredEphemeralHosts,
			expiredOfflineHosts,
		}
		logSummary(result)
		return result
	} catch (error) {
		captureException(error)
		throw error
	} finally {
		try {
			await flushSentry()
		} finally {
			await connection?.close()
		}
	}
}

export async function handler() {
	return runStaleDaemonSweep()
}

if (import.meta.main) {
	void runStaleDaemonSweep()
}

export type { LostSessionBatchResult, LostSessionLogger }
