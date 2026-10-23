import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'

import { conversationEvents } from '@humanlayer/db/tables/conversation-events'
import { organizations } from '@humanlayer/db/tables/organizations'
import { queuedMessages } from '@humanlayer/db/tables/queued-messages'
import { sessions } from '@humanlayer/db/tables/sessions'
import { call } from '@orpc/server'
import { and, asc, eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { uuidv7 } from 'uuidv7'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { updateSessionProcedure } from '../../src/orpc/daemon/sessions/update'
import { createMockDaemonAuth, createMockDaemonContext } from '../mocks'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('daemon/sessions/update interrupt drain (deliver_on_interrupt)', async () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let organizationId: string
	const userId = 'user_interrupt_drain'
	const hostId = randomUUID()

	beforeAll(async () => {
		const testDb = await createTestDb('daemon_interrupt_drain')
		cleanupTestDb = testDb.cleanup
		db = testDb.db

		const [org] = await db
			.insert(organizations)
			.values({ name: 'Interrupt Drain Org', workos_organization_id: `workos-org-${randomUUID()}` })
			.returning()

		if (!org) throw new Error('Unable to insert organization for setup')
		organizationId = org.id
	}, 30000)

	afterAll(async () => {
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
				title: 'interrupt drain session',
				working_directory: tmpdir(),
				coding_agent: 'claude',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissions_mode: 'default',
				status: 'running',
				num_events: 5,
				...overrides,
			})
			.returning()

		if (!session) throw new Error('Unable to insert session for setup')
		return session
	}

	const createDaemonContext = () => ({
		context: createMockDaemonContext({
			auth: createMockDaemonAuth({ userId, organizationId, hostId }),
			services: {
				db,
				dbReadReplica: db,
			},
		}),
	})

	const seedQueuedMessage = async (
		sessionId: string,
		content: string,
		opts: {
			minutesAgo?: number
			senderUserId?: string | null
			authorDisplayName?: string | null
			deliverOnInterrupt?: boolean
		} = {},
	) => {
		const { minutesAgo = 0, senderUserId = userId, authorDisplayName = null, deliverOnInterrupt = false } = opts
		const id = uuidv7()
		await db.insert(queuedMessages).values({
			id,
			session_id: sessionId,
			organization_id: organizationId,
			resource_owner_user_id: userId,
			user_id: senderUserId,
			author_display_name: authorDisplayName,
			multiplayer_prompting_active: authorDisplayName !== null,
			content,
			status: 'pending',
			deliver_on_interrupt: deliverOnInterrupt,
			created_at: BigInt(Date.now() - minutesAgo * 60_000),
		})
		return id
	}

	test('interrupted with flagged rows: attributed conv events + resuming', async () => {
		const session = await createSession({ num_events: 10 })

		// Insert a flagged row (interrupt-and-send message)
		const msgId = await seedQueuedMessage(session.id, 'Fix the bug please', {
			senderUserId: 'author-alice',
			authorDisplayName: 'Alice Ng',
			deliverOnInterrupt: true,
		})

		await call(updateSessionProcedure, { sessionId: session.id, status: 'interrupted' }, createDaemonContext())

		// Session should be overridden to resuming with the prompt set
		const [updated] = await db.select().from(sessions).where(eq(sessions.id, session.id))
		expect(updated?.status).toBe('resuming')
		expect(updated?.prompt).toBe('<message from="Alice Ng">\nFix the bug please\n</message>')
		expect(updated?.num_events).toBe(11)

		// Queue row should be marked delivered
		const [queueRow] = await db.select().from(queuedMessages).where(eq(queuedMessages.id, msgId))
		expect(queueRow?.status).toBe('delivered')

		// A conversation event should be inserted with the author's user_id
		const events = await db
			.select()
			.from(conversationEvents)
			.where(
				and(
					eq(conversationEvents.session_id, session.id),
					eq(conversationEvents.role, 'user'),
					eq(conversationEvents.event_type, 'message'),
				),
			)

		expect(events).toHaveLength(1)
		expect(events[0]?.id).toBe(msgId)
		expect(events[0]?.content).toBe('Fix the bug please')
		expect(events[0]?.user_id).toBe('author-alice')
		expect(events[0]?.organization_id).toBe(organizationId)
		expect(events[0]?.resource_owner_user_id).toBe(userId)
		expect(events[0]?.task_id).toBe(session.task_id)
	})

	test('interrupted with no flagged rows: stays interrupted (plain interrupt)', async () => {
		const session = await createSession()

		// Insert an unflagged pending message (normal queue, not interrupt-and-send)
		await seedQueuedMessage(session.id, 'I will wait my turn', {
			deliverOnInterrupt: false,
		})

		await call(updateSessionProcedure, { sessionId: session.id, status: 'interrupted' }, createDaemonContext())

		// Session stays interrupted — no resume override
		const [updated] = await db.select().from(sessions).where(eq(sessions.id, session.id))
		expect(updated?.status).toBe('interrupted')

		// The unflagged message stays pending
		const rows = await db.select().from(queuedMessages).where(eq(queuedMessages.session_id, session.id))

		expect(rows).toHaveLength(1)
		expect(rows[0]?.status).toBe('pending')

		// No conversation events inserted
		const events = await db
			.select()
			.from(conversationEvents)
			.where(
				and(
					eq(conversationEvents.session_id, session.id),
					eq(conversationEvents.role, 'user'),
					eq(conversationEvents.event_type, 'message'),
				),
			)

		expect(events).toHaveLength(0)
	})

	test('interrupted with multiple flagged rows from different authors: all delivered and attributed', async () => {
		const session = await createSession({ num_events: 5 })

		// Two users interrupt-and-send concurrently
		const msgId1 = await seedQueuedMessage(session.id, 'Alice says fix it', {
			senderUserId: 'author-alice',
			authorDisplayName: 'Alice Ng',
			deliverOnInterrupt: true,
			minutesAgo: 2,
		})
		const msgId2 = await seedQueuedMessage(session.id, 'Bob says add tests', {
			senderUserId: 'author-bob',
			authorDisplayName: 'Bob Tran',
			deliverOnInterrupt: true,
			minutesAgo: 1,
		})

		await call(updateSessionProcedure, { sessionId: session.id, status: 'interrupted' }, createDaemonContext())

		// Session resumes with concatenated prompt
		const [updated] = await db.select().from(sessions).where(eq(sessions.id, session.id))
		expect(updated?.status).toBe('resuming')
		expect(updated?.prompt).toBe(
			[
				'<message from="Alice Ng">\nAlice says fix it\n</message>',
				'<message from="Bob Tran">\nBob says add tests\n</message>',
			].join('\n\n'),
		)
		expect(updated?.num_events).toBe(7)

		// Both queue rows marked delivered
		const rows = await db
			.select()
			.from(queuedMessages)
			.where(eq(queuedMessages.session_id, session.id))
			.orderBy(asc(queuedMessages.created_at))

		expect(rows).toHaveLength(2)
		expect(rows[0]?.id).toBe(msgId1)
		expect(rows[0]?.status).toBe('delivered')
		expect(rows[1]?.id).toBe(msgId2)
		expect(rows[1]?.status).toBe('delivered')

		// Two attributed conversation events in created_at order
		const events = await db
			.select()
			.from(conversationEvents)
			.where(
				and(
					eq(conversationEvents.session_id, session.id),
					eq(conversationEvents.role, 'user'),
					eq(conversationEvents.event_type, 'message'),
				),
			)
			.orderBy(asc(conversationEvents.created_at))

		expect(events).toHaveLength(2)
		expect(events[0]?.content).toBe('Alice says fix it')
		expect(events[0]?.user_id).toBe('author-alice')
		expect(events[1]?.content).toBe('Bob says add tests')
		expect(events[1]?.user_id).toBe('author-bob')
	})

	test('interrupted drain delivers only flagged rows, leaves unflagged pending', async () => {
		const session = await createSession()

		// One flagged (interrupt-and-send) + one unflagged (normal queue)
		const flaggedId = await seedQueuedMessage(session.id, 'Urgent fix', {
			senderUserId: 'author-alice',
			authorDisplayName: 'Alice Ng',
			deliverOnInterrupt: true,
			minutesAgo: 2,
		})
		const unflaggedId = await seedQueuedMessage(session.id, 'Later task', {
			senderUserId: 'author-bob',
			deliverOnInterrupt: false,
			minutesAgo: 1,
		})

		await call(updateSessionProcedure, { sessionId: session.id, status: 'interrupted' }, createDaemonContext())

		const [updated] = await db.select().from(sessions).where(eq(sessions.id, session.id))
		expect(updated?.status).toBe('resuming')
		expect(updated?.prompt).toBe('<message from="Alice Ng">\nUrgent fix\n</message>')

		const rows = await db
			.select()
			.from(queuedMessages)
			.where(eq(queuedMessages.session_id, session.id))
			.orderBy(asc(queuedMessages.created_at))

		expect(rows).toHaveLength(2)
		// Flagged row: delivered
		const flaggedRow = rows.find((r) => r.id === flaggedId)
		expect(flaggedRow?.status).toBe('delivered')
		// Unflagged row: still pending
		const unflaggedRow = rows.find((r) => r.id === unflaggedId)
		expect(unflaggedRow?.status).toBe('pending')
	})

	test('ready_for_input drain still delivers all pending rows (regression)', async () => {
		const session = await createSession({ num_events: 5 })

		// Both flagged and unflagged should be delivered in completion mode
		await seedQueuedMessage(session.id, 'Flagged msg', {
			senderUserId: 'author-alice',
			authorDisplayName: 'Alice Ng',
			deliverOnInterrupt: true,
			minutesAgo: 2,
		})
		await seedQueuedMessage(session.id, 'Normal msg', {
			senderUserId: 'author-bob',
			authorDisplayName: 'Bob Tran',
			deliverOnInterrupt: false,
			minutesAgo: 1,
		})

		await call(updateSessionProcedure, { sessionId: session.id, status: 'ready_for_input' }, createDaemonContext())

		// Session resumes with both messages
		const [updated] = await db.select().from(sessions).where(eq(sessions.id, session.id))
		expect(updated?.status).toBe('resuming')
		expect(updated?.prompt).toBe(
			[
				'<message from="Alice Ng">\nFlagged msg\n</message>',
				'<message from="Bob Tran">\nNormal msg\n</message>',
			].join('\n\n'),
		)
		expect(updated?.num_events).toBe(7)

		// Both rows marked delivered
		const rows = await db.select().from(queuedMessages).where(eq(queuedMessages.session_id, session.id))

		expect(rows).toHaveLength(2)
		expect(rows.every((r) => r.status === 'delivered')).toBe(true)

		// Both conversation events inserted with correct attribution
		const events = await db
			.select()
			.from(conversationEvents)
			.where(
				and(
					eq(conversationEvents.session_id, session.id),
					eq(conversationEvents.role, 'user'),
					eq(conversationEvents.event_type, 'message'),
				),
			)
			.orderBy(asc(conversationEvents.created_at))

		expect(events).toHaveLength(2)
		expect(events.map((e) => e.user_id)).toEqual(['author-alice', 'author-bob'])
	})

	test('ready_for_input with no pending messages stays ready_for_input (regression)', async () => {
		const session = await createSession()

		await call(updateSessionProcedure, { sessionId: session.id, status: 'ready_for_input' }, createDaemonContext())

		const [updated] = await db.select().from(sessions).where(eq(sessions.id, session.id))
		expect(updated?.status).toBe('ready_for_input')
	})
})
