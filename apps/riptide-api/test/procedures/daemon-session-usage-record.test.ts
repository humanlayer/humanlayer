import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'

import { organizations } from '@humanlayer/db/tables/organizations'
import { sessionUsageEvents } from '@humanlayer/db/tables/session-usage-events'
import { sessions } from '@humanlayer/db/tables/sessions'
import { call } from '@orpc/server'
import { asc, eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { recordSessionUsageEffectProcedure as liveRecordSessionUsageProcedure } from '../../src/orpc/daemon/sessions/usage/record.effect'
import { createMockDaemonAuth, createMockDaemonContext } from '../mocks'
import { bindProcedureToRuntime, createRuntimeWithTestPostgresLayer } from '../utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('daemon/sessions/usage/record', async () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let effectRuntime: ReturnType<typeof createRuntimeWithTestPostgresLayer> | undefined
	let recordSessionUsageProcedure: typeof liveRecordSessionUsageProcedure
	let organizationId: string
	const userId = 'user_daemon_usage_record'
	const hostId = randomUUID()

	beforeAll(async () => {
		const testDb = await createTestDb('daemon_session_usage_record')
		cleanupTestDb = testDb.cleanup
		db = testDb.db
		effectRuntime = createRuntimeWithTestPostgresLayer(db)
		recordSessionUsageProcedure = bindProcedureToRuntime(liveRecordSessionUsageProcedure, effectRuntime)

		const [org] = await db
			.insert(organizations)
			.values({ name: 'Usage Record Org', workos_organization_id: `workos-org-${randomUUID()}` })
			.returning()

		if (!org) throw new Error('Unable to insert organization for setup')
		organizationId = org.id
	}, 30000)

	afterAll(async () => {
		await effectRuntime?.dispose()
		await cleanupTestDb?.()
	}, 30000)

	const createSession = async (overrides: Partial<typeof sessions.$inferInsert> = {}) => {
		const [session] = await db
			.insert(sessions)
			.values({
				organization_id: organizationId,
				resource_owner_user_id: userId,
				created_by: userId,
				host_id: hostId,
				title: 'usage record session',
				working_directory: tmpdir(),
				coding_agent: 'claude',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissions_mode: 'default',
				status: 'running',
				...overrides,
			})
			.returning()

		if (!session) throw new Error('Unable to insert session for setup')
		return session
	}

	const createDaemonContext = (authOverrides: Partial<{ hostId: string; organizationId: string }> = {}) => ({
		context: createMockDaemonContext({
			auth: createMockDaemonAuth({
				userId,
				organizationId: authOverrides.organizationId ?? organizationId,
				hostId: authOverrides.hostId ?? hostId,
			}),
			services: {
				db,
				dbReadReplica: db,
			},
		}),
	})

	const reportInput = (
		sessionId: string,
		reportKey: string,
	): {
		sessionId: string
		reportKey: string
		source: 'claude_sdk_result'
		occurredAt: number
		entries: Array<{ model: string; tokens: Record<string, number>; costUsd?: number }>
	} => ({
		sessionId,
		reportKey,
		source: 'claude_sdk_result',
		occurredAt: Date.now(),
		entries: [
			{
				model: 'claude-sonnet-4-5',
				tokens: {
					input_tokens: 100,
					output_tokens: 50,
					cache_read_input_tokens: 1000,
					cache_creation_input_tokens: 200,
				},
				costUsd: 0.42,
			},
			{
				model: 'claude-haiku-4-5',
				tokens: { input_tokens: 10, output_tokens: 5, reasoning_tokens: 7 },
			},
		],
	})

	test('inserts one row per model with hoisted columns and session attribution', async () => {
		const session = await createSession({ task_id: null })
		const reportKey = `result-uuid-${randomUUID()}`

		const result = await call(
			recordSessionUsageProcedure,
			reportInput(session.id, reportKey),
			createDaemonContext(),
		)
		expect(result).toEqual({ recorded: 2 })

		const rows = await db
			.select()
			.from(sessionUsageEvents)
			.where(eq(sessionUsageEvents.session_id, session.id))
			.orderBy(asc(sessionUsageEvents.model))

		expect(rows).toHaveLength(2)

		const haiku = rows[0]
		const sonnet = rows[1]

		expect(sonnet).toMatchObject({
			organization_id: organizationId,
			resource_owner_user_id: userId,
			session_creator_user_id: userId,
			coding_agent: 'claude',
			source: 'claude_sdk_result',
			report_key: reportKey,
			model: 'claude-sonnet-4-5',
			input_tokens: 100,
			output_tokens: 50,
			cache_read_tokens: 1000,
			cache_creation_tokens: 200,
		})
		expect(sonnet?.cost_usd).toBeCloseTo(0.42)

		// Non-conventional keys stay in the jsonb map without hoisting or schema changes
		expect(haiku).toMatchObject({
			model: 'claude-haiku-4-5',
			input_tokens: 10,
			output_tokens: 5,
			cache_read_tokens: 0,
			cache_creation_tokens: 0,
			cost_usd: null,
		})
		expect(haiku?.tokens).toEqual({ input_tokens: 10, output_tokens: 5, reasoning_tokens: 7 })
	})

	test('idempotent replay of the same report inserts nothing and returns recorded: 0', async () => {
		const session = await createSession()
		const reportKey = `result-uuid-${randomUUID()}`
		const input = reportInput(session.id, reportKey)

		const first = await call(recordSessionUsageProcedure, input, createDaemonContext())
		expect(first).toEqual({ recorded: 2 })

		// Same payload again — the oRPC retry-plugin scenario
		const replay = await call(recordSessionUsageProcedure, input, createDaemonContext())
		expect(replay).toEqual({ recorded: 0 })

		const rows = await db
			.select({ id: sessionUsageEvents.id })
			.from(sessionUsageEvents)
			.where(eq(sessionUsageEvents.session_id, session.id))
		expect(rows).toHaveLength(2)
	})

	test('a second run with a different reportKey appends new rows', async () => {
		const session = await createSession()

		await call(recordSessionUsageProcedure, reportInput(session.id, `run-1-${randomUUID()}`), createDaemonContext())
		const second = await call(
			recordSessionUsageProcedure,
			reportInput(session.id, `run-2-${randomUUID()}`),
			createDaemonContext(),
		)
		expect(second).toEqual({ recorded: 2 })

		const rows = await db
			.select({ id: sessionUsageEvents.id })
			.from(sessionUsageEvents)
			.where(eq(sessionUsageEvents.session_id, session.id))
		expect(rows).toHaveLength(4)
	})

	test('rejects when the daemon is not running the session (host mismatch)', async () => {
		const session = await createSession()

		await expect(
			call(
				recordSessionUsageProcedure,
				reportInput(session.id, `run-${randomUUID()}`),
				createDaemonContext({ hostId: randomUUID() }),
			),
		).rejects.toMatchObject({ code: 'FORBIDDEN' })
	})

	test('rejects a session from another organization as NOT_FOUND', async () => {
		const [otherOrg] = await db
			.insert(organizations)
			.values({ name: 'Other Org', workos_organization_id: `workos-org-${randomUUID()}` })
			.returning()
		if (!otherOrg) throw new Error('Unable to insert organization for setup')

		const session = await createSession()

		await expect(
			call(
				recordSessionUsageProcedure,
				reportInput(session.id, `run-${randomUUID()}`),
				createDaemonContext({ organizationId: otherOrg.id }),
			),
		).rejects.toMatchObject({ code: 'NOT_FOUND' })
	})
})
