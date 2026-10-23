import { randomUUID } from 'node:crypto'

import { DurableStreamTestServer } from '@durable-streams/server'
import { conversationEvents } from '@humanlayer/db/tables/conversation-events'
import { organizations } from '@humanlayer/db/tables/organizations'
import { sessions } from '@humanlayer/db/tables/sessions'
import { call } from '@orpc/server'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { uuidv7 } from 'uuidv7'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { getOrHydrateDurableStreamSessionsProcedure as liveGetOrHydrateProcedure } from '../../src/orpc/api/durable-streams/sessions'
import { createMockApiAuth, createMockApiContext } from '../mocks'
import { bindProcedureToRuntime, createRuntimeWithTestPostgresLayer } from '../utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('durableStreams.sessions.getOrHydrate authorization', () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let server: DurableStreamTestServer
	let previousDurableStreamsOrigin: string | undefined
	let effectRuntime: ReturnType<typeof createRuntimeWithTestPostgresLayer> | undefined
	let getOrHydrateDurableStreamSessionsProcedure: typeof liveGetOrHydrateProcedure
	let organizationId: string
	const userId = 'durable-stream-session-user'
	const workosOrganizationId = 'org_durable_stream_sessions'

	function makeContext() {
		return createMockApiContext({
			auth: createMockApiAuth({ userId, organizationId, workosOrganizationId }),
			services: { db, dbReadReplica: db },
		})
	}

	async function createSession(overrides?: { userId?: string; organizationId?: string }) {
		const sessionId = uuidv7()
		await db.insert(sessions).values({
			id: sessionId,
			organization_id: overrides?.organizationId ?? organizationId,
			resource_owner_user_id: overrides?.userId ?? userId,
			created_by: overrides?.userId ?? userId,
			host_id: randomUUID(),
			working_directory: '/tmp/durable-stream-session-test',
			coding_agent: 'claude',
			status: 'ready_for_input',
			provider: 'anthropic',
			model: 'claude-sonnet-4-5',
			permissions_mode: 'default',
		})
		return sessionId
	}

	beforeAll(async () => {
		const testDb = await createTestDb('durable_stream_sessions_auth')
		cleanupTestDb = testDb.cleanup
		db = testDb.db

		const [org] = await db
			.insert(organizations)
			.values({ name: 'durable stream sessions auth test org', workos_organization_id: workosOrganizationId })
			.returning()
		if (!org) throw new Error('Unable to insert organization for setup')
		organizationId = org.id

		server = new DurableStreamTestServer({ port: 0, host: '127.0.0.1' })
		await server.start()
		previousDurableStreamsOrigin = process.env.DURABLE_STREAMS_ORIGIN
		process.env.DURABLE_STREAMS_ORIGIN = server.url

		// Bind the converted Effect procedure to a runtime whose durable-stream config
		// points at the local test server and whose Postgres layer uses the test DB.
		effectRuntime = createRuntimeWithTestPostgresLayer(db, { durableStreamsOrigin: server.url })
		getOrHydrateDurableStreamSessionsProcedure = bindProcedureToRuntime(liveGetOrHydrateProcedure, effectRuntime)
	}, 30000)

	afterAll(async () => {
		if (previousDurableStreamsOrigin === undefined) {
			delete process.env.DURABLE_STREAMS_ORIGIN
		} else {
			process.env.DURABLE_STREAMS_ORIGIN = previousDurableStreamsOrigin
		}
		await effectRuntime?.dispose()
		await server?.stop()
		await cleanupTestDb?.()
	}, 30000)

	test('rejects sessions outside the caller organization before hydrating a stream', async () => {
		const [otherOrg] = await db
			.insert(organizations)
			.values({
				name: 'other durable stream sessions auth test org',
				workos_organization_id: 'org_durable_stream_sessions_auth_other',
			})
			.returning()
		if (!otherOrg) throw new Error('Unable to insert other organization for setup')

		const sessionId = await createSession({
			organizationId: otherOrg.id,
			userId: 'other-durable-stream-session-user',
		})

		await expect(
			call(getOrHydrateDurableStreamSessionsProcedure, { sessionIds: [sessionId] }, { context: makeContext() }),
		).rejects.toMatchObject({ code: 'NOT_FOUND' })
	})

	test('hydrates every authorized conversation event type for the session', async () => {
		const sessionId = await createSession()
		await db.insert(conversationEvents).values([
			{
				id: uuidv7(),
				session_id: sessionId,
				organization_id: organizationId,
				resource_owner_user_id: userId,
				event_type: 'message',
				role: 'assistant',
				content: 'hello',
				created_at: BigInt(1000),
				updated_at: BigInt(1000),
			},
			{
				id: uuidv7(),
				session_id: sessionId,
				organization_id: organizationId,
				resource_owner_user_id: userId,
				event_type: 'thinking',
				role: 'assistant',
				content: 'thinking',
				created_at: BigInt(1001),
				updated_at: BigInt(1001),
			},
			{
				id: uuidv7(),
				session_id: sessionId,
				organization_id: organizationId,
				resource_owner_user_id: userId,
				event_type: 'tool_call',
				role: 'assistant',
				tool_call_id: 'tool-1',
				tool_name: 'Bash',
				tool_input_json: { command: 'pwd' },
				created_at: BigInt(1002),
				updated_at: BigInt(1002),
			},
			{
				id: uuidv7(),
				session_id: sessionId,
				organization_id: organizationId,
				resource_owner_user_id: userId,
				event_type: 'tool_result',
				role: 'user',
				tool_result_for_id: 'tool-1',
				tool_result_content: '/tmp',
				parent_tool_use_id: 'parent-tool',
				created_at: BigInt(1003),
				updated_at: BigInt(1003),
			},
		])

		const result = await call(
			getOrHydrateDurableStreamSessionsProcedure,
			{ sessionIds: [sessionId] },
			{ context: makeContext() },
		)

		expect(result.streams[0]).toMatchObject({ sessionId, status: 'hydrated', eventCount: 4 })
	})
})
