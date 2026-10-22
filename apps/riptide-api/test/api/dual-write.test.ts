import { tmpdir } from 'node:os'

import { onlineHosts } from '@humanlayer/db/tables/online-hosts'
import { organizations } from '@humanlayer/db/tables/organizations'
import { sessions } from '@humanlayer/db/tables/sessions'
import { tasks } from '@humanlayer/db/tables/tasks'
import { call } from '@orpc/server'
import { eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { createSessionProcedure } from '../../src/orpc/api/sessions/create'
import { launchSessionProcedure } from '../../src/orpc/api/sessions/launch'
import { createTaskProcedure } from '../../src/orpc/api/tasks/create'
import { createMockApiAuth, createMockApiContext } from '../mocks'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

/**
 * This set of tests is used to ensure that `resource_owner_user_id` and `created_by` are BOTH written
 * when a user creates a resource.
 */
describe('Section 4: Basic API Endpoint Tests - Dual Write', async () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase

	let organizationId: string
	const workosOrganizationId = 'org_workos123'
	const userId = 'user_test123'

	beforeAll(async () => {
		const testDb = await createTestDb('dual_write')
		cleanupTestDb = testDb.cleanup
		db = testDb.db

		// Set up organization
		const [org] = await db
			.insert(organizations)
			.values({
				name: 'test organization',
				workos_organization_id: workosOrganizationId,
			})
			.returning()

		if (!org) throw new Error('Unable to insert organization for setup')
		organizationId = org.id

		// Register host so API-level host ownership validation passes for sessions.launch tests
		await db
			.insert(onlineHosts)
			.values({
				host_id: 'test-host-id',
				user_id: userId,
				organization_id: organizationId,
			})
			.onConflictDoNothing()
	}, 30000)

	afterAll(async () => {
		await cleanupTestDb?.()
	}, 30000)

	describe('4.1 Task Create - Dual Write', () => {
		test('Test 36: Sets resource_owner_user_id from context.auth.userId', async () => {
			const result = await call(
				createTaskProcedure,
				{
					name: 'test task 36',
					slug: 'test-task-36',
					defaultWorkingDirectory: tmpdir(),
					setupStatus: 'completed',
				},
				{
					context: createMockApiContext({
						auth: createMockApiAuth({ userId, organizationId, workosOrganizationId }),
						services: { db, dbReadReplica: db },
					}),
				},
			)

			const taskId = result.task.id
			expect(taskId).toBeTypeOf('string')

			// Query database to verify resource_owner_user_id
			const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1)

			expect(task).toBeDefined()
			expect(task?.resource_owner_user_id).toBe(userId)
		})

		test('Test 37: Sets created_by from context.auth.userId', async () => {
			const result = await call(
				createTaskProcedure,
				{
					name: 'test task 37',
					slug: 'test-task-37',
					defaultWorkingDirectory: tmpdir(),
					setupStatus: 'completed',
				},
				{
					context: createMockApiContext({
						auth: createMockApiAuth({ userId, organizationId, workosOrganizationId }),
						services: { db, dbReadReplica: db },
					}),
				},
			)

			const taskId = result.task.id
			expect(taskId).toBeTypeOf('string')

			// Query database to verify created_by
			const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1)

			expect(task).toBeDefined()
			expect(task?.created_by).toBe(userId)
		})
	})

	describe('4.2 Session Create - Dual Write', () => {
		test('Test 39: Sets resource_owner_user_id from context.auth.userId', async () => {
			const result = await call(
				createSessionProcedure,
				{
					prompt: 'Test session prompt',
					workingDirectory: tmpdir(),
					codingAgent: 'claude',
					provider: 'anthropic',
					model: 'opus',
					permissionsMode: 'default',
					status: 'draft',
				},
				{
					context: createMockApiContext({
						auth: createMockApiAuth({ userId, organizationId, workosOrganizationId }),
						services: { db, dbReadReplica: db },
					}),
				},
			)

			const sessionId = result.session.id
			expect(sessionId).toBeTypeOf('string')

			// Query database to verify resource_owner_user_id
			const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1)

			expect(session).toBeDefined()
			expect(session?.resource_owner_user_id).toBe(userId)
		})

		test('Test 40: Sets created_by from context.auth.userId', async () => {
			const result = await call(
				createSessionProcedure,
				{
					prompt: 'Test session prompt',
					workingDirectory: tmpdir(),
					codingAgent: 'claude',
					provider: 'anthropic',
					model: 'opus',
					permissionsMode: 'default',
					status: 'draft',
				},
				{
					context: createMockApiContext({
						auth: createMockApiAuth({ userId, organizationId, workosOrganizationId }),
						services: { db, dbReadReplica: db },
					}),
				},
			)

			const sessionId = result.session.id
			expect(sessionId).toBeTypeOf('string')

			// Query database to verify created_by
			const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1)

			expect(session).toBeDefined()
			expect(session?.created_by).toBe(userId)
		})
	})

	describe('4.3 Session Launch - Dual Write', () => {
		test('Test 41: Sets resource_owner_user_id from context.auth.userId', async () => {
			// First create a task to launch a session for
			const taskResult = await call(
				createTaskProcedure,
				{
					name: 'test task for launch',
					slug: 'test-task-launch-41',
					defaultWorkingDirectory: tmpdir(),
					setupStatus: 'completed',
				},
				{
					context: createMockApiContext({
						auth: createMockApiAuth({ userId, organizationId, workosOrganizationId }),
						services: { db, dbReadReplica: db },
					}),
				},
			)

			const taskId = taskResult.task.id

			// Launch a session
			const launchResult = await call(
				launchSessionProcedure,
				{
					taskId,
					text: 'Test launch message',
					workingDirectory: tmpdir(),
					hostId: 'test-host-id',
					codingAgent: 'claude',
					provider: 'anthropic',
					model: 'opus',
					permissionsMode: 'default',
				},
				{
					context: createMockApiContext({
						auth: createMockApiAuth({ userId, organizationId, workosOrganizationId }),
						services: { db, dbReadReplica: db },
					}),
				},
			)

			const sessionId = launchResult.session.id
			expect(sessionId).toBeTypeOf('string')

			// Query database to verify resource_owner_user_id
			const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1)

			expect(session).toBeDefined()
			expect(session?.resource_owner_user_id).toBe(userId)
		})

		test('launch supports CodeLayer sessions', async () => {
			const launchResult = await call(
				launchSessionProcedure,
				{
					text: 'Test CodeLayer launch message',
					workingDirectory: tmpdir(),
					hostId: 'test-host-id',
					codingAgent: 'codelayer',
					provider: 'anthropic',
					model: 'opus',
					permissionsMode: 'default',
				},
				{
					context: createMockApiContext({
						auth: createMockApiAuth({ userId, organizationId, workosOrganizationId }),
						services: { db, dbReadReplica: db },
					}),
				},
			)

			const [session] = await db.select().from(sessions).where(eq(sessions.id, launchResult.session.id)).limit(1)

			expect(session?.coding_agent).toBe('codelayer')
			expect(session?.status).toBe('ready_for_launch')
		})
	})
})
