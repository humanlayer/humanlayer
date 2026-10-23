import { tmpdir } from 'node:os'
import { setTimeout as sleep } from 'node:timers/promises'

import { conversationEvents } from '@humanlayer/db/tables/conversation-events'
import { onlineHosts } from '@humanlayer/db/tables/online-hosts'
import { organizationSettings } from '@humanlayer/db/tables/organization-settings'
import { organizations } from '@humanlayer/db/tables/organizations'
import { queuedMessages } from '@humanlayer/db/tables/queued-messages'
import type { SessionStatus } from '@humanlayer/db/tables/sessions'
import { sessions } from '@humanlayer/db/tables/sessions'
import { taskUserAcl } from '@humanlayer/db/tables/task-user-acl'
import { tasks } from '@humanlayer/db/tables/tasks'
import { userSettings } from '@humanlayer/db/tables/user-settings'
import { call } from '@orpc/server'
import { and, asc, eq, inArray } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { uuidv7 } from 'uuidv7'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { sendNowQueuedMessageEffectProcedure as liveSendNowQueuedMessageEffectProcedure } from '../../src/orpc/api/sessions/queued-messages.send-now.effect'
import { updateSessionProcedure } from '../../src/orpc/daemon/sessions/update'
import { createMockApiAuth, createMockApiContext, createMockDaemonAuth, createMockDaemonContext } from '../mocks'
import { bindProcedureToRuntime, createRuntimeWithTestPostgresLayer } from '../utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('sendNowQueuedMessageEffectProcedure', () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let effectRuntime: ReturnType<typeof createRuntimeWithTestPostgresLayer> | undefined
	let sendNowQueuedMessageEffectProcedure: typeof liveSendNowQueuedMessageEffectProcedure

	let organizationId: string
	let otherOrganizationId: string
	const testRunId = uuidv7()
	const workosOrganizationId = `org_queued_messages_send_now_${testRunId}`
	const otherWorkosOrganizationId = `org_send_now_other_${testRunId}`
	const userId = `user_queued_messages_send_now_${testRunId}`
	const otherUserId = `user_queued_messages_send_now_other_${testRunId}`
	const readonlyUserId = `user_queued_messages_send_now_readonly_${testRunId}`
	const prompterUserId = `user_queued_messages_send_now_prompter_${testRunId}`
	const hostId = uuidv7()

	beforeAll(async () => {
		const testDb = await createTestDb('queued_messages_send_now')
		cleanupTestDb = testDb.cleanup
		db = testDb.db
		effectRuntime = createRuntimeWithTestPostgresLayer(db)
		sendNowQueuedMessageEffectProcedure = bindProcedureToRuntime(
			liveSendNowQueuedMessageEffectProcedure,
			effectRuntime,
		)

		const [org] = await withDbRetry(() =>
			db
				.insert(organizations)
				.values({ name: 'Test Org - Queued Messages Send Now', workos_organization_id: workosOrganizationId })
				.returning(),
		)
		const [otherOrg] = await withDbRetry(() =>
			db
				.insert(organizations)
				.values({
					name: 'Other Org - Queued Messages Send Now',
					workos_organization_id: otherWorkosOrganizationId,
				})
				.returning(),
		)
		if (!org || !otherOrg) throw new Error('Unable to insert organizations for setup')
		organizationId = org.id
		otherOrganizationId = otherOrg.id

		await withDbRetry(() =>
			db.insert(onlineHosts).values({ host_id: hostId, user_id: userId, organization_id: organizationId }),
		)

		// Multiplayer Prompting grants only take effect when the org feature is enabled.
		await withDbRetry(() =>
			db
				.insert(organizationSettings)
				.values({ organization_id: organizationId, multiplayer_prompting_enabled: true })
				.onConflictDoUpdate({
					target: organizationSettings.organization_id,
					set: { multiplayer_prompting_enabled: true },
				}),
		)
	}, 60000)

	afterAll(async () => {
		await effectRuntime?.dispose()
		await cleanupTestDb?.()
	}, 30000)

	async function withDbRetry<T>(operation: () => Promise<T>): Promise<T> {
		let lastError: unknown
		for (let attempt = 0; attempt < 30; attempt++) {
			try {
				return await operation()
			} catch (error) {
				lastError = error
				await sleep(500)
			}
		}
		throw lastError
	}

	function makeContext(uid = userId, orgId = organizationId) {
		return createMockApiContext({
			auth: createMockApiAuth({ userId: uid, organizationId: orgId, workosOrganizationId }),
			services: { db, dbReadReplica: db },
		})
	}

	async function createSessionWithStatus(
		status: SessionStatus,
		overrides: Partial<typeof sessions.$inferInsert> = {},
		ownerUserId = userId,
	) {
		const sessionId = overrides.id ?? uuidv7()
		await db.insert(sessions).values({
			id: sessionId,
			organization_id: organizationId,
			resource_owner_user_id: ownerUserId,
			created_by: ownerUserId,
			host_id: hostId,
			status,
			prompt: 'test prompt',
			working_directory: tmpdir(),
			last_activity_at: BigInt(Date.now()),
			...overrides,
		})
		return sessionId
	}

	async function insertQueuedMessage(
		sessionId: string,
		content: string,
		createdAt = BigInt(Date.now()),
		ownerUserId = userId,
		senderUserId: string | null = ownerUserId,
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
			created_at: createdAt,
			updated_at: createdAt,
		})
		return id
	}

	async function setUserBatchDelivery(uid: string, preferBatchQueueDelivery: boolean) {
		await db
			.insert(userSettings)
			.values({
				user_id: uid,
				organization_id: organizationId,
				prefer_batch_queue_delivery: preferBatchQueueDelivery,
			})
			.onConflictDoUpdate({
				target: [userSettings.user_id, userSettings.organization_id],
				set: { prefer_batch_queue_delivery: preferBatchQueueDelivery },
			})
	}

	async function getQueuedRows(ids: string[]) {
		return db
			.select()
			.from(queuedMessages)
			.where(inArray(queuedMessages.id, ids))
			.orderBy(asc(queuedMessages.created_at))
	}

	async function getUserEvents(sessionId: string) {
		return db
			.select()
			.from(conversationEvents)
			.where(and(eq(conversationEvents.session_id, sessionId), eq(conversationEvents.role, 'user')))
			.orderBy(asc(conversationEvents.id))
	}

	test('incident case: sends one queued message on an interrupted session', async () => {
		const sessionId = await createSessionWithStatus('interrupted')
		const queuedMessageId = await insertQueuedMessage(
			sessionId,
			'We merged, so we need a new branch from main',
			BigInt(Date.now()),
			userId,
			'original-queuer',
		)

		const result = await call(
			sendNowQueuedMessageEffectProcedure,
			{ sessionId, queuedMessageId },
			{ context: makeContext() },
		)

		expect(result.success).toBe(true)
		expect(result.transactionId).toBeTypeOf('string')
		const [queueRow] = await getQueuedRows([queuedMessageId])
		expect(queueRow?.status).toBe('delivered')
		const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId))
		expect(session?.status).toBe('resuming')
		expect(session?.num_events).toBe(1)
		const events = await getUserEvents(sessionId)
		expect(events).toHaveLength(1)
		expect(events[0]?.content).toBe('We merged, so we need a new branch from main')
		expect(events[0]?.user_id).toBe('original-queuer')
	})

	test('lost session resumes directly and clears its warning', async () => {
		const sessionId = await createSessionWithStatus('lost', { error_message: 'session appears lost' })
		const queuedMessageId = await insertQueuedMessage(sessionId, 'Resume this lost session')

		await call(sendNowQueuedMessageEffectProcedure, { sessionId, queuedMessageId }, { context: makeContext() })

		const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId))
		expect(session).toMatchObject({ status: 'resuming', error_message: null })
		expect(await getUserEvents(sessionId)).toHaveLength(1)
	})

	test('active session flags rows for interrupt delivery instead of delivering them', async () => {
		const sessionId = await createSessionWithStatus('running')
		const queuedMessageId = await insertQueuedMessage(sessionId, 'Interrupt with this')

		const result = await call(
			sendNowQueuedMessageEffectProcedure,
			{ sessionId, queuedMessageId },
			{ context: makeContext() },
		)

		expect(result.success).toBe(true)
		// Row stays pending but is flagged for interrupt delivery
		const [queueRow] = await getQueuedRows([queuedMessageId])
		expect(queueRow?.status).toBe('pending')
		expect(queueRow?.deliver_on_interrupt).toBe(true)
		// Session transitions to interrupt_requested, no prompt write, no num_events bump
		const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId))
		expect(session?.status).toBe('interrupt_requested')
		expect(session?.num_events).toBe(0)
		expect(session?.prompt).toBe('test prompt') // unchanged from setup
		// No conversation events yet — the drain creates them on the daemon's interrupted report
		expect(await getUserEvents(sessionId)).toHaveLength(0)
	})

	test('sendNow on active session end-to-end: flagged row delivered with attribution after daemon interrupted report', async () => {
		const sessionId = await createSessionWithStatus('running')
		const queuedMessageId = await insertQueuedMessage(
			sessionId,
			'Send this now while running',
			BigInt(Date.now()),
			userId,
			'send-now-author',
			'Sam Nguyen',
		)

		// Step 1: sendNow flags the row and requests interrupt
		await call(sendNowQueuedMessageEffectProcedure, { sessionId, queuedMessageId }, { context: makeContext() })

		const [flaggedRow] = await getQueuedRows([queuedMessageId])
		expect(flaggedRow?.status).toBe('pending')
		expect(flaggedRow?.deliver_on_interrupt).toBe(true)

		// Step 2: daemon reports interrupted — the drain delivers the flagged row
		const daemonContext = createMockDaemonContext({
			auth: createMockDaemonAuth({ userId, organizationId, hostId }),
			services: { db, dbReadReplica: db },
		})
		await call(updateSessionProcedure, { sessionId, status: 'interrupted' }, { context: daemonContext })

		// Session should now be resuming with attributed conversation events
		const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId))
		expect(session?.status).toBe('resuming')
		expect(session?.prompt).toBe('<message from="Sam Nguyen">\nSend this now while running\n</message>')

		const [deliveredRow] = await getQueuedRows([queuedMessageId])
		expect(deliveredRow?.status).toBe('delivered')

		const events = await getUserEvents(sessionId)
		expect(events).toHaveLength(1)
		expect(events[0]?.content).toBe('Send this now while running')
		expect(events[0]?.user_id).toBe('send-now-author')
	})

	test('sendNow idle branch regression: delivers with attribution and resumes', async () => {
		const sessionId = await createSessionWithStatus('interrupted')
		const queuedMessageId = await insertQueuedMessage(
			sessionId,
			'Deliver directly',
			BigInt(Date.now()),
			userId,
			'idle-author',
		)

		const result = await call(
			sendNowQueuedMessageEffectProcedure,
			{ sessionId, queuedMessageId },
			{ context: makeContext() },
		)

		expect(result.success).toBe(true)
		const [queueRow] = await getQueuedRows([queuedMessageId])
		expect(queueRow?.status).toBe('delivered')
		const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId))
		expect(session?.status).toBe('resuming')
		expect(session?.num_events).toBe(1)
		const events = await getUserEvents(sessionId)
		expect(events).toHaveLength(1)
		expect(events[0]?.id).toBe(queuedMessageId)
		expect(events[0]?.content).toBe('Deliver directly')
		expect(events[0]?.user_id).toBe('idle-author')
	})

	test('batch enabled sends all pending messages in FIFO order', async () => {
		const batchUserId = `user_queued_messages_send_now_batch_${uuidv7()}`
		const sessionId = await createSessionWithStatus('interrupted', {}, batchUserId)
		await setUserBatchDelivery(batchUserId, true)
		const firstId = await insertQueuedMessage(sessionId, 'first', 1n, batchUserId)
		const secondId = await insertQueuedMessage(sessionId, 'second', 2n, batchUserId)
		const thirdId = await insertQueuedMessage(sessionId, 'third', 3n, batchUserId)

		await call(
			sendNowQueuedMessageEffectProcedure,
			{ sessionId, queuedMessageId: secondId },
			{ context: makeContext(batchUserId) },
		)

		const queueRows = await getQueuedRows([firstId, secondId, thirdId])
		expect(queueRows.map((row) => row.status)).toEqual(['delivered', 'delivered', 'delivered'])
		const events = await getUserEvents(sessionId)
		expect(events.map((event) => event.content)).toEqual(['first', 'second', 'third'])
		const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId))
		expect(session?.prompt).toBe('first\n\nsecond\n\nthird')
		expect(session?.num_events).toBe(3)
	})

	test('batch disabled sends only the clicked queued message', async () => {
		const batchUserId = `user_queued_messages_send_now_single_${uuidv7()}`
		const sessionId = await createSessionWithStatus('interrupted', {}, batchUserId)
		await setUserBatchDelivery(batchUserId, false)
		const firstId = await insertQueuedMessage(sessionId, 'first', 1n, batchUserId)
		const secondId = await insertQueuedMessage(sessionId, 'second', 2n, batchUserId)
		const thirdId = await insertQueuedMessage(sessionId, 'third', 3n, batchUserId)

		await call(
			sendNowQueuedMessageEffectProcedure,
			{ sessionId, queuedMessageId: secondId },
			{ context: makeContext(batchUserId) },
		)

		const queueRows = await getQueuedRows([firstId, secondId, thirdId])
		expect(queueRows.map((row) => row.status)).toEqual(['pending', 'delivered', 'pending'])
		const events = await getUserEvents(sessionId)
		expect(events.map((event) => event.content)).toEqual(['second'])
		const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId))
		expect(session?.prompt).toBe('second')
		expect(session?.num_events).toBe(1)
	})

	test('idempotent double-send fails with queued-message send failed', async () => {
		const sessionId = await createSessionWithStatus('interrupted')
		const queuedMessageId = await insertQueuedMessage(sessionId, 'send once')

		await call(sendNowQueuedMessageEffectProcedure, { sessionId, queuedMessageId }, { context: makeContext() })

		await expect(
			call(sendNowQueuedMessageEffectProcedure, { sessionId, queuedMessageId }, { context: makeContext() }),
		).rejects.toMatchObject({ code: 'QUEUED_MESSAGE_SEND_FAILED', data: { reason: 'already_delivered' } })
	})

	test('session in another organization is not found', async () => {
		const sessionId = await createSessionWithStatus('interrupted', { organization_id: otherOrganizationId })
		const queuedMessageId = uuidv7()

		await expect(
			call(sendNowQueuedMessageEffectProcedure, { sessionId, queuedMessageId }, { context: makeContext() }),
		).rejects.toMatchObject({ code: 'NOT_FOUND' })
	})

	test('readable but not writable session is forbidden', async () => {
		const taskId = uuidv7()
		await db.insert(tasks).values({
			id: taskId,
			organization_id: organizationId,
			created_by: userId,
			resource_owner_user_id: userId,
			name: 'Shared read-only task',
		})
		await db.insert(taskUserAcl).values({
			task_id: taskId,
			subject_user_id: readonlyUserId,
			organization_id: organizationId,
			resource_owner_user_id: userId,
			permission_level: 'read',
			granted_by: userId,
		})
		const sessionId = await createSessionWithStatus('interrupted', { task_id: taskId })
		const queuedMessageId = await insertQueuedMessage(sessionId, 'read only cannot send')

		await expect(
			call(
				sendNowQueuedMessageEffectProcedure,
				{ sessionId, queuedMessageId },
				{ context: makeContext(readonlyUserId) },
			),
		).rejects.toMatchObject({ code: 'FORBIDDEN' })
	})

	test('session with no read access is not found', async () => {
		const sessionId = await createSessionWithStatus('interrupted')
		const queuedMessageId = await insertQueuedMessage(sessionId, 'hidden from other users')

		await expect(
			call(
				sendNowQueuedMessageEffectProcedure,
				{ sessionId, queuedMessageId },
				{ context: makeContext(otherUserId) },
			),
		).rejects.toMatchObject({ code: 'NOT_FOUND' })
	})

	test('allows an active prompter to send a queued message now', async () => {
		const sessionId = await createSessionWithStatus('interrupted', {
			multiplayer_prompting_user_ids: [prompterUserId],
			multiplayer_prompting_started_at: BigInt(Date.now() - 1000),
			multiplayer_prompting_expires_at: null,
		})
		const queuedMessageId = await insertQueuedMessage(
			sessionId,
			'Prompter delivers this now',
			BigInt(Date.now()),
			userId,
			'original-queuer',
		)

		const result = await call(
			sendNowQueuedMessageEffectProcedure,
			{ sessionId, queuedMessageId },
			{ context: makeContext(prompterUserId) },
		)

		expect(result.success).toBe(true)
		const [queueRow] = await getQueuedRows([queuedMessageId])
		expect(queueRow?.status).toBe('delivered')
		// Attribution follows the original queuer, not the collaborator who clicked send-now.
		const events = await getUserEvents(sessionId)
		expect(events).toHaveLength(1)
		expect(events[0]?.user_id).toBe('original-queuer')
	})
})
