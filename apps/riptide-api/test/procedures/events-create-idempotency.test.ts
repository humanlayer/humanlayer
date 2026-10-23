// File: apps/riptide-api/test/procedures/events-create-idempotency.test.ts
//
// CORE-1634 regression: a duplicate `conversation_events` id must be an idempotent
// no-op, not a 500. The daemon re-sends an insert with an already-persisted id (the
// recovered-thinking replay + the oRPC client retry plugin); before the fix this hit
// `conversation_events_pkey`, returned a 500, and the daemon killed the session.

import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'

import { conversationEvents } from '@humanlayer/db/tables/conversation-events'
import { organizations } from '@humanlayer/db/tables/organizations'
import { sessions } from '@humanlayer/db/tables/sessions'
import { tasks } from '@humanlayer/db/tables/tasks'
import { call } from '@orpc/server'
import { eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { createEventProcedure } from '../../src/orpc/daemon/sessions/events/create'
import { createMockDaemonAuth, createMockDaemonContext } from '../mocks'
import { createMockLinearService } from '../mocks/linear-service.mock'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('Events create: idempotent on duplicate id (CORE-1634)', async () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let organizationId: string
	const userId = 'user_idempotency'
	const hostId = randomUUID()

	beforeAll(async () => {
		const testDb = await createTestDb('events_create_idempotency')
		cleanupTestDb = testDb.cleanup
		db = testDb.db

		const [org] = await db
			.insert(organizations)
			.values({
				name: 'test organization idempotency',
				workos_organization_id: 'org_idempotency_test',
			})
			.returning()
		if (!org) throw new Error('Unable to insert organization for setup')
		organizationId = org.id
	}, 30000)

	async function createSession(name: string) {
		const [task] = await db
			.insert(tasks)
			.values({
				organization_id: organizationId,
				name,
				slug: name,
				resource_owner_user_id: userId,
				created_by: userId,
				default_working_directory: tmpdir(),
				setup_status: 'completed',
			})
			.returning()

		const [session] = await db
			.insert(sessions)
			.values({
				organization_id: organizationId,
				resource_owner_user_id: userId,
				created_by: userId,
				host_id: hostId,
				task_id: task!.id,
				title: name,
				working_directory: tmpdir(),
				coding_agent: 'claude',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissions_mode: 'default',
				status: 'ready_for_input',
			})
			.returning()

		return session!
	}

	function daemonContext() {
		return createMockDaemonContext({
			auth: createMockDaemonAuth({ userId, organizationId, hostId }),
			services: { db, dbReadReplica: db, linear: createMockLinearService({}) },
		})
	}

	async function numEvents(sessionId: string) {
		const [row] = await db
			.select({ num_events: sessions.num_events })
			.from(sessions)
			.where(eq(sessions.id, sessionId))
			.limit(1)
		return row!.num_events
	}

	test('re-sending the same eventId is a no-op, not a 500', async () => {
		const session = await createSession('idempotent-thinking')
		const eventId = randomUUID()

		const firstInput = {
			eventId,
			sessionId: session.id,
			codingAgentSessionId: 'agent-session-dup',
			eventType: 'thinking' as const,
			role: 'assistant' as const,
			content: 'original thinking block',
		}

		// First insert persists the event and increments num_events.
		const first = await call(createEventProcedure, firstInput, { context: daemonContext() })
		expect(first.eventId).toBe(eventId)
		expect(await numEvents(session.id)).toBe(1)
		await db
			.update(sessions)
			.set({ status: 'lost', error_message: 'lost after first insert', last_activity_at: 1n })
			.where(eq(sessions.id, session.id))

		// The daemon replays the SAME id (here even with different content, mirroring a
		// stale re-recovery). This previously threw `conversation_events_pkey` → 500.
		const second = await call(
			createEventProcedure,
			{ ...firstInput, content: 'replayed body that must be ignored' },
			{ context: daemonContext() },
		)

		// No throw; same id returned; a real transactionId comes back.
		expect(second.eventId).toBe(eventId)
		expect(second.transactionId).toBeTruthy()

		// Exactly one row, num_events not double-counted, original content preserved
		// (ON CONFLICT DO NOTHING keeps the first write — the replay is dropped losslessly).
		const rows = await db.select().from(conversationEvents).where(eq(conversationEvents.id, eventId))
		expect(rows).toHaveLength(1)
		expect(rows[0]!.content).toBe('original thinking block')
		expect(await numEvents(session.id)).toBe(1)
		const [sessionAfterDuplicate] = await db.select().from(sessions).where(eq(sessions.id, session.id))
		expect(sessionAfterDuplicate).toMatchObject({
			status: 'lost',
			error_message: 'lost after first insert',
			last_activity_at: 1n,
		})
	})

	test('omitted eventId still generates unique rows (no false idempotency)', async () => {
		const session = await createSession('idempotent-generated-ids')

		const base = {
			sessionId: session.id,
			codingAgentSessionId: 'agent-session-gen',
			eventType: 'message' as const,
			role: 'assistant' as const,
			content: 'a message',
		}

		const a = await call(createEventProcedure, base, { context: daemonContext() })
		const b = await call(createEventProcedure, base, { context: daemonContext() })

		// Two distinct DB-generated ids → two rows, num_events counted twice.
		expect(a.eventId).not.toBe(b.eventId)
		expect(await numEvents(session.id)).toBe(2)
	})

	afterAll(async () => {
		await cleanupTestDb?.()
	}, 30000)
})
