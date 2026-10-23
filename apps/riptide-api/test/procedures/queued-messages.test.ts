import { tmpdir } from 'node:os'

import { onlineHosts } from '@humanlayer/db/tables/online-hosts'
import { organizationSettings } from '@humanlayer/db/tables/organization-settings'
import { organizations } from '@humanlayer/db/tables/organizations'
import { queuedMessages } from '@humanlayer/db/tables/queued-messages'
import type { SessionStatus } from '@humanlayer/db/tables/sessions'
import { sessions } from '@humanlayer/db/tables/sessions'
import { call } from '@orpc/server'
import { and, eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { uuidv7 } from 'uuidv7'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import {
	createQueuedMessageEffectProcedure as liveCreateQueuedMessageEffectProcedure,
	deleteQueuedMessageEffectProcedure as liveDeleteQueuedMessageEffectProcedure,
} from '../../src/orpc/api/sessions/queued-messages.effect'
import { updateQueuedMessageEffectProcedure as liveUpdateQueuedMessageEffectProcedure } from '../../src/orpc/api/sessions/queued-messages.update.effect'
import { createMockApiAuth, createMockApiContext } from '../mocks'
import { bindProcedureToRuntime, createRuntimeWithTestPostgresLayer } from '../utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('api/sessions/queuedMessages', async () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let effectRuntime: ReturnType<typeof createRuntimeWithTestPostgresLayer> | undefined
	let createQueuedMessageProcedure: typeof liveCreateQueuedMessageEffectProcedure
	let deleteQueuedMessageProcedure: typeof liveDeleteQueuedMessageEffectProcedure
	let updateQueuedMessageProcedure: typeof liveUpdateQueuedMessageEffectProcedure

	let organizationId: string
	const workosOrganizationId = 'org_queued_messages'
	const userId = 'user_queued_messages'
	const prompterUserId = 'user_queued_messages_prompter'
	const hostId = uuidv7()

	beforeAll(async () => {
		const testDb = await createTestDb('queued_messages')
		cleanupTestDb = testDb.cleanup
		db = testDb.db
		effectRuntime = createRuntimeWithTestPostgresLayer(db)
		createQueuedMessageProcedure = bindProcedureToRuntime(liveCreateQueuedMessageEffectProcedure, effectRuntime)
		deleteQueuedMessageProcedure = bindProcedureToRuntime(liveDeleteQueuedMessageEffectProcedure, effectRuntime)
		updateQueuedMessageProcedure = bindProcedureToRuntime(liveUpdateQueuedMessageEffectProcedure, effectRuntime)

		const [org] = await db
			.insert(organizations)
			.values({ name: 'Test Org - Queued Messages', workos_organization_id: workosOrganizationId })
			.returning()
		if (!org) throw new Error('Unable to insert organization for setup')
		organizationId = org.id

		await db.insert(onlineHosts).values({
			host_id: hostId,
			user_id: userId,
			organization_id: organizationId,
		})

		// Multiplayer Prompting grants only take effect when the org feature is enabled.
		await db
			.insert(organizationSettings)
			.values({ organization_id: organizationId, multiplayer_prompting_enabled: true })
			.onConflictDoUpdate({
				target: organizationSettings.organization_id,
				set: { multiplayer_prompting_enabled: true },
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

	// Standalone session owned by `userId` with an active Multiplayer Prompting grant for
	// the given collaborators. Started 1s ago, unlimited by default so the grant is live.
	async function createSessionWithGrant(
		grantedUserIds: string[],
		{ startedAt = BigInt(Date.now() - 1000), expiresAt = null as bigint | null } = {},
	) {
		const sessionId = uuidv7()
		await db.insert(sessions).values({
			id: sessionId,
			organization_id: organizationId,
			resource_owner_user_id: userId,
			created_by: userId,
			host_id: hostId,
			status: 'running',
			prompt: 'test prompt',
			working_directory: tmpdir(),
			last_activity_at: BigInt(Date.now()),
			multiplayer_prompting_user_ids: grantedUserIds,
			multiplayer_prompting_started_at: startedAt,
			multiplayer_prompting_expires_at: expiresAt,
		})
		return sessionId
	}

	describe('create', () => {
		test('queues a message on a running session', async () => {
			const sessionId = await createSessionWithStatus('running')

			const result = await call(
				createQueuedMessageProcedure,
				{ sessionId, text: 'Please add tests' },
				{ context: makeContext() },
			)

			expect(result.success).toBe(true)
			expect(result.transactionId).toBeTypeOf('string')

			const rows = await db
				.select()
				.from(queuedMessages)
				.where(and(eq(queuedMessages.session_id, sessionId), eq(queuedMessages.status, 'pending')))
			expect(rows).toHaveLength(1)
			expect(rows[0]!.content).toBe('Please add tests')
		})

		test('queues a message on a needs_approval session', async () => {
			const sessionId = await createSessionWithStatus('needs_approval')

			const result = await call(
				createQueuedMessageProcedure,
				{ sessionId, text: 'Queued during approval' },
				{ context: makeContext() },
			)

			expect(result.success).toBe(true)
		})

		test('rejects queue for ready_for_input session', async () => {
			const sessionId = await createSessionWithStatus('ready_for_input')

			await expect(
				call(createQueuedMessageProcedure, { sessionId, text: 'Should fail' }, { context: makeContext() }),
			).rejects.toThrow()
		})

		test('queues multiple messages in FIFO order', async () => {
			const sessionId = await createSessionWithStatus('running')

			await call(createQueuedMessageProcedure, { sessionId, text: 'First message' }, { context: makeContext() })
			await call(createQueuedMessageProcedure, { sessionId, text: 'Second message' }, { context: makeContext() })

			const rows = await db
				.select()
				.from(queuedMessages)
				.where(and(eq(queuedMessages.session_id, sessionId), eq(queuedMessages.status, 'pending')))
				.orderBy(queuedMessages.created_at)
			expect(rows).toHaveLength(2)
			expect(rows[0]!.content).toBe('First message')
			expect(rows[1]!.content).toBe('Second message')
		})

		test('uses provided messageId when given', async () => {
			const sessionId = await createSessionWithStatus('running')
			const messageId = uuidv7()

			await call(
				createQueuedMessageProcedure,
				{ sessionId, text: 'Custom ID message', messageId },
				{ context: makeContext() },
			)

			const [row] = await db.select().from(queuedMessages).where(eq(queuedMessages.id, messageId))
			expect(row).toBeDefined()
			expect(row!.content).toBe('Custom ID message')
		})

		test('rejects queue for draft session', async () => {
			const sessionId = await createSessionWithStatus('draft')

			await expect(
				call(createQueuedMessageProcedure, { sessionId, text: 'Should fail' }, { context: makeContext() }),
			).rejects.toThrow()
		})

		test('rejects queue for interrupted session', async () => {
			const sessionId = await createSessionWithStatus('interrupted')

			await expect(
				call(createQueuedMessageProcedure, { sessionId, text: 'Should fail' }, { context: makeContext() }),
			).rejects.toThrow()
		})

		test('rejects queue for failed session', async () => {
			const sessionId = await createSessionWithStatus('failed')

			await expect(
				call(createQueuedMessageProcedure, { sessionId, text: 'Should fail' }, { context: makeContext() }),
			).rejects.toThrow()
		})

		test('rejects queue from unauthorized user', async () => {
			const sessionId = await createSessionWithStatus('running')

			await expect(
				call(
					createQueuedMessageProcedure,
					{ sessionId, text: 'Should fail' },
					{ context: makeContext('different-user-id') },
				),
			).rejects.toThrow()
		})

		test('rejects queue for non-existent session', async () => {
			await expect(
				call(
					createQueuedMessageProcedure,
					{ sessionId: uuidv7(), text: 'Should fail' },
					{ context: makeContext() },
				),
			).rejects.toThrow()
		})
	})

	describe('update', () => {
		test('updates the content of a pending queued message', async () => {
			const sessionId = await createSessionWithStatus('running')
			const messageId = uuidv7()

			await call(
				createQueuedMessageProcedure,
				{ sessionId, text: 'Original content', messageId },
				{ context: makeContext() },
			)

			const result = await call(
				updateQueuedMessageProcedure,
				{ sessionId, queuedMessageId: messageId, text: 'Edited content' },
				{ context: makeContext() },
			)

			expect(result.success).toBe(true)
			expect(result.transactionId).toBeTypeOf('string')

			const [row] = await db.select().from(queuedMessages).where(eq(queuedMessages.id, messageId))
			expect(row).toBeDefined()
			expect(row!.content).toBe('Edited content')
			expect(row!.status).toBe('pending')
		})

		test('rejects update for non-existent message', async () => {
			const sessionId = await createSessionWithStatus('running')

			await expect(
				call(
					updateQueuedMessageProcedure,
					{ sessionId, queuedMessageId: uuidv7(), text: 'Should fail' },
					{ context: makeContext() },
				),
			).rejects.toThrow()
		})

		test('rejects update for already-delivered message with QUEUED_MESSAGE_UPDATE_FAILED', async () => {
			const sessionId = await createSessionWithStatus('running')
			const messageId = uuidv7()

			await call(
				createQueuedMessageProcedure,
				{ sessionId, text: 'Will be delivered', messageId },
				{ context: makeContext() },
			)

			// Manually mark as delivered to simulate auto-continue
			await db.update(queuedMessages).set({ status: 'delivered' }).where(eq(queuedMessages.id, messageId))

			const error = await call(
				updateQueuedMessageProcedure,
				{ sessionId, queuedMessageId: messageId, text: 'Too late' },
				{ context: makeContext() },
			).then(
				() => null,
				(err) => err as { code?: string; status?: number },
			)

			expect(error).not.toBeNull()
			expect(error!.code).toBe('QUEUED_MESSAGE_UPDATE_FAILED')
			expect(error!.status).toBe(400)
		})

		test('rejects update from unauthorized user', async () => {
			const sessionId = await createSessionWithStatus('running')
			const messageId = uuidv7()

			await call(
				createQueuedMessageProcedure,
				{ sessionId, text: 'Not yours to edit', messageId },
				{ context: makeContext() },
			)

			await expect(
				call(
					updateQueuedMessageProcedure,
					{ sessionId, queuedMessageId: messageId, text: 'Should fail' },
					{ context: makeContext('different-user-id') },
				),
			).rejects.toThrow()
		})
	})

	describe('delete', () => {
		test('deletes a pending queued message', async () => {
			const sessionId = await createSessionWithStatus('running')
			const messageId = uuidv7()

			await call(
				createQueuedMessageProcedure,
				{ sessionId, text: 'To be deleted', messageId },
				{ context: makeContext() },
			)

			const result = await call(
				deleteQueuedMessageProcedure,
				{ sessionId, queuedMessageId: messageId },
				{ context: makeContext() },
			)

			expect(result.success).toBe(true)
			expect(result.transactionId).toBeTypeOf('string')

			const rows = await db.select().from(queuedMessages).where(eq(queuedMessages.id, messageId))
			expect(rows).toHaveLength(0)
		})

		test('rejects delete for non-existent message', async () => {
			const sessionId = await createSessionWithStatus('running')

			await expect(
				call(
					deleteQueuedMessageProcedure,
					{ sessionId, queuedMessageId: uuidv7() },
					{ context: makeContext() },
				),
			).rejects.toThrow()
		})

		test('rejects delete for already-delivered message', async () => {
			const sessionId = await createSessionWithStatus('running')
			const messageId = uuidv7()

			await call(
				createQueuedMessageProcedure,
				{ sessionId, text: 'Will be delivered', messageId },
				{ context: makeContext() },
			)

			// Manually mark as delivered to simulate auto-continue
			await db.update(queuedMessages).set({ status: 'delivered' }).where(eq(queuedMessages.id, messageId))

			await expect(
				call(
					deleteQueuedMessageProcedure,
					{ sessionId, queuedMessageId: messageId },
					{ context: makeContext() },
				),
			).rejects.toThrow()
		})

		test('rejects delete from unauthorized user', async () => {
			const sessionId = await createSessionWithStatus('running')
			const messageId = uuidv7()

			await call(
				createQueuedMessageProcedure,
				{ sessionId, text: 'Not yours to delete', messageId },
				{ context: makeContext() },
			)

			await expect(
				call(
					deleteQueuedMessageProcedure,
					{ sessionId, queuedMessageId: messageId },
					{ context: makeContext('different-user-id') },
				),
			).rejects.toThrow()
		})
	})

	// Multiplayer Prompting: an active collaborator manages the shared queue like they
	// interrupt (prompt-level), not just the session creator.
	describe('multiplayer prompter access', () => {
		test('allows an active prompter to edit a queued message', async () => {
			const sessionId = await createSessionWithGrant([prompterUserId])
			const messageId = uuidv7()
			await call(
				createQueuedMessageProcedure,
				{ sessionId, text: 'Owner queued this', messageId },
				{ context: makeContext() },
			)

			const result = await call(
				updateQueuedMessageProcedure,
				{ sessionId, queuedMessageId: messageId, text: 'Prompter edited this' },
				{ context: makeContext(prompterUserId) },
			)

			expect(result.success).toBe(true)
			const [row] = await db.select().from(queuedMessages).where(eq(queuedMessages.id, messageId))
			expect(row!.content).toBe('Prompter edited this')
		})

		test('allows an active prompter to delete a queued message', async () => {
			const sessionId = await createSessionWithGrant([prompterUserId])
			const messageId = uuidv7()
			await call(
				createQueuedMessageProcedure,
				{ sessionId, text: 'Delete me', messageId },
				{ context: makeContext() },
			)

			const result = await call(
				deleteQueuedMessageProcedure,
				{ sessionId, queuedMessageId: messageId },
				{ context: makeContext(prompterUserId) },
			)

			expect(result.success).toBe(true)
			const rows = await db.select().from(queuedMessages).where(eq(queuedMessages.id, messageId))
			expect(rows).toHaveLength(0)
		})

		test('rejects queue management from a prompter whose grant has expired', async () => {
			const sessionId = await createSessionWithGrant([prompterUserId], {
				startedAt: BigInt(Date.now() - 10_000),
				expiresAt: BigInt(Date.now() - 1_000),
			})
			const messageId = uuidv7()
			await call(
				createQueuedMessageProcedure,
				{ sessionId, text: 'Owner queued this', messageId },
				{ context: makeContext() },
			)

			await expect(
				call(
					updateQueuedMessageProcedure,
					{ sessionId, queuedMessageId: messageId, text: 'Too late' },
					{ context: makeContext(prompterUserId) },
				),
			).rejects.toThrow()
		})
	})
})
