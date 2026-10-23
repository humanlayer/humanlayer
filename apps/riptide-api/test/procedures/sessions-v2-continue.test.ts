import { tmpdir } from 'node:os'

import { conversationEvents } from '@humanlayer/db/tables/conversation-events'
import { onlineHosts } from '@humanlayer/db/tables/online-hosts'
import { organizationSettings } from '@humanlayer/db/tables/organization-settings'
import { organizations } from '@humanlayer/db/tables/organizations'
import { queuedMessages } from '@humanlayer/db/tables/queued-messages'
import type { SessionStatus } from '@humanlayer/db/tables/sessions'
import { sessions } from '@humanlayer/db/tables/sessions'
import { userSettings } from '@humanlayer/db/tables/user-settings'
import { call } from '@orpc/server'
import { and, asc, eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { uuidv7 } from 'uuidv7'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { continueSessionV2Procedure as liveContinueSessionV2Procedure } from '../../src/orpc/api/sessions/v2/continue'
import { updateSessionProcedure } from '../../src/orpc/daemon/sessions/update'
import { createMockApiAuth, createMockApiContext, createMockDaemonAuth, createMockDaemonContext } from '../mocks'
import { bindProcedureToRuntime, createRuntimeWithTestPostgresLayer } from '../utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('continueSessionV2Procedure', async () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let effectRuntime: ReturnType<typeof createRuntimeWithTestPostgresLayer> | undefined
	let continueSessionV2Procedure: typeof liveContinueSessionV2Procedure

	let organizationId: string
	const workosOrganizationId = 'org_v2_continue'
	const userId = 'user_v2_continue'
	const hostId = uuidv7()

	beforeAll(async () => {
		const testDb = await createTestDb('sessions_v2_continue')
		cleanupTestDb = testDb.cleanup
		db = testDb.db
		effectRuntime = createRuntimeWithTestPostgresLayer(db)
		continueSessionV2Procedure = bindProcedureToRuntime(liveContinueSessionV2Procedure, effectRuntime)

		const [org] = await db
			.insert(organizations)
			.values({ name: 'Test Org - v2 continue', workos_organization_id: workosOrganizationId })
			.returning()
		if (!org) throw new Error('Unable to insert organization for setup')
		organizationId = org.id

		await db.insert(organizationSettings).values({ organization_id: organizationId })
		await db.insert(onlineHosts).values({ host_id: hostId, user_id: userId, organization_id: organizationId })
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

	async function createSessionWithStatus(status: SessionStatus, ownerUserId: string = userId, errorMessage?: string) {
		const sessionId = uuidv7()
		await db.insert(sessions).values({
			id: sessionId,
			organization_id: organizationId,
			resource_owner_user_id: ownerUserId,
			created_by: ownerUserId,
			host_id: hostId,
			status,
			error_message: errorMessage,
			prompt: 'test prompt',
			working_directory: tmpdir(),
			last_activity_at: BigInt(Date.now()),
		})
		return sessionId
	}

	// The batch_mode=false tests use freshly minted user ids so user_settings rows
	// stay local when Bun runs tests concurrently.
	async function setUserBatchDelivery(uid: string, prefer: boolean) {
		await db
			.insert(userSettings)
			.values({ user_id: uid, organization_id: organizationId, prefer_batch_queue_delivery: prefer })
			.onConflictDoUpdate({
				target: [userSettings.user_id, userSettings.organization_id],
				set: { prefer_batch_queue_delivery: prefer },
			})
	}

	async function insertPending(
		sessionId: string,
		content: string,
		createdAt: bigint,
		ownerUserId: string = userId,
		senderUserId: string | null = userId,
		deliverOnInterrupt = false,
		authorDisplayName: string | null = null,
	) {
		const id = uuidv7()
		await db.insert(queuedMessages).values({
			id,
			session_id: sessionId,
			organization_id: organizationId,
			resource_owner_user_id: ownerUserId,
			user_id: senderUserId,
			author_display_name: authorDisplayName,
			multiplayer_prompting_active: authorDisplayName !== null,
			content,
			status: 'pending',
			deliver_on_interrupt: deliverOnInterrupt,
			created_at: createdAt,
			updated_at: createdAt,
		})
		return id
	}

	test("intent='queue' x running -> kind='queued', row inserted", async () => {
		const sessionId = await createSessionWithStatus('running')
		const result = await call(
			continueSessionV2Procedure,
			{ sessionId, text: 'queue me', intent: 'queue' },
			{ context: makeContext() },
		)

		expect(result.kind).toBe('queued')
		if (result.kind === 'queued') expect(result.transactionId).toBeTypeOf('string')

		const rows = await db.select().from(queuedMessages).where(eq(queuedMessages.session_id, sessionId))
		expect(rows).toHaveLength(1)
		expect(rows[0]!.status).toBe('pending')
		expect(rows[0]!.content).toBe('queue me')
		expect(rows[0]!.user_id).toBe(userId)
		expect(rows[0]!.author_display_name).toBeNull()
		expect(rows[0]!.multiplayer_prompting_active).toBe(false)

		const events = await db.select().from(conversationEvents).where(eq(conversationEvents.session_id, sessionId))
		expect(events).toHaveLength(0)

		const [session] = await db.select({ status: sessions.status }).from(sessions).where(eq(sessions.id, sessionId))
		expect(session!.status).toBe('running')
	})

	test("intent='queue' x multiplayer collaborator -> stores the collaborator display name", async () => {
		const collaboratorUserId = 'user_v2_continue_collaborator'
		const sessionId = await createSessionWithStatus('running')
		await db
			.update(sessions)
			.set({
				multiplayer_prompting_user_ids: [collaboratorUserId],
				multiplayer_prompting_started_at: BigInt(Date.now() - 1000),
				multiplayer_prompting_expires_at: null,
			})
			.where(eq(sessions.id, sessionId))

		const result = await call(
			continueSessionV2Procedure,
			{ sessionId, text: 'collaborator message', intent: 'queue' },
			{ context: makeContext(collaboratorUserId) },
		)

		expect(result.kind).toBe('queued')
		const [row] = await db.select().from(queuedMessages).where(eq(queuedMessages.session_id, sessionId))
		expect(row?.author_display_name).toBe(collaboratorUserId)
		expect(row?.multiplayer_prompting_active).toBe(true)
	})

	test("intent='send' x multiplayer on -> the owner's own message is wrapped too", async () => {
		const sessionId = await createSessionWithStatus('ready_for_input')
		await db
			.update(sessions)
			.set({
				multiplayer_prompting_user_ids: ['user_v2_continue_collaborator'],
				multiplayer_prompting_started_at: BigInt(Date.now() - 1000),
				multiplayer_prompting_expires_at: null,
			})
			.where(eq(sessions.id, sessionId))
		await insertPending(
			sessionId,
			'from dexter',
			BigInt(Date.now()),
			userId,
			'user_v2_continue_collaborator',
			false,
			'Dexter Horthy',
		)

		const result = await call(
			continueSessionV2Procedure,
			{ sessionId, text: 'from the owner', intent: 'send' },
			{ context: makeContext() },
		)

		expect(result.kind).toBe('continued')
		const [session] = await db.select({ prompt: sessions.prompt }).from(sessions).where(eq(sessions.id, sessionId))
		expect(session!.prompt).toBe(
			[
				`<message from="${userId}">\nfrom the owner\n</message>`,
				'<message from="Dexter Horthy">\nfrom dexter\n</message>',
			].join('\n\n'),
		)
	})

	test("intent='queue' x ready_for_input -> kind='continued', no queued row, conv event written", async () => {
		const sessionId = await createSessionWithStatus('ready_for_input')
		const result = await call(
			continueSessionV2Procedure,
			{ sessionId, text: 'continue me', intent: 'queue' },
			{ context: makeContext() },
		)

		expect(result.kind).toBe('continued')
		if (result.kind === 'continued') expect(result.transactionId).toBeTypeOf('string')

		const rows = await db.select().from(queuedMessages).where(eq(queuedMessages.session_id, sessionId))
		expect(rows).toHaveLength(0)

		const events = await db.select().from(conversationEvents).where(eq(conversationEvents.session_id, sessionId))
		expect(events).toHaveLength(1)
		expect(events[0]!.content).toBe('continue me')
		expect(events[0]!.role).toBe('user')

		const [session] = await db
			.select({ status: sessions.status, prompt: sessions.prompt })
			.from(sessions)
			.where(eq(sessions.id, sessionId))
		expect(session!.status).toBe('resuming')
		expect(session!.prompt).toBe('continue me')
	})

	test('preserves pinned Opus 5.5 settings when continuing', async () => {
		const sessionId = await createSessionWithStatus('ready_for_input')
		await db
			.update(sessions)
			.set({
				coding_agent: 'claude',
				provider: 'anthropic',
				model: 'claude-opus-5-5',
				effort: 'max',
				fast_mode: false,
			})
			.where(eq(sessions.id, sessionId))

		const result = await call(
			continueSessionV2Procedure,
			{ sessionId, text: 'continue pinned Opus 5.5', intent: 'send' },
			{ context: makeContext() },
		)

		expect(result.kind).toBe('continued')
		const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId))
		expect(session).toMatchObject({
			status: 'resuming',
			model: 'claude-opus-5-5',
			effort: 'max',
			fast_mode: false,
		})
	})

	test("intent='send' x lost resumes immediately and clears the warning", async () => {
		const sessionId = await createSessionWithStatus('lost', userId, 'session appears lost')
		const result = await call(
			continueSessionV2Procedure,
			{ sessionId, text: 'retry now', intent: 'send' },
			{ context: makeContext() },
		)

		expect(result.kind).toBe('continued')
		expect(await db.select().from(queuedMessages).where(eq(queuedMessages.session_id, sessionId))).toHaveLength(0)
		expect(
			await db.select().from(conversationEvents).where(eq(conversationEvents.session_id, sessionId)),
		).toHaveLength(1)
		const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId))
		expect(session).toMatchObject({ status: 'resuming', error_message: null, prompt: 'retry now' })
	})

	test("intent='queue' x ready_for_input with N pending -> drains all N+1 messages", async () => {
		const sessionId = await createSessionWithStatus('ready_for_input')
		const now = BigInt(Date.now())
		await insertPending(sessionId, 'first', now, userId, 'original-sender-1', false, 'Dexter Horthy')
		await insertPending(sessionId, 'second', now + 1n, userId, null)

		const result = await call(
			continueSessionV2Procedure,
			{ sessionId, text: 'newest', intent: 'queue' },
			{ context: makeContext() },
		)

		expect(result.kind).toBe('continued')
		const [session] = await db
			.select({ status: sessions.status, prompt: sessions.prompt, num_events: sessions.num_events })
			.from(sessions)
			.where(eq(sessions.id, sessionId))
		expect(session!.status).toBe('resuming')
		expect(session!.prompt).toBe(
			['newest', '<message from="Dexter Horthy">\nfirst\n</message>', 'second'].join('\n\n'),
		)
		expect(session!.num_events).toBe(3)

		const rows = await db.select().from(queuedMessages).where(eq(queuedMessages.session_id, sessionId))
		expect(rows).toHaveLength(2)
		expect(rows.every((row) => row.status === 'delivered')).toBe(true)

		const events = await db
			.select({ content: conversationEvents.content, user_id: conversationEvents.user_id })
			.from(conversationEvents)
			.where(eq(conversationEvents.session_id, sessionId))
			.orderBy(asc(conversationEvents.created_at))
		expect(events.map((event) => event.content)).toEqual(['newest', 'first', 'second'])
		expect(events.map((event) => event.user_id)).toEqual([userId, 'original-sender-1', null])
	})

	test("intent='send' x running -> kind='queued' (fall-through)", async () => {
		const sessionId = await createSessionWithStatus('running')
		const result = await call(
			continueSessionV2Procedure,
			{ sessionId, text: 'oops session is still busy', intent: 'send' },
			{ context: makeContext() },
		)

		expect(result.kind).toBe('queued')
	})

	test("intent='send' x ready_for_input with pending -> kind='continued', drain runs", async () => {
		const sessionId = await createSessionWithStatus('ready_for_input')
		await insertPending(sessionId, 'older', BigInt(Date.now()))

		const result = await call(
			continueSessionV2Procedure,
			{ sessionId, text: 'send-explicit', intent: 'send' },
			{ context: makeContext() },
		)

		expect(result.kind).toBe('continued')
		const [session] = await db.select({ prompt: sessions.prompt }).from(sessions).where(eq(sessions.id, sessionId))
		expect(session!.prompt).toBe(['send-explicit', 'older'].join('\n\n'))
	})

	test("batch_mode=false: intent='queue' x ready_for_input with N pending -> only new text sent, pending stays pending", async () => {
		const oatUserId = `user_v2_continue_oat_${uuidv7()}`
		await setUserBatchDelivery(oatUserId, false)
		const sessionId = await createSessionWithStatus('ready_for_input', oatUserId)
		const now = BigInt(Date.now())
		const firstId = await insertPending(sessionId, 'first', now, oatUserId)
		const secondId = await insertPending(sessionId, 'second', now + 1n, oatUserId)

		const result = await call(
			continueSessionV2Procedure,
			{ sessionId, text: 'newest', intent: 'queue' },
			{ context: makeContext(oatUserId) },
		)

		expect(result.kind).toBe('continued')

		const [session] = await db
			.select({ status: sessions.status, prompt: sessions.prompt, num_events: sessions.num_events })
			.from(sessions)
			.where(eq(sessions.id, sessionId))
		expect(session!.status).toBe('resuming')
		expect(session!.prompt).toBe('newest')
		expect(session!.num_events).toBe(1)

		const rows = await db
			.select()
			.from(queuedMessages)
			.where(eq(queuedMessages.session_id, sessionId))
			.orderBy(asc(queuedMessages.created_at))
		expect(rows).toHaveLength(2)
		expect(rows[0]!.id).toBe(firstId)
		expect(rows[0]!.status).toBe('pending')
		expect(rows[1]!.id).toBe(secondId)
		expect(rows[1]!.status).toBe('pending')

		const events = await db
			.select({ content: conversationEvents.content })
			.from(conversationEvents)
			.where(eq(conversationEvents.session_id, sessionId))
		expect(events.map((event) => event.content)).toEqual(['newest'])
	})

	test("batch_mode=false: intent='send' x ready_for_input with pending -> only new text sent, pending stays pending", async () => {
		const oatUserId = `user_v2_continue_oat_${uuidv7()}`
		await setUserBatchDelivery(oatUserId, false)
		const sessionId = await createSessionWithStatus('ready_for_input', oatUserId)
		const olderId = await insertPending(sessionId, 'older', BigInt(Date.now()), oatUserId)

		const result = await call(
			continueSessionV2Procedure,
			{ sessionId, text: 'send-explicit', intent: 'send' },
			{ context: makeContext(oatUserId) },
		)

		expect(result.kind).toBe('continued')
		const [session] = await db
			.select({ prompt: sessions.prompt, num_events: sessions.num_events })
			.from(sessions)
			.where(eq(sessions.id, sessionId))
		expect(session!.prompt).toBe('send-explicit')
		expect(session!.num_events).toBe(1)

		const [row] = await db.select().from(queuedMessages).where(eq(queuedMessages.id, olderId))
		expect(row!.status).toBe('pending')
	})

	test("intent='interrupt_and_send' x running -> flagged queue row, no prompt write, no conv event", async () => {
		const sessionId = await createSessionWithStatus('running')
		await insertPending(sessionId, 'queued-during-run', BigInt(Date.now()))

		const result = await call(
			continueSessionV2Procedure,
			{ sessionId, text: 'interrupt-me', intent: 'interrupt_and_send' },
			{ context: makeContext() },
		)

		expect(result.kind).toBe('continued')
		if (result.kind === 'continued') expect(result.transactionId).toBeTypeOf('string')

		const [session] = await db
			.select({ status: sessions.status, prompt: sessions.prompt, num_events: sessions.num_events })
			.from(sessions)
			.where(eq(sessions.id, sessionId))
		expect(session!.status).toBe('interrupt_requested')
		// No prompt write — the flagged queue row carries the content
		expect(session!.prompt).toBe('test prompt')
		// No num_events bump — the drain handles that at delivery
		expect(session!.num_events).toBe(0)

		const events = await db.select().from(conversationEvents).where(eq(conversationEvents.session_id, sessionId))
		expect(events).toHaveLength(0)

		const rows = await db
			.select()
			.from(queuedMessages)
			.where(eq(queuedMessages.session_id, sessionId))
			.orderBy(asc(queuedMessages.created_at))
		// Two rows: the original unflagged pending + the new flagged row
		expect(rows).toHaveLength(2)
		// Original stays pending and unflagged
		expect(rows[0]!.content).toBe('queued-during-run')
		expect(rows[0]!.status).toBe('pending')
		expect(rows[0]!.deliver_on_interrupt).toBe(false)
		// New flagged row for the interrupt-and-send message
		expect(rows[1]!.content).toBe('interrupt-me')
		expect(rows[1]!.status).toBe('pending')
		expect(rows[1]!.deliver_on_interrupt).toBe(true)
		expect(rows[1]!.user_id).toBe(userId)
	})

	test("intent='interrupt_and_send' x ready_for_input -> behaves as send and inserts conversation event", async () => {
		const sessionId = await createSessionWithStatus('ready_for_input')
		const result = await call(
			continueSessionV2Procedure,
			{ sessionId, text: 'ias', intent: 'interrupt_and_send' },
			{ context: makeContext() },
		)

		expect(result.kind).toBe('continued')
		const [session] = await db.select({ status: sessions.status }).from(sessions).where(eq(sessions.id, sessionId))
		expect(session!.status).toBe('resuming')

		const events = await db.select().from(conversationEvents).where(eq(conversationEvents.session_id, sessionId))
		expect(events).toHaveLength(1)
		expect(events[0]!.content).toBe('ias')
	})

	test('unauthorized user -> rejected with reason=forbidden', async () => {
		const sessionId = await createSessionWithStatus('running')
		const result = await call(
			continueSessionV2Procedure,
			{ sessionId, text: 't', intent: 'queue' },
			{ context: makeContext('user_other') },
		)

		expect(result).toEqual({ kind: 'rejected', reason: 'forbidden' })
	})

	test('non-existent session -> rejected with reason=not_found', async () => {
		const result = await call(
			continueSessionV2Procedure,
			{ sessionId: uuidv7(), text: 't', intent: 'queue' },
			{ context: makeContext() },
		)

		expect(result).toEqual({ kind: 'rejected', reason: 'not_found' })
	})

	test('end-to-end: interrupt_and_send -> daemon interrupted report -> attributed conv events', async () => {
		const sessionId = await createSessionWithStatus('running')

		// User sends interrupt-and-send — inserts flagged queue row
		const result = await call(
			continueSessionV2Procedure,
			{ sessionId, text: 'fix this bug', intent: 'interrupt_and_send' },
			{ context: makeContext() },
		)
		expect(result.kind).toBe('continued')

		// Daemon reports interrupted — drain delivers the flagged row
		await call(updateSessionProcedure, { sessionId, status: 'interrupted' }, { context: makeDaemonContext() })

		// Session should be resuming with the prompt set
		const [session] = await db
			.select({ status: sessions.status, prompt: sessions.prompt, num_events: sessions.num_events })
			.from(sessions)
			.where(eq(sessions.id, sessionId))
		expect(session!.status).toBe('resuming')
		expect(session!.prompt).toBe('fix this bug')
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
		expect(events[0]!.content).toBe('fix this bug')
		expect(events[0]!.user_id).toBe(userId)

		// Queue row should be marked delivered
		const rows = await db.select().from(queuedMessages).where(eq(queuedMessages.session_id, sessionId))
		expect(rows).toHaveLength(1)
		expect(rows[0]!.status).toBe('delivered')
	})

	test('multi-author: two flagged rows from different users -> both attributed on drain', async () => {
		const secondUserId = 'user_v2_continue_second'
		const sessionId = await createSessionWithStatus('running')

		// First user sends interrupt-and-send via the procedure
		const r1 = await call(
			continueSessionV2Procedure,
			{ sessionId, text: 'alice fix', intent: 'interrupt_and_send' },
			{ context: makeContext(userId) },
		)
		expect(r1.kind).toBe('continued')

		// Simulate the second user's flagged row arriving concurrently (in production
		// both transactions serialize on the FOR UPDATE lock; here we insert directly
		// to avoid the second call seeing the already-transitioned status).
		await insertPending(sessionId, 'bob fix', BigInt(Date.now()), userId, secondUserId, true)

		// Daemon reports interrupted — both flagged rows drain
		await call(updateSessionProcedure, { sessionId, status: 'interrupted' }, { context: makeDaemonContext() })

		const [session] = await db
			.select({ status: sessions.status, prompt: sessions.prompt, num_events: sessions.num_events })
			.from(sessions)
			.where(eq(sessions.id, sessionId))
		expect(session!.status).toBe('resuming')
		expect(session!.num_events).toBe(2)
		expect(session!.prompt).toBe(['alice fix', 'bob fix'].join('\n\n'))

		// Both conversation events attributed to their authors
		const events = await db
			.select({ content: conversationEvents.content, user_id: conversationEvents.user_id })
			.from(conversationEvents)
			.where(and(eq(conversationEvents.session_id, sessionId), eq(conversationEvents.role, 'user')))
			.orderBy(asc(conversationEvents.created_at))
		expect(events).toHaveLength(2)
		expect(events[0]!.user_id).toBe(userId)
		expect(events[0]!.content).toBe('alice fix')
		expect(events[1]!.user_id).toBe(secondUserId)
		expect(events[1]!.content).toBe('bob fix')

		// Both queue rows delivered
		const deliveredRows = await db.select().from(queuedMessages).where(eq(queuedMessages.session_id, sessionId))
		expect(deliveredRows.filter((r) => r.deliver_on_interrupt)).toHaveLength(2)
		expect(deliveredRows.filter((r) => r.deliver_on_interrupt).every((r) => r.status === 'delivered')).toBe(true)
	})

	test('run finishes before interrupt: ready_for_input drain picks up flagged row', async () => {
		const sessionId = await createSessionWithStatus('running')

		// User sends interrupt-and-send — inserts flagged queue row
		await call(
			continueSessionV2Procedure,
			{ sessionId, text: 'catch this on completion', intent: 'interrupt_and_send' },
			{ context: makeContext() },
		)

		// Run finishes naturally before the interrupt lands — daemon reports ready_for_input
		// The completion drain should pick up the flagged row (it is a pending row).
		await call(updateSessionProcedure, { sessionId, status: 'ready_for_input' }, { context: makeDaemonContext() })

		const [session] = await db
			.select({ status: sessions.status, prompt: sessions.prompt, num_events: sessions.num_events })
			.from(sessions)
			.where(eq(sessions.id, sessionId))
		expect(session!.status).toBe('resuming')
		expect(session!.prompt).toBe('catch this on completion')
		expect(session!.num_events).toBe(1)

		// The flagged row is delivered and attributed
		const events = await db
			.select({ content: conversationEvents.content, user_id: conversationEvents.user_id })
			.from(conversationEvents)
			.where(and(eq(conversationEvents.session_id, sessionId), eq(conversationEvents.role, 'user')))
		expect(events).toHaveLength(1)
		expect(events[0]!.content).toBe('catch this on completion')
		expect(events[0]!.user_id).toBe(userId)
	})
})
