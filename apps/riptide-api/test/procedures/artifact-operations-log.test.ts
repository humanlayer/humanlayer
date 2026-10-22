import { randomUUID } from 'node:crypto'

import { artifactOperationsLog } from '@humanlayer/db/tables/artifact-operations-log'
import { organizations } from '@humanlayer/db/tables/organizations'
import { sessions } from '@humanlayer/db/tables/sessions'
import { taskUserAcl } from '@humanlayer/db/tables/task-user-acl'
import { tasks } from '@humanlayer/db/tables/tasks'
import { call } from '@orpc/server'
import { eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { upsertArtifactProcedure } from '../../src/orpc/daemon/artifacts/upsert'
import { createMockDaemonAuth, createMockDaemonContext } from '../mocks'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('artifact operations log test', async () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase

	let organizationId: string
	const workosOrganizationId = 'org_abc123'
	const userId = 'user_abc1234'
	const otherUserId = 'user_other456'
	const hostId = randomUUID()

	beforeAll(async () => {
		const testDb = await createTestDb('artifact_operations_log')
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
	}, 30000)

	describe('Section 7: Artifact Operations Log', () => {
		describe('7.1 Operations Log on Create (tests 76-81)', () => {
			test('Test 76: Creating artifact logs operation with correct artifact_id', async () => {
				const [task] = await db
					.insert(tasks)
					.values({
						organization_id: organizationId,
						name: 'test task for operation log',
						resource_owner_user_id: userId,
						created_by: userId,
					})
					.returning()

				if (!task) throw new Error('Failed to create task')

				const daemonAuth = createMockDaemonAuth({ userId, organizationId, hostId })

				const operationType = 'Write'
				const operationContents = { tool: 'write_file', path: 'test.md', content: '# Test' }

				// Create the artifact with operation logging
				const createResult = await call(
					upsertArtifactProcedure,
					{
						taskId: task.id,
						fileName: 'test-log.md',
						content: '# Original content',
						operationType,
						operationContents,
					},
					{
						context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
					},
				)

				// Check that an operation log entry was created
				const [logEntry] = await db
					.select()
					.from(artifactOperationsLog)
					.where(eq(artifactOperationsLog.artifact_id, createResult.artifactId))
					.limit(1)

				expect(logEntry).toBeDefined()
				expect(logEntry?.artifact_id).toBe(createResult.artifactId)
			})

			test('Test 77: Operation has operation_type from input', async () => {
				const [task] = await db
					.insert(tasks)
					.values({
						organization_id: organizationId,
						name: 'test task for operation type',
						resource_owner_user_id: userId,
						created_by: userId,
					})
					.returning()

				if (!task) throw new Error('Failed to create task')

				const daemonAuth = createMockDaemonAuth({ userId, organizationId, hostId })

				const operationType = 'Edit'
				const operationContents = { tool: 'edit_file', path: 'test.md', edits: [] }

				const createResult = await call(
					upsertArtifactProcedure,
					{
						taskId: task.id,
						fileName: 'test-op-type.md',
						content: '# Content',
						operationType,
						operationContents,
					},
					{
						context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
					},
				)

				const [logEntry] = await db
					.select()
					.from(artifactOperationsLog)
					.where(eq(artifactOperationsLog.artifact_id, createResult.artifactId))
					.limit(1)

				expect(logEntry).toBeDefined()
				expect(logEntry?.operation_type).toBe(operationType)
			})

			test('Test 78: Operation has operation_contents with tool call JSON', async () => {
				const [task] = await db
					.insert(tasks)
					.values({
						organization_id: organizationId,
						name: 'test task for operation contents',
						resource_owner_user_id: userId,
						created_by: userId,
					})
					.returning()

				if (!task) throw new Error('Failed to create task')

				const daemonAuth = createMockDaemonAuth({ userId, organizationId, hostId })

				const operationType = 'MultiEdit'
				const operationContents = {
					tool: 'multi_edit',
					files: ['file1.md', 'file2.md'],
					changes: { file1: 'change1', file2: 'change2' },
				}

				const createResult = await call(
					upsertArtifactProcedure,
					{
						taskId: task.id,
						fileName: 'test-op-contents.md',
						content: '# Content',
						operationType,
						operationContents,
					},
					{
						context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
					},
				)

				const [logEntry] = await db
					.select()
					.from(artifactOperationsLog)
					.where(eq(artifactOperationsLog.artifact_id, createResult.artifactId))
					.limit(1)

				expect(logEntry).toBeDefined()
				expect(logEntry?.operation_contents).toEqual(operationContents)
			})

			test('Test 79: Operation has correct task_id, resource_owner_user_id, organization_id', async () => {
				const [task] = await db
					.insert(tasks)
					.values({
						organization_id: organizationId,
						name: 'test task for operation inheritance',
						resource_owner_user_id: userId,
						created_by: userId,
					})
					.returning()

				if (!task) throw new Error('Failed to create task')

				const daemonAuth = createMockDaemonAuth({ userId, organizationId, hostId })

				const operationType = 'Write'
				const operationContents = { tool: 'write_file' }

				const createResult = await call(
					upsertArtifactProcedure,
					{
						taskId: task.id,
						fileName: 'test-inheritance.md',
						content: '# Content',
						operationType,
						operationContents,
					},
					{
						context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
					},
				)

				const [logEntry] = await db
					.select()
					.from(artifactOperationsLog)
					.where(eq(artifactOperationsLog.artifact_id, createResult.artifactId))
					.limit(1)

				expect(logEntry).toBeDefined()
				expect(logEntry?.task_id).toBe(task.id)
				expect(logEntry?.resource_owner_user_id).toBe(userId)
				expect(logEntry?.organization_id).toBe(organizationId)
			})

			test('Test 80: Operation has session_id when provided', async () => {
				const [task] = await db
					.insert(tasks)
					.values({
						organization_id: organizationId,
						name: 'test task for session id',
						resource_owner_user_id: userId,
						created_by: userId,
					})
					.returning()

				if (!task) throw new Error('Failed to create task')

				// Create a real session (FK constraint requires session to exist)
				const [session] = await db
					.insert(sessions)
					.values({
						organization_id: organizationId,
						host_id: hostId,
						task_id: task.id,
						resource_owner_user_id: userId,
						created_by: userId,
						status: 'running',
						working_directory: '/tmp/test',
					})
					.returning()

				if (!session) throw new Error('Failed to create session')

				const daemonAuth = createMockDaemonAuth({ userId, organizationId, hostId })

				const operationType = 'Write'
				const operationContents = { tool: 'write_file' }

				const createResult = await call(
					upsertArtifactProcedure,
					{
						taskId: task.id,
						fileName: 'test-session.md',
						content: '# Content',
						sessionId: session.id,
						operationType,
						operationContents,
					},
					{
						context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
					},
				)

				const [logEntry] = await db
					.select()
					.from(artifactOperationsLog)
					.where(eq(artifactOperationsLog.artifact_id, createResult.artifactId))
					.limit(1)

				expect(logEntry).toBeDefined()
				expect(logEntry?.session_id).toBe(session.id)
			})

			test('Test 80b: Operation fails when session_id does not exist', async () => {
				const [task] = await db
					.insert(tasks)
					.values({
						organization_id: organizationId,
						name: 'test task for invalid session id',
						resource_owner_user_id: userId,
						created_by: userId,
					})
					.returning()

				if (!task) throw new Error('Failed to create task')

				const daemonAuth = createMockDaemonAuth({ userId, organizationId, hostId })

				const nonExistentSessionId = randomUUID()
				const operationType = 'Write'
				const operationContents = { tool: 'write_file' }

				// Should fail due to FK constraint on session_id
				await expect(
					call(
						upsertArtifactProcedure,
						{
							taskId: task.id,
							fileName: 'test-invalid-session.md',
							content: '# Content',
							sessionId: nonExistentSessionId,
							operationType,
							operationContents,
						},
						{
							context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
						},
					),
				).rejects.toThrow()
			})

			test('Test 81: Operation has version_created: false on create', async () => {
				const [task] = await db
					.insert(tasks)
					.values({
						organization_id: organizationId,
						name: 'test task for version created on create',
						resource_owner_user_id: userId,
						created_by: userId,
					})
					.returning()

				if (!task) throw new Error('Failed to create task')

				const daemonAuth = createMockDaemonAuth({ userId, organizationId, hostId })

				const operationType = 'Write'
				const operationContents = { tool: 'write_file' }

				const createResult = await call(
					upsertArtifactProcedure,
					{
						taskId: task.id,
						fileName: 'test-version-false.md',
						content: '# Original',
						operationType,
						operationContents,
					},
					{
						context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
					},
				)

				const [logEntry] = await db
					.select()
					.from(artifactOperationsLog)
					.where(eq(artifactOperationsLog.artifact_id, createResult.artifactId))
					.limit(1)

				expect(logEntry).toBeDefined()
				expect(logEntry?.version_created).toBe(false)
			})
		})

		describe('7.2 Operations Log on Update (tests 82-85)', () => {
			test('Test 82: Updating artifact logs operation', async () => {
				const [task] = await db
					.insert(tasks)
					.values({
						organization_id: organizationId,
						name: 'test task for update log',
						resource_owner_user_id: userId,
						created_by: userId,
					})
					.returning()

				if (!task) throw new Error('Failed to create task')

				const daemonAuth = createMockDaemonAuth({ userId, organizationId, hostId })

				const operationType = 'Write'
				const operationContents = { tool: 'write_file' }

				// Create the artifact
				const createResult = await call(
					upsertArtifactProcedure,
					{
						taskId: task.id,
						fileName: 'test-update-log.md',
						content: '# Original',
						operationType,
						operationContents,
					},
					{
						context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
					},
				)

				// Update the artifact
				await call(
					upsertArtifactProcedure,
					{
						taskId: task.id,
						fileName: 'test-update-log.md',
						content: '# Updated',
						operationType: 'Edit',
						operationContents: { tool: 'edit_file' },
					},
					{
						context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
					},
				)

				// Check that two operation log entries exist (create + update)
				const logEntries = await db
					.select()
					.from(artifactOperationsLog)
					.where(eq(artifactOperationsLog.artifact_id, createResult.artifactId))

				expect(logEntries.length).toBe(2)
			})

			test('Test 83: Operation has version_created: true when content changed', async () => {
				const [task] = await db
					.insert(tasks)
					.values({
						organization_id: organizationId,
						name: 'test task for version true',
						resource_owner_user_id: userId,
						created_by: userId,
					})
					.returning()

				if (!task) throw new Error('Failed to create task')

				const daemonAuth = createMockDaemonAuth({ userId, organizationId, hostId })

				const operationType = 'Write'
				const operationContents = { tool: 'write_file' }

				// Create the artifact
				const createResult = await call(
					upsertArtifactProcedure,
					{
						taskId: task.id,
						fileName: 'test-version-true.md',
						content: '# Original',
						operationType,
						operationContents,
					},
					{
						context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
					},
				)

				// Update with different content
				await call(
					upsertArtifactProcedure,
					{
						taskId: task.id,
						fileName: 'test-version-true.md',
						content: '# Updated',
						operationType: 'Edit',
						operationContents: { tool: 'edit_file' },
					},
					{
						context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
					},
				)

				// Get the update operation log entry (second one)
				const logEntries = await db
					.select()
					.from(artifactOperationsLog)
					.where(eq(artifactOperationsLog.artifact_id, createResult.artifactId))

				expect(logEntries.length).toBe(2)
				const updateEntry = logEntries.find((e) => e.operation_type === 'Edit')
				expect(updateEntry).toBeDefined()
				expect(updateEntry?.version_created).toBe(true)
			})

			test('Test 84: Operation has version_created: false when content unchanged', async () => {
				const [task] = await db
					.insert(tasks)
					.values({
						organization_id: organizationId,
						name: 'test task for version false on update',
						resource_owner_user_id: userId,
						created_by: userId,
					})
					.returning()

				if (!task) throw new Error('Failed to create task')

				const daemonAuth = createMockDaemonAuth({ userId, organizationId, hostId })

				const operationType = 'Write'
				const operationContents = { tool: 'write_file' }
				const content = '# Same content'

				// Create the artifact
				const createResult = await call(
					upsertArtifactProcedure,
					{
						taskId: task.id,
						fileName: 'test-version-false-update.md',
						content,
						operationType,
						operationContents,
					},
					{
						context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
					},
				)

				// Update with same content
				await call(
					upsertArtifactProcedure,
					{
						taskId: task.id,
						fileName: 'test-version-false-update.md',
						content, // Same content
						operationType: 'Edit',
						operationContents: { tool: 'edit_file' },
					},
					{
						context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
					},
				)

				// Get the update operation log entry (second one)
				const logEntries = await db
					.select()
					.from(artifactOperationsLog)
					.where(eq(artifactOperationsLog.artifact_id, createResult.artifactId))

				expect(logEntries.length).toBe(2)
				const updateEntry = logEntries.find((e) => e.operation_type === 'Edit')
				expect(updateEntry).toBeDefined()
				expect(updateEntry?.version_created).toBe(false)
			})

			test('Test 85: Multiple updates create multiple log entries', async () => {
				const [task] = await db
					.insert(tasks)
					.values({
						organization_id: organizationId,
						name: 'test task for multiple logs',
						resource_owner_user_id: userId,
						created_by: userId,
					})
					.returning()

				if (!task) throw new Error('Failed to create task')

				const daemonAuth = createMockDaemonAuth({ userId, organizationId, hostId })

				// Create the artifact
				const createResult = await call(
					upsertArtifactProcedure,
					{
						taskId: task.id,
						fileName: 'test-multiple-logs.md',
						content: '# Version 0',
						operationType: 'Write',
						operationContents: { tool: 'write_file' },
					},
					{
						context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
					},
				)

				// Perform multiple updates
				for (let i = 1; i <= 5; i++) {
					await call(
						upsertArtifactProcedure,
						{
							taskId: task.id,
							fileName: 'test-multiple-logs.md',
							content: `# Version ${i}`,
							operationType: 'Edit',
							operationContents: { tool: 'edit_file', version: i },
						},
						{
							context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
						},
					)
				}

				// Check that we have 6 log entries total (1 create + 5 updates)
				const logEntries = await db
					.select()
					.from(artifactOperationsLog)
					.where(eq(artifactOperationsLog.artifact_id, createResult.artifactId))

				expect(logEntries.length).toBe(6)
			})
		})

		describe('7.3 Operations Log Inheritance (tests 86-88)', () => {
			test('Test 86: resource_owner_user_id matches artifacts owner', async () => {
				const [task] = await db
					.insert(tasks)
					.values({
						organization_id: organizationId,
						name: 'test task for owner inheritance',
						resource_owner_user_id: userId,
						created_by: userId,
					})
					.returning()

				if (!task) throw new Error('Failed to create task')

				const daemonAuth = createMockDaemonAuth({ userId, organizationId, hostId })

				const operationType = 'Write'
				const operationContents = { tool: 'write_file' }

				const createResult = await call(
					upsertArtifactProcedure,
					{
						taskId: task.id,
						fileName: 'test-owner.md',
						content: '# Content',
						operationType,
						operationContents,
					},
					{
						context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
					},
				)

				const [logEntry] = await db
					.select()
					.from(artifactOperationsLog)
					.where(eq(artifactOperationsLog.artifact_id, createResult.artifactId))
					.limit(1)

				expect(logEntry).toBeDefined()
				expect(logEntry?.resource_owner_user_id).toBe(userId)
			})

			test('Test 87: task_slug matches artifacts task_slug', async () => {
				const taskSlug = 'test-slug-for-log'
				const [task] = await db
					.insert(tasks)
					.values({
						organization_id: organizationId,
						name: 'test task for slug inheritance',
						slug: taskSlug,
						resource_owner_user_id: userId,
						created_by: userId,
					})
					.returning()

				if (!task) throw new Error('Failed to create task')

				const daemonAuth = createMockDaemonAuth({ userId, organizationId, hostId })

				const operationType = 'Write'
				const operationContents = { tool: 'write_file' }

				const createResult = await call(
					upsertArtifactProcedure,
					{
						taskId: task.id,
						fileName: 'test-slug.md',
						content: '# Content',
						operationType,
						operationContents,
					},
					{
						context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
					},
				)

				const [logEntry] = await db
					.select()
					.from(artifactOperationsLog)
					.where(eq(artifactOperationsLog.artifact_id, createResult.artifactId))
					.limit(1)

				expect(logEntry).toBeDefined()
				expect(logEntry?.task_slug).toBe(taskSlug)
			})

			test('Test 88: created_by is the user who performed the operation', async () => {
				// Create a task owned by userId
				const [task] = await db
					.insert(tasks)
					.values({
						organization_id: organizationId,
						name: 'test task for shared user operation',
						resource_owner_user_id: userId,
						created_by: userId,
					})
					.returning()

				if (!task) throw new Error('Failed to create task')

				// Give otherUserId access to the task via ACL
				await db.insert(taskUserAcl).values({
					organization_id: organizationId,
					subject_user_id: otherUserId,
					task_id: task.id,
					resource_owner_user_id: userId,
					permission_level: 'edit',
					granted_by: userId,
				})

				// otherUserId creates an artifact
				const daemonAuth = createMockDaemonAuth({
					userId: otherUserId,
					organizationId,
					hostId,
				})

				const operationType = 'Write'
				const operationContents = { tool: 'write_file' }

				const createResult = await call(
					upsertArtifactProcedure,
					{
						taskId: task.id,
						fileName: 'test-shared-user.md',
						content: '# Content',
						operationType,
						operationContents,
					},
					{
						context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
					},
				)

				const [logEntry] = await db
					.select()
					.from(artifactOperationsLog)
					.where(eq(artifactOperationsLog.artifact_id, createResult.artifactId))
					.limit(1)

				expect(logEntry).toBeDefined()
				// resource_owner_user_id should be the task owner (userId)
				expect(logEntry?.resource_owner_user_id).toBe(userId)
				// created_by should be the user who performed the operation (otherUserId)
				expect(logEntry?.created_by).toBe(otherUserId)
			})
		})
	})

	afterAll(async () => {
		await cleanupTestDb?.()
	}, 30000)
})
