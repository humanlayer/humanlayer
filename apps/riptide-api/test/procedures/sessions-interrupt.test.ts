import { tmpdir } from 'node:os'

import { conversationEvents } from '@humanlayer/db/tables/conversation-events'
import { onlineHosts } from '@humanlayer/db/tables/online-hosts'
import { organizations } from '@humanlayer/db/tables/organizations'
import { queuedMessages } from '@humanlayer/db/tables/queued-messages'
import type { SessionStatus } from '@humanlayer/db/tables/sessions'
import { sessions } from '@humanlayer/db/tables/sessions'
import { call } from '@orpc/server'
import { and, eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { uuidv7 } from 'uuidv7'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { interruptSessionProcedure as liveInterruptSessionProcedure } from '../../src/orpc/api/sessions/interrupt'
import { updateSessionProcedure } from '../../src/orpc/daemon/sessions/update'
import { createMockApiAuth, createMockApiContext, createMockDaemonAuth, createMockDaemonContext } from '../mocks'
import { bindProcedureToRuntime, createRuntimeWithTestPostgresLayer } from '../utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('api/sessions/interrupt', async () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let effectRuntime: ReturnType<typeof createRuntimeWithTestPostgresLayer> | undefined
	let interruptSessionProcedure: typeof liveInterruptSessionProcedure

	let organizationId: string
	const workosOrganizationId = 'org_sessions_interrupt'
	const userId = 'user_sessions_interrupt'
	const hostId = uuidv7()

	beforeAll(async () => {
		const testDb = await createTestDb('sessions_interrupt')
		cleanupTestDb = testDb.cleanup
		db = testDb.db
		effectRuntime = createRuntimeWithTestPostgresLayer(db)
		interruptSessionProcedure = bindProcedureToRuntime(liveInterruptSessionProcedure, effectRuntime)

		const [org] = await db
			.insert(organizations)
			.values({ name: 'Test Org - Sessions Interrupt', workos_organization_id: workosOrganizationId })
			.returning()
		if (!org) throw new Error('Unable to insert organization for setup')
		organizationId = org.id

		// Register a host so sessions can reference it
		await db.insert(onlineHosts).values({
			host_id: hostId,
			user_id: userId,
			organization_id: organizationId,
		})
	}, 60000)

	afterAll(async () => {
		await effectRuntime?.dispose()
		await cleanupTestDb?.()
	}, 30000)

	function makeContext(uid = userId) {
		return createMockApiContext({
			auth: createMockApiAuth({ userId: uid, organizationId, workosOrganizationId }),
			services: { db, dbReadReplica: db },
		})
	}

	function makeDaemonContext() {
		return createMockDaemonContext({
			auth: createMockDaemonAuth({ userId, organizationId, hostId }),
			services: { db, dbReadReplica: db },
		})
	}

	/** Helper to create a session with a given status */
	async function createSessionWithStatus(status: SessionStatus) {
		const sessionId = uuidv7()
		await db.insert(sessions).values({
			id: sessionId,
			organization_id: organizationId,
			resource_owner_user_id: userId,
			created_by: userId,
			host_id: hostId,
			status,
			prompt: 'test prompt',
			working_directory: tmpdir(),
			last_activity_at: BigInt(Date.now()),
		})
		return sessionId
	}

	test('interrupts a running session', async () => {
		const sessionId = await createSessionWithStatus('running')

		const result = await call(interruptSessionProcedure, { sessionId }, { context: makeContext() })

		expect(result.success).toBe(true)
		expect(result.transactionId).toBeTypeOf('string')

		const [updated] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1)
		expect(updated!.status).toBe('interrupt_requested')
	})

	test('interrupts a needs_approval session', async () => {
		const sessionId = await createSessionWithStatus('needs_approval')

		const result = await call(interruptSessionProcedure, { sessionId }, { context: makeContext() })

		expect(result.success).toBe(true)
		expect(result.transactionId).toBeTypeOf('string')

		const [updated] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1)
		expect(updated!.status).toBe('interrupt_requested')
	})

	test('interrupts a launching session', async () => {
		const sessionId = await createSessionWithStatus('launching')

		const result = await call(interruptSessionProcedure, { sessionId }, { context: makeContext() })

		expect(result.success).toBe(true)
		const [updated] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1)
		expect(updated!.status).toBe('interrupt_requested')
	})

	test('rejects interrupt for failed session', async () => {
		const sessionId = await createSessionWithStatus('failed')

		await expect(call(interruptSessionProcedure, { sessionId }, { context: makeContext() })).rejects.toThrow()
	})

	test('rejects interrupt for ready_for_input session', async () => {
		const sessionId = await createSessionWithStatus('ready_for_input')

		await expect(call(interruptSessionProcedure, { sessionId }, { context: makeContext() })).rejects.toThrow()
	})

	test('rejects interrupt for interrupted session', async () => {
		const sessionId = await createSessionWithStatus('interrupted')

		await expect(call(interruptSessionProcedure, { sessionId }, { context: makeContext() })).rejects.toThrow()
	})

	test('interrupt with message inserts flagged queue row, does not write prompt or bump num_events', async () => {
		const sessionId = await createSessionWithStatus('running')

		const [before] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1)
		const eventsBefore = before!.num_events

		const result = await call(
			interruptSessionProcedure,
			{ sessionId, message: 'Stop and do something else' },
			{ context: makeContext() },
		)

		expect(result.success).toBe(true)
		const [updated] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1)
		expect(updated!.status).toBe('interrupt_requested')
		// Prompt should NOT be updated -- the flagged queue row carries the content
		expect(updated!.prompt).toBe('test prompt')
		// num_events should NOT be bumped -- the drain handles that at delivery
		expect(updated!.num_events).toBe(eventsBefore ?? 0)

		// A flagged queue row should exist with the message content and user attribution
		const rows = await db.select().from(queuedMessages).where(eq(queuedMessages.session_id, sessionId))
		expect(rows).toHaveLength(1)
		expect(rows[0]!.content).toBe('Stop and do something else')
		expect(rows[0]!.status).toBe('pending')
		expect(rows[0]!.deliver_on_interrupt).toBe(true)
		expect(rows[0]!.user_id).toBe(userId)
	})

	test('interrupt with message on needs_approval session inserts flagged queue row', async () => {
		const sessionId = await createSessionWithStatus('needs_approval')

		const result = await call(
			interruptSessionProcedure,
			{ sessionId, message: 'Nevermind, do this instead' },
			{ context: makeContext() },
		)

		expect(result.success).toBe(true)
		const [updated] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1)
		expect(updated!.status).toBe('interrupt_requested')
		// Prompt should NOT be updated
		expect(updated!.prompt).toBe('test prompt')

		// Flagged queue row should exist
		const rows = await db.select().from(queuedMessages).where(eq(queuedMessages.session_id, sessionId))
		expect(rows).toHaveLength(1)
		expect(rows[0]!.content).toBe('Nevermind, do this instead')
		expect(rows[0]!.deliver_on_interrupt).toBe(true)
		expect(rows[0]!.user_id).toBe(userId)
	})

	test('rejects interrupt from unauthorized user', async () => {
		const sessionId = await createSessionWithStatus('running')

		await expect(
			call(interruptSessionProcedure, { sessionId }, { context: makeContext('different-user-id') }),
		).rejects.toThrow()
	})

	test('interrupt(message) end-to-end: daemon interrupted report drains flagged row with attribution', async () => {
		const sessionId = await createSessionWithStatus('running')

		// User sends interrupt with message -- inserts flagged queue row
		const result = await call(
			interruptSessionProcedure,
			{ sessionId, message: 'change direction' },
			{ context: makeContext() },
		)
		expect(result.success).toBe(true)

		// Daemon reports interrupted -- drain delivers the flagged row
		await call(updateSessionProcedure, { sessionId, status: 'interrupted' }, { context: makeDaemonContext() })

		// Session should be resuming with the prompt set
		const [session] = await db
			.select({ status: sessions.status, prompt: sessions.prompt, num_events: sessions.num_events })
			.from(sessions)
			.where(eq(sessions.id, sessionId))
		expect(session!.status).toBe('resuming')
		expect(session!.prompt).toBe('change direction')
		expect(session!.num_events).toBe(1)

		// Attributed conversation event should exist
		const events = await db
			.select({
				content: conversationEvents.content,
				user_id: conversationEvents.user_id,
				role: conversationEvents.role,
			})
			.from(conversationEvents)
			.where(and(eq(conversationEvents.session_id, sessionId), eq(conversationEvents.role, 'user')))
		expect(events).toHaveLength(1)
		expect(events[0]!.content).toBe('change direction')
		expect(events[0]!.user_id).toBe(userId)

		// Queue row should be marked delivered
		const rows = await db.select().from(queuedMessages).where(eq(queuedMessages.session_id, sessionId))
		expect(rows).toHaveLength(1)
		expect(rows[0]!.status).toBe('delivered')
	})
})
