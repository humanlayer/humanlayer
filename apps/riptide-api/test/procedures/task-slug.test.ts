import { randomUUID } from 'node:crypto'

import { artifactOperationsLog } from '@humanlayer/db/tables/artifact-operations-log'
import { artifactVersions } from '@humanlayer/db/tables/artifact-versions'
import { artifacts } from '@humanlayer/db/tables/artifacts'
import { organizations } from '@humanlayer/db/tables/organizations'
import { tasks } from '@humanlayer/db/tables/tasks'
import { call } from '@orpc/server'
import { eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { updateTaskProcedure } from '../../src/orpc/api/tasks/update'
import { upsertArtifactProcedure } from '../../src/orpc/daemon/artifacts/upsert'
import { createMockApiAuth, createMockApiContext, createMockDaemonAuth, createMockDaemonContext } from '../mocks'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('task slug immutability and cascade test', async () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase

	let organizationId: string
	const workosOrganizationId = 'org_abc123'
	const userId = 'user_abc1234'
	const hostId = randomUUID()

	beforeAll(async () => {
		const testDb = await createTestDb('task_slug')
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

	describe('Section 11: Task Slug Immutability & Cascade', () => {
		describe('11.1 Slug Immutability (tests 130-132)', () => {
			test('Test 130: Can set slug when null', async () => {
				// Create task without a slug
				const [task] = await db
					.insert(tasks)
					.values({
						organization_id: organizationId,
						name: 'test task without slug',
						resource_owner_user_id: userId,
						created_by: userId,
					})
					.returning()

				if (!task) throw new Error('Failed to create task')

				expect(task.slug).toBeNull()

				// Set the slug
				const apiAuth = createMockApiAuth({
					userId,
					organizationId,
					workosOrganizationId,
				})

				const result = await call(
					updateTaskProcedure,
					{
						taskId: task.id,
						slug: 'my-first-slug',
					},
					{
						context: createMockApiContext({ auth: apiAuth, services: { db, dbReadReplica: db } }),
					},
				)

				expect(result.success).toBe(true)

				// Verify the slug was set
				const [updatedTask] = await db.select().from(tasks).where(eq(tasks.id, task.id)).limit(1)

				expect(updatedTask?.slug).toBe('my-first-slug')
			})

			test('Test 131: Cannot change slug once set - BAD_REQUEST error', async () => {
				// Create task with a slug
				const [task] = await db
					.insert(tasks)
					.values({
						organization_id: organizationId,
						name: 'test task with slug',
						slug: 'original-slug',
						resource_owner_user_id: userId,
						created_by: userId,
					})
					.returning()

				if (!task) throw new Error('Failed to create task')

				expect(task.slug).toBe('original-slug')

				// Try to change the slug
				const apiAuth = createMockApiAuth({
					userId,
					organizationId,
					workosOrganizationId,
				})

				// Should throw BAD_REQUEST error
				await expect(
					call(
						updateTaskProcedure,
						{
							taskId: task.id,
							slug: 'new-slug',
						},
						{
							context: createMockApiContext({ auth: apiAuth, services: { db, dbReadReplica: db } }),
						},
					),
				).rejects.toThrow()
			})

			test('Test 132: Setting to same value succeeds (no-op) - No error', async () => {
				// Create task with a slug
				const [task] = await db
					.insert(tasks)
					.values({
						organization_id: organizationId,
						name: 'test task with slug for no-op',
						slug: 'same-slug',
						resource_owner_user_id: userId,
						created_by: userId,
					})
					.returning()

				if (!task) throw new Error('Failed to create task')

				expect(task.slug).toBe('same-slug')

				// Set the slug to the same value
				const apiAuth = createMockApiAuth({
					userId,
					organizationId,
					workosOrganizationId,
				})

				const result = await call(
					updateTaskProcedure,
					{
						taskId: task.id,
						slug: 'same-slug', // Same value
					},
					{
						context: createMockApiContext({ auth: apiAuth, services: { db, dbReadReplica: db } }),
					},
				)

				// Should succeed with no error
				expect(result.success).toBe(true)

				// Verify the slug is still the same
				const [updatedTask] = await db.select().from(tasks).where(eq(tasks.id, task.id)).limit(1)

				expect(updatedTask?.slug).toBe('same-slug')
			})
		})

		describe('11.2 Slug Cascade (tests 133-135)', () => {
			test('Test 133: Setting slug cascades to artifacts.task_slug', async () => {
				// 1. Create a task with no slug
				const [task] = await db
					.insert(tasks)
					.values({
						organization_id: organizationId,
						name: 'test task for artifact cascade',
						resource_owner_user_id: userId,
						created_by: userId,
					})
					.returning()

				if (!task) throw new Error('Failed to create task')
				expect(task.slug).toBeNull()

				// 2. Create an artifact (which will have null task_slug)
				const daemonAuth = createMockDaemonAuth({ userId, organizationId, hostId })

				const createResult = await call(
					upsertArtifactProcedure,
					{
						taskId: task.id,
						fileName: 'test-cascade.md',
						content: '# Original content',
					},
					{
						context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
					},
				)

				// Verify artifact has null task_slug
				const [artifact] = await db
					.select()
					.from(artifacts)
					.where(eq(artifacts.id, createResult.artifactId))
					.limit(1)

				expect(artifact?.task_slug).toBeNull()

				// 3. Update the task to set slug
				const apiAuth = createMockApiAuth({
					userId,
					organizationId,
					workosOrganizationId,
				})

				const updateResult = await call(
					updateTaskProcedure,
					{
						taskId: task.id,
						slug: 'cascaded-slug',
					},
					{
						context: createMockApiContext({ auth: apiAuth, services: { db, dbReadReplica: db } }),
					},
				)

				expect(updateResult.success).toBe(true)

				// 4. Verify that artifacts.task_slug was updated
				const [updatedArtifact] = await db
					.select()
					.from(artifacts)
					.where(eq(artifacts.id, createResult.artifactId))
					.limit(1)

				expect(updatedArtifact?.task_slug).toBe('cascaded-slug')
			})

			test('Test 134: Setting slug cascades to artifact_versions.task_slug', async () => {
				// 1. Create a task with no slug
				const [task] = await db
					.insert(tasks)
					.values({
						organization_id: organizationId,
						name: 'test task for version cascade',
						resource_owner_user_id: userId,
						created_by: userId,
					})
					.returning()

				if (!task) throw new Error('Failed to create task')
				expect(task.slug).toBeNull()

				// 2. Create an artifact
				const daemonAuth = createMockDaemonAuth({ userId, organizationId, hostId })

				const createResult = await call(
					upsertArtifactProcedure,
					{
						taskId: task.id,
						fileName: 'test-version-cascade.md',
						content: '# Original content',
					},
					{
						context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
					},
				)

				// 3. Update the artifact content to create a version
				await call(
					upsertArtifactProcedure,
					{
						taskId: task.id,
						fileName: 'test-version-cascade.md',
						content: '# Updated content',
					},
					{
						context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
					},
				)

				// Verify version was created with null task_slug
				const [version] = await db
					.select()
					.from(artifactVersions)
					.where(eq(artifactVersions.artifact_id, createResult.artifactId))
					.limit(1)

				expect(version).toBeDefined()
				expect(version?.task_slug).toBeNull()

				// 4. Update the task to set slug
				const apiAuth = createMockApiAuth({
					userId,
					organizationId,
					workosOrganizationId,
				})

				const updateResult = await call(
					updateTaskProcedure,
					{
						taskId: task.id,
						slug: 'version-cascaded-slug',
					},
					{
						context: createMockApiContext({ auth: apiAuth, services: { db, dbReadReplica: db } }),
					},
				)

				expect(updateResult.success).toBe(true)

				// 5. Verify that artifact_versions.task_slug was updated
				const [updatedVersion] = await db
					.select()
					.from(artifactVersions)
					.where(eq(artifactVersions.artifact_id, createResult.artifactId))
					.limit(1)

				expect(updatedVersion?.task_slug).toBe('version-cascaded-slug')
			})

			test('Test 135: Setting slug cascades to artifact_operations_log.task_slug', async () => {
				// 1. Create a task with no slug
				const [task] = await db
					.insert(tasks)
					.values({
						organization_id: organizationId,
						name: 'test task for operations log cascade',
						resource_owner_user_id: userId,
						created_by: userId,
					})
					.returning()

				if (!task) throw new Error('Failed to create task')
				expect(task.slug).toBeNull()

				// 2. Create an artifact with operation logging
				const daemonAuth = createMockDaemonAuth({ userId, organizationId, hostId })

				const createResult = await call(
					upsertArtifactProcedure,
					{
						taskId: task.id,
						fileName: 'test-log-cascade.md',
						content: '# Original content',
						operationType: 'Write',
						operationContents: { tool: 'write_file' },
					},
					{
						context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
					},
				)

				// 3. Update the artifact to create another log entry
				await call(
					upsertArtifactProcedure,
					{
						taskId: task.id,
						fileName: 'test-log-cascade.md',
						content: '# Updated content',
						operationType: 'Edit',
						operationContents: { tool: 'edit_file' },
					},
					{
						context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
					},
				)

				// Verify operations log entries have null task_slug
				const logEntries = await db
					.select()
					.from(artifactOperationsLog)
					.where(eq(artifactOperationsLog.artifact_id, createResult.artifactId))

				expect(logEntries.length).toBeGreaterThan(0)
				for (const entry of logEntries) {
					expect(entry.task_slug).toBeNull()
				}

				// 4. Update the task to set slug
				const apiAuth = createMockApiAuth({
					userId,
					organizationId,
					workosOrganizationId,
				})

				const updateResult = await call(
					updateTaskProcedure,
					{
						taskId: task.id,
						slug: 'log-cascaded-slug',
					},
					{
						context: createMockApiContext({ auth: apiAuth, services: { db, dbReadReplica: db } }),
					},
				)

				expect(updateResult.success).toBe(true)

				// 5. Verify that artifact_operations_log.task_slug was updated for all entries
				const updatedLogEntries = await db
					.select()
					.from(artifactOperationsLog)
					.where(eq(artifactOperationsLog.artifact_id, createResult.artifactId))

				expect(updatedLogEntries.length).toBe(logEntries.length)
				for (const entry of updatedLogEntries) {
					expect(entry.task_slug).toBe('log-cascaded-slug')
				}
			})
		})
	})

	afterAll(async () => {
		await cleanupTestDb?.()
	}, 30000)
})
