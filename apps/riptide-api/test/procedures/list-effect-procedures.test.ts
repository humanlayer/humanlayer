import { tmpdir } from 'node:os'

import { conversationEvents } from '@humanlayer/db/tables/conversation-events'
import { organizations } from '@humanlayer/db/tables/organizations'
import { sessions } from '@humanlayer/db/tables/sessions'
import { tasks } from '@humanlayer/db/tables/tasks'
import { call } from '@orpc/server'
import { eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { uuidv7 } from 'uuidv7'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { listSessionEventsProcedure as liveListSessionEventsProcedure } from '../../src/orpc/api/sessions/events/list.effect'
import { listTasksProcedure as liveListTasksProcedure } from '../../src/orpc/api/tasks/list.effect'
import { createMockApiAuth, createMockApiContext } from '../mocks'
import { bindProcedureToRuntime, createRuntimeWithTestPostgresLayer } from '../utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('effect list procedures', async () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let effectRuntime: ReturnType<typeof createRuntimeWithTestPostgresLayer> | undefined
	let listTasksProcedure: typeof liveListTasksProcedure
	let listSessionEventsProcedure: typeof liveListSessionEventsProcedure

	let organizationId: string
	const workosOrganizationId = `org_list_effect_${uuidv7()}`
	const userId = `user_list_effect_${uuidv7()}`
	const otherUserId = `user_list_effect_other_${uuidv7()}`
	const hostId = uuidv7()

	beforeAll(async () => {
		const testDb = await createTestDb('list_effect_procedures')
		cleanupTestDb = testDb.cleanup
		db = testDb.db
		effectRuntime = createRuntimeWithTestPostgresLayer(db)
		listTasksProcedure = bindProcedureToRuntime(liveListTasksProcedure, effectRuntime)
		listSessionEventsProcedure = bindProcedureToRuntime(liveListSessionEventsProcedure, effectRuntime)

		const [org] = await db
			.insert(organizations)
			.values({ name: 'List Effect Procedures Org', workos_organization_id: workosOrganizationId })
			.returning()
		if (!org) throw new Error('Unable to insert organization for setup')
		organizationId = org.id
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

	test('lists tasks visible to the current user in created order', async () => {
		const olderTaskId = uuidv7()
		const newerTaskId = uuidv7()
		const hiddenTaskId = uuidv7()

		await db.insert(tasks).values([
			{
				id: olderTaskId,
				organization_id: organizationId,
				created_by: userId,
				resource_owner_user_id: userId,
				name: 'Older visible task',
				created_at: BigInt(1000),
			},
			{
				id: newerTaskId,
				organization_id: organizationId,
				created_by: userId,
				resource_owner_user_id: userId,
				name: 'Newer visible task',
				created_at: BigInt(2000),
			},
			{
				id: hiddenTaskId,
				organization_id: organizationId,
				created_by: otherUserId,
				resource_owner_user_id: otherUserId,
				name: 'Hidden task',
				created_at: BigInt(3000),
			},
		])

		const result = await call(listTasksProcedure, { limit: 10, offset: 0 }, { context: makeContext() })

		expect(result.rows.map((row) => row.id)).toEqual([newerTaskId, olderTaskId])
	})

	test('filters tasks by resource owner user id', async () => {
		const ownedTaskId = uuidv7()
		const otherOwnedTaskId = uuidv7()

		await db.insert(tasks).values([
			{
				id: ownedTaskId,
				organization_id: organizationId,
				created_by: userId,
				resource_owner_user_id: userId,
				name: 'Owned task',
			},
			{
				id: otherOwnedTaskId,
				organization_id: organizationId,
				created_by: userId,
				resource_owner_user_id: otherUserId,
				name: 'Other owned task',
			},
		])

		const result = await call(listTasksProcedure, { userId, limit: 10, offset: 0 }, { context: makeContext() })

		expect(result.rows.map((row) => row.id)).toContain(ownedTaskId)
		expect(result.rows.map((row) => row.id)).not.toContain(otherOwnedTaskId)
	})

	test('lists session events for one session with optional role filtering', async () => {
		const sessionId = uuidv7()
		const otherSessionId = uuidv7()
		const firstEventId = uuidv7()
		const secondEventId = uuidv7()
		const hiddenEventId = uuidv7()

		await db.insert(sessions).values([
			{
				id: sessionId,
				organization_id: organizationId,
				resource_owner_user_id: userId,
				created_by: userId,
				host_id: hostId,
				status: 'ready_for_input',
				working_directory: tmpdir(),
			},
			{
				id: otherSessionId,
				organization_id: organizationId,
				resource_owner_user_id: userId,
				created_by: userId,
				host_id: hostId,
				status: 'ready_for_input',
				working_directory: tmpdir(),
			},
		])

		await db.insert(conversationEvents).values([
			{
				id: firstEventId,
				session_id: sessionId,
				organization_id: organizationId,
				resource_owner_user_id: userId,
				event_type: 'message',
				role: 'assistant',
				content: 'Assistant response',
				created_at: BigInt(1000),
				updated_at: BigInt(1000),
			},
			{
				id: secondEventId,
				session_id: sessionId,
				organization_id: organizationId,
				resource_owner_user_id: userId,
				event_type: 'message',
				role: 'user',
				content: 'User request',
				created_at: BigInt(2000),
				updated_at: BigInt(2000),
			},
			{
				id: hiddenEventId,
				session_id: otherSessionId,
				organization_id: organizationId,
				resource_owner_user_id: userId,
				event_type: 'message',
				role: 'user',
				content: 'Other session event',
				created_at: BigInt(3000),
				updated_at: BigInt(3000),
			},
		])

		const allEvents = await call(
			listSessionEventsProcedure,
			{ sessionId, limit: 10, offset: 0 },
			{ context: makeContext() },
		)
		expect(allEvents.rows.map((row) => row.id)).toEqual([firstEventId, secondEventId])

		const userEvents = await call(
			listSessionEventsProcedure,
			{ sessionId, role: 'user', limit: 10, offset: 0 },
			{ context: makeContext() },
		)
		expect(userEvents.rows.map((row) => row.id)).toEqual([secondEventId])

		const persistedHiddenEvent = await db
			.select({ id: conversationEvents.id })
			.from(conversationEvents)
			.where(eq(conversationEvents.id, hiddenEventId))
		expect(persistedHiddenEvent).toHaveLength(1)
	})
})
