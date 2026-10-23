import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'

import { artifactVersions } from '@humanlayer/db/tables/artifact-versions'
import { artifacts } from '@humanlayer/db/tables/artifacts'
import { organizations } from '@humanlayer/db/tables/organizations'
import { taskOrganizationAcl } from '@humanlayer/db/tables/task-organization-acl'
import { taskUserAcl } from '@humanlayer/db/tables/task-user-acl'
import { tasks } from '@humanlayer/db/tables/tasks'
import { call } from '@orpc/server'
import { eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { hash } from 'ohash'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { createTaskProcedure } from '../../src/orpc/api/tasks/create'
import { upsertArtifactProcedure } from '../../src/orpc/daemon/artifacts/upsert'
import { createMockApiAuth, createMockApiContext, createMockDaemonAuth, createMockDaemonContext } from '../mocks'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('artifacts test', async () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase

	let organizationId: string
	const workosOrganizationId = 'org_abc123'
	const userId = 'user_abc1234'
	const otherUserId = 'user_other456'
	const hostId = randomUUID()

	beforeAll(async () => {
		const testDb = await createTestDb('artifacts')
		cleanupTestDb = testDb.cleanup
		db = testDb.db

		// Set up organization and stuff
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

	describe('Basic Correctness', async () => {
		test('Creating a task and attaching a document should work', async () => {
			// Create API auth context with org
			const apiAuth = createMockApiAuth({
				userId,
				organizationId,
				workosOrganizationId,
			})

			const createTaskResult = await call(
				createTaskProcedure,
				{
					name: 'test task',
					slug: 'example-task',
					defaultWorkingDirectory: tmpdir(),
					setupStatus: 'completed',
				},
				{
					context: createMockApiContext({ auth: apiAuth, services: { db, dbReadReplica: db } }),
				},
			)

			const taskId = createTaskResult.task.id
			expect(taskId).toBeTypeOf('string')

			// Create daemon auth context
			const daemonAuth = createMockDaemonAuth({
				userId,
				organizationId,
				hostId,
			})

			const createArtifactResult = await call(
				upsertArtifactProcedure,
				{ taskId, fileName: 'test.md', content: '# Hello, world' },
				{
					context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
				},
			)

			expect(createArtifactResult.transactionId).toBeTypeOf('string')
		})
	})

	describe('Frontmatter Storage', () => {
		test('upsert with frontmatter stores it correctly', async () => {
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'frontmatter test',
					resource_owner_user_id: userId,
					created_by: userId,
				})
				.returning()
			if (!task) throw new Error('Failed to create task')

			const daemonAuth = createMockDaemonAuth({ userId, organizationId, hostId })
			const frontmatter = { type: 'research', status: 'complete', tags: ['test', 'frontmatter'] }

			const result = await call(
				upsertArtifactProcedure,
				{
					taskId: task.id,
					fileName: 'research.md',
					content: '---\ntype: research\nstatus: complete\ntags:\n  - test\n  - frontmatter\n---\n# Research',
					frontmatter,
				},
				{
					context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
				},
			)

			expect(result.created).toBe(true)

			// Verify frontmatter stored in DB
			const [artifact] = await db.select().from(artifacts).where(eq(artifacts.id, result.artifactId))
			expect(artifact?.frontmatter).toEqual(frontmatter)
		})

		test('upsert without frontmatter defaults to empty object', async () => {
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'no frontmatter test',
					resource_owner_user_id: userId,
					created_by: userId,
				})
				.returning()
			if (!task) throw new Error('Failed to create task')

			const daemonAuth = createMockDaemonAuth({ userId, organizationId, hostId })

			const result = await call(
				upsertArtifactProcedure,
				{ taskId: task.id, fileName: 'plain.md', content: '# No frontmatter' },
				{
					context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
				},
			)

			const [artifact] = await db.select().from(artifacts).where(eq(artifacts.id, result.artifactId))
			expect(artifact?.frontmatter).toEqual({})
		})

		test('update with new frontmatter replaces previous frontmatter', async () => {
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'update frontmatter test',
					resource_owner_user_id: userId,
					created_by: userId,
				})
				.returning()
			if (!task) throw new Error('Failed to create task')

			const daemonAuth = createMockDaemonAuth({ userId, organizationId, hostId })

			// First upsert with initial frontmatter
			await call(
				upsertArtifactProcedure,
				{
					taskId: task.id,
					fileName: 'evolving.md',
					content: '---\ntype: research\n---\n# V1',
					frontmatter: { type: 'research' },
				},
				{
					context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
				},
			)

			// Second upsert with updated frontmatter
			const result = await call(
				upsertArtifactProcedure,
				{
					taskId: task.id,
					fileName: 'evolving.md',
					content: '---\ntype: plan\nstatus: draft\n---\n# V2',
					frontmatter: { type: 'plan', status: 'draft' },
				},
				{
					context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
				},
			)

			expect(result.created).toBe(false)

			const [artifact] = await db.select().from(artifacts).where(eq(artifacts.id, result.artifactId))
			expect(artifact?.frontmatter).toEqual({ type: 'plan', status: 'draft' })
		})

		test('upsert with empty frontmatter {} stores empty object', async () => {
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'empty frontmatter test',
					resource_owner_user_id: userId,
					created_by: userId,
				})
				.returning()
			if (!task) throw new Error('Failed to create task')

			const daemonAuth = createMockDaemonAuth({ userId, organizationId, hostId })

			const result = await call(
				upsertArtifactProcedure,
				{
					taskId: task.id,
					fileName: 'empty-fm.md',
					content: '# Just content',
					frontmatter: {},
				},
				{
					context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
				},
			)

			const [artifact] = await db.select().from(artifacts).where(eq(artifacts.id, result.artifactId))
			expect(artifact?.frontmatter).toEqual({})
		})
	})

	describe('Write Permission Requirements', () => {
		test('Owner can upsert artifact (owner has implicit write)', async () => {
			// Create task owned by userId
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'owner write test',
					resource_owner_user_id: userId,
					created_by: userId,
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			const daemonAuth = createMockDaemonAuth({
				userId,
				organizationId,
				hostId,
			})

			const result = await call(
				upsertArtifactProcedure,
				{ taskId: task.id, fileName: 'owner-test.md', content: '# Owner content' },
				{
					context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
				},
			)

			expect(result.created).toBe(true)
			expect(result.artifactId).toBeTypeOf('string')
		})

		test('User with read ACL cannot upsert (requires write)', async () => {
			// Create task owned by userId
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'read acl test',
					resource_owner_user_id: userId,
					created_by: userId,
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			// Grant read-only access to otherUserId
			await db.insert(taskUserAcl).values({
				task_id: task.id,
				subject_user_id: otherUserId,
				organization_id: organizationId,
				resource_owner_user_id: userId,
				permission_level: 'read',
				granted_by: userId,
			})

			const daemonAuth = createMockDaemonAuth({
				userId: otherUserId,
				organizationId,
				hostId,
			})

			await expect(
				call(
					upsertArtifactProcedure,
					{ taskId: task.id, fileName: 'read-test.md', content: '# Read only user' },
					{
						context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
					},
				),
			).rejects.toThrow()
		})

		test('User with comment ACL cannot upsert (requires write)', async () => {
			// Create task owned by userId
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'comment acl test',
					resource_owner_user_id: userId,
					created_by: userId,
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			// Grant comment access to otherUserId
			await db.insert(taskUserAcl).values({
				task_id: task.id,
				subject_user_id: otherUserId,
				organization_id: organizationId,
				resource_owner_user_id: userId,
				permission_level: 'comment',
				granted_by: userId,
			})

			const daemonAuth = createMockDaemonAuth({
				userId: otherUserId,
				organizationId,
				hostId,
			})

			await expect(
				call(
					upsertArtifactProcedure,
					{ taskId: task.id, fileName: 'comment-test.md', content: '# Comment only user' },
					{
						context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
					},
				),
			).rejects.toThrow()
		})

		test('User with write ACL can upsert', async () => {
			// Create task owned by userId
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'write acl test',
					resource_owner_user_id: userId,
					created_by: userId,
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			// Grant write access to otherUserId
			await db.insert(taskUserAcl).values({
				task_id: task.id,
				subject_user_id: otherUserId,
				organization_id: organizationId,
				resource_owner_user_id: userId,
				permission_level: 'edit',
				granted_by: userId,
			})

			const daemonAuth = createMockDaemonAuth({
				userId: otherUserId,
				organizationId,
				hostId,
			})

			const result = await call(
				upsertArtifactProcedure,
				{ taskId: task.id, fileName: 'write-test.md', content: '# Write user content' },
				{
					context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
				},
			)

			expect(result.created).toBe(true)
			expect(result.artifactId).toBeTypeOf('string')
		})

		test('Org ACL with write grants upsert access', async () => {
			// Create task owned by userId
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'org write acl test',
					resource_owner_user_id: userId,
					created_by: userId,
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			// Grant org-wide write access
			await db.insert(taskOrganizationAcl).values({
				task_id: task.id,
				organization_id: organizationId,
				resource_owner_user_id: userId,
				permission_level: 'edit',
				granted_by: userId,
			})

			const daemonAuth = createMockDaemonAuth({
				userId: otherUserId,
				organizationId,
				hostId,
			})

			const result = await call(
				upsertArtifactProcedure,
				{ taskId: task.id, fileName: 'org-write-test.md', content: '# Org write user content' },
				{
					context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
				},
			)

			expect(result.created).toBe(true)
			expect(result.artifactId).toBeTypeOf('string')
		})

		test('User without any access gets NOT_FOUND', async () => {
			// Create task owned by userId
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'no access test',
					resource_owner_user_id: userId,
					created_by: userId,
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			// No ACL granted to otherUserId

			const daemonAuth = createMockDaemonAuth({
				userId: otherUserId,
				organizationId,
				hostId,
			})

			await expect(
				call(
					upsertArtifactProcedure,
					{ taskId: task.id, fileName: 'no-access-test.md', content: '# No access user' },
					{
						context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
					},
				),
			).rejects.toThrow()
		})
	})

	describe('Section 5: Artifact Upsert - Basic Operations', () => {
		describe('5.1 Create New Artifact', () => {
			test('Test 42: Returns created: true for new artifact', async () => {
				const [task] = await db
					.insert(tasks)
					.values({
						organization_id: organizationId,
						name: 'test task for creation',
						resource_owner_user_id: userId,
						created_by: userId,
					})
					.returning()

				if (!task) throw new Error('Failed to create task')

				const daemonAuth = createMockDaemonAuth({ userId, organizationId, hostId })

				const result = await call(
					upsertArtifactProcedure,
					{ taskId: task.id, fileName: 'test-new.md', content: '# New artifact content' },
					{
						context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
					},
				)

				expect(result.created).toBe(true)
			})

			test('Test 43: Returns valid artifactId (UUIDv7)', async () => {
				const [task] = await db
					.insert(tasks)
					.values({
						organization_id: organizationId,
						name: 'test task for uuid',
						resource_owner_user_id: userId,
						created_by: userId,
					})
					.returning()

				if (!task) throw new Error('Failed to create task')

				const daemonAuth = createMockDaemonAuth({ userId, organizationId, hostId })

				const result = await call(
					upsertArtifactProcedure,
					{ taskId: task.id, fileName: 'test-uuid.md', content: '# UUID test' },
					{
						context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
					},
				)

				expect(result.artifactId).toBeTypeOf('string')
				// UUIDv7 is a valid UUID
				expect(result.artifactId).toMatch(
					/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
				)
			})

			test('Test 45: versionNumber is undefined on create', async () => {
				const [task] = await db
					.insert(tasks)
					.values({
						organization_id: organizationId,
						name: 'test task for version',
						resource_owner_user_id: userId,
						created_by: userId,
					})
					.returning()

				if (!task) throw new Error('Failed to create task')

				const daemonAuth = createMockDaemonAuth({ userId, organizationId, hostId })

				const result = await call(
					upsertArtifactProcedure,
					{ taskId: task.id, fileName: 'test-version.md', content: '# Version test' },
					{
						context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
					},
				)

				expect(result.versionNumber).toBeUndefined()
			})

			test('Test 46: Artifact has correct content_hash via ohash', async () => {
				const [task] = await db
					.insert(tasks)
					.values({
						organization_id: organizationId,
						name: 'test task for hash',
						resource_owner_user_id: userId,
						created_by: userId,
					})
					.returning()

				if (!task) throw new Error('Failed to create task')

				const daemonAuth = createMockDaemonAuth({ userId, organizationId, hostId })

				const content = '# Hash test content'
				const expectedHash = hash(content)

				const result = await call(
					upsertArtifactProcedure,
					{ taskId: task.id, fileName: 'test-hash.md', content },
					{
						context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
					},
				)

				// Query the artifact from the database
				const [artifact] = await db.select().from(artifacts).where(eq(artifacts.id, result.artifactId)).limit(1)

				expect(artifact).toBeDefined()
				expect(artifact?.content_hash).toBe(expectedHash)
			})

			test('Test 47: Artifact has correct file_name and content', async () => {
				const [task] = await db
					.insert(tasks)
					.values({
						organization_id: organizationId,
						name: 'test task for file',
						resource_owner_user_id: userId,
						created_by: userId,
					})
					.returning()

				if (!task) throw new Error('Failed to create task')

				const daemonAuth = createMockDaemonAuth({ userId, organizationId, hostId })

				const fileName = 'test-file.md'
				const content = '# File test content'

				const result = await call(
					upsertArtifactProcedure,
					{ taskId: task.id, fileName, content },
					{
						context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
					},
				)

				const [artifact] = await db.select().from(artifacts).where(eq(artifacts.id, result.artifactId)).limit(1)

				expect(artifact).toBeDefined()
				expect(artifact?.file_name).toBe(fileName)
				expect(artifact?.content).toBe(content)
			})

			test('Test 48: Artifact has task_slug from task (when set)', async () => {
				const taskSlug = 'my-task-slug'
				const [task] = await db
					.insert(tasks)
					.values({
						organization_id: organizationId,
						name: 'test task with slug',
						slug: taskSlug,
						resource_owner_user_id: userId,
						created_by: userId,
					})
					.returning()

				if (!task) throw new Error('Failed to create task')

				const daemonAuth = createMockDaemonAuth({ userId, organizationId, hostId })

				const result = await call(
					upsertArtifactProcedure,
					{ taskId: task.id, fileName: 'test-slug.md', content: '# Slug test' },
					{
						context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
					},
				)

				const [artifact] = await db.select().from(artifacts).where(eq(artifacts.id, result.artifactId)).limit(1)

				expect(artifact).toBeDefined()
				expect(artifact?.task_slug).toBe(taskSlug)
			})

			test('Test 49: Artifact has null task_slug when task has no slug', async () => {
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

				const daemonAuth = createMockDaemonAuth({ userId, organizationId, hostId })

				const result = await call(
					upsertArtifactProcedure,
					{ taskId: task.id, fileName: 'test-no-slug.md', content: '# No slug test' },
					{
						context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
					},
				)

				const [artifact] = await db.select().from(artifacts).where(eq(artifacts.id, result.artifactId)).limit(1)

				expect(artifact).toBeDefined()
				expect(artifact?.task_slug).toBeNull()
			})
		})

		describe('5.2 Artifact Ownership Inheritance', () => {
			test('Test 50: resource_owner_user_id inherited from task', async () => {
				const [task] = await db
					.insert(tasks)
					.values({
						organization_id: organizationId,
						name: 'test task for ownership',
						resource_owner_user_id: userId,
						created_by: userId,
					})
					.returning()

				if (!task) throw new Error('Failed to create task')

				const daemonAuth = createMockDaemonAuth({ userId, organizationId, hostId })

				const result = await call(
					upsertArtifactProcedure,
					{ taskId: task.id, fileName: 'test-owner.md', content: '# Owner test' },
					{
						context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
					},
				)

				const [artifact] = await db.select().from(artifacts).where(eq(artifacts.id, result.artifactId)).limit(1)

				expect(artifact).toBeDefined()
				expect(artifact?.resource_owner_user_id).toBe(userId)
				expect(artifact?.resource_owner_user_id).toBe(task.resource_owner_user_id ?? undefined)
			})

			test('Test 51: organization_id inherited from task', async () => {
				const [task] = await db
					.insert(tasks)
					.values({
						organization_id: organizationId,
						name: 'test task for org',
						resource_owner_user_id: userId,
						created_by: userId,
					})
					.returning()

				if (!task) throw new Error('Failed to create task')

				const daemonAuth = createMockDaemonAuth({ userId, organizationId, hostId })

				const result = await call(
					upsertArtifactProcedure,
					{ taskId: task.id, fileName: 'test-org.md', content: '# Org test' },
					{
						context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
					},
				)

				const [artifact] = await db.select().from(artifacts).where(eq(artifacts.id, result.artifactId)).limit(1)

				expect(artifact).toBeDefined()
				expect(artifact?.organization_id).toBe(organizationId)
				expect(artifact?.organization_id).toBe(task.organization_id)
			})

			test('Test 52: created_by set to calling user (daemon auth userId)', async () => {
				const [task] = await db
					.insert(tasks)
					.values({
						organization_id: organizationId,
						name: 'test task for created_by',
						resource_owner_user_id: userId,
						created_by: userId,
					})
					.returning()

				if (!task) throw new Error('Failed to create task')

				const daemonAuth = createMockDaemonAuth({ userId, organizationId, hostId })

				const result = await call(
					upsertArtifactProcedure,
					{ taskId: task.id, fileName: 'test-created-by.md', content: '# Created by test' },
					{
						context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
					},
				)

				const [artifact] = await db.select().from(artifacts).where(eq(artifacts.id, result.artifactId)).limit(1)

				expect(artifact).toBeDefined()
				expect(artifact?.created_by).toBe(userId)
			})

			test('Test 53: Shared user creates artifact: resource_owner_user_id = task owner, created_by = shared user', async () => {
				// Create task owned by userId
				const [task] = await db
					.insert(tasks)
					.values({
						organization_id: organizationId,
						name: 'test task for shared user',
						resource_owner_user_id: userId,
						created_by: userId,
					})
					.returning()

				if (!task) throw new Error('Failed to create task')

				// Grant write access to otherUserId
				await db.insert(taskUserAcl).values({
					task_id: task.id,
					subject_user_id: otherUserId,
					organization_id: organizationId,
					resource_owner_user_id: userId,
					permission_level: 'edit',
					granted_by: userId,
				})

				// otherUserId creates the artifact
				const daemonAuth = createMockDaemonAuth({
					userId: otherUserId,
					organizationId,
					hostId,
				})

				const result = await call(
					upsertArtifactProcedure,
					{ taskId: task.id, fileName: 'test-shared.md', content: '# Shared user content' },
					{
						context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
					},
				)

				const [artifact] = await db.select().from(artifacts).where(eq(artifacts.id, result.artifactId)).limit(1)

				expect(artifact).toBeDefined()
				// resource_owner_user_id should be the task owner
				expect(artifact?.resource_owner_user_id).toBe(userId)
				// created_by should be the shared user
				expect(artifact?.created_by).toBe(otherUserId)
				// They should be different
				expect(artifact?.resource_owner_user_id).not.toBe(artifact?.created_by)
			})
		})

		describe('5.3 Update Existing Artifact (Content Changed)', () => {
			test('Test 54: Returns created: false', async () => {
				const [task] = await db
					.insert(tasks)
					.values({
						organization_id: organizationId,
						name: 'test task for update',
						resource_owner_user_id: userId,
						created_by: userId,
					})
					.returning()

				if (!task) throw new Error('Failed to create task')

				const daemonAuth = createMockDaemonAuth({ userId, organizationId, hostId })

				// Create the artifact
				await call(
					upsertArtifactProcedure,
					{ taskId: task.id, fileName: 'test-update.md', content: '# Original content' },
					{
						context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
					},
				)

				// Update the artifact
				const updateResult = await call(
					upsertArtifactProcedure,
					{ taskId: task.id, fileName: 'test-update.md', content: '# Updated content' },
					{
						context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
					},
				)

				expect(updateResult.created).toBe(false)
			})

			test('Test 55: Returns versionNumber: 1 on first update', async () => {
				const [task] = await db
					.insert(tasks)
					.values({
						organization_id: organizationId,
						name: 'test task for version number',
						resource_owner_user_id: userId,
						created_by: userId,
					})
					.returning()

				if (!task) throw new Error('Failed to create task')

				const daemonAuth = createMockDaemonAuth({ userId, organizationId, hostId })

				// Create the artifact
				await call(
					upsertArtifactProcedure,
					{ taskId: task.id, fileName: 'test-version-num.md', content: '# Original content' },
					{
						context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
					},
				)

				// Update the artifact
				const updateResult = await call(
					upsertArtifactProcedure,
					{ taskId: task.id, fileName: 'test-version-num.md', content: '# Updated content' },
					{
						context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
					},
				)

				expect(updateResult.versionNumber).toBe(1)
			})

			test('Test 56: Artifacts content and content_hash updated', async () => {
				const [task] = await db
					.insert(tasks)
					.values({
						organization_id: organizationId,
						name: 'test task for content update',
						resource_owner_user_id: userId,
						created_by: userId,
					})
					.returning()

				if (!task) throw new Error('Failed to create task')

				const daemonAuth = createMockDaemonAuth({ userId, organizationId, hostId })

				const originalContent = '# Original content'
				const updatedContent = '# Updated content'

				// Create the artifact
				const createResult = await call(
					upsertArtifactProcedure,
					{ taskId: task.id, fileName: 'test-content-update.md', content: originalContent },
					{
						context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
					},
				)

				// Update the artifact
				await call(
					upsertArtifactProcedure,
					{ taskId: task.id, fileName: 'test-content-update.md', content: updatedContent },
					{
						context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
					},
				)

				const [artifact] = await db
					.select()
					.from(artifacts)
					.where(eq(artifacts.id, createResult.artifactId))
					.limit(1)

				expect(artifact).toBeDefined()
				expect(artifact?.content).toBe(updatedContent)
				expect(artifact?.content_hash).toBe(hash(updatedContent))
				expect(artifact?.content_hash).not.toBe(hash(originalContent))
			})

			test('Test 57: Artifacts last_updated_at updated', async () => {
				const [task] = await db
					.insert(tasks)
					.values({
						organization_id: organizationId,
						name: 'test task for timestamp',
						resource_owner_user_id: userId,
						created_by: userId,
					})
					.returning()

				if (!task) throw new Error('Failed to create task')

				const daemonAuth = createMockDaemonAuth({ userId, organizationId, hostId })

				// Create the artifact
				const createResult = await call(
					upsertArtifactProcedure,
					{ taskId: task.id, fileName: 'test-timestamp.md', content: '# Original content' },
					{
						context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
					},
				)

				const [artifactBefore] = await db
					.select()
					.from(artifacts)
					.where(eq(artifacts.id, createResult.artifactId))
					.limit(1)

				// Wait a bit to ensure timestamp changes
				await new Promise((resolve) => setTimeout(resolve, 10))

				// Update the artifact
				await call(
					upsertArtifactProcedure,
					{ taskId: task.id, fileName: 'test-timestamp.md', content: '# Updated content' },
					{
						context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
					},
				)

				const [artifactAfter] = await db
					.select()
					.from(artifacts)
					.where(eq(artifacts.id, createResult.artifactId))
					.limit(1)

				expect(artifactAfter).toBeDefined()
				expect(artifactAfter?.last_updated_at).toBeGreaterThan(artifactBefore!.last_updated_at)
			})
		})

		describe('5.4 Update Existing Artifact (Content Unchanged)', () => {
			test('converts an S3-backed artifact to exact Postgres text without creating a version', async () => {
				const [task] = await db
					.insert(tasks)
					.values({
						organization_id: organizationId,
						name: 'S3 text conversion test',
						resource_owner_user_id: userId,
						created_by: userId,
					})
					.returning()

				if (!task) throw new Error('Failed to create task')

				const fileName = 'data.json'
				const content = '{\n  "enabled": true\n}\n'
				const [s3Artifact] = await db
					.insert(artifacts)
					.values({
						task_id: task.id,
						file_name: fileName,
						content: '',
						content_hash: hash(content),
						resource_owner_user_id: userId,
						organization_id: organizationId,
						created_by: userId,
						storage_type: 's3',
						s3_key: `artifacts/${task.id}/${fileName}`,
						content_type: 'application/json',
						file_size_bytes: BigInt(Buffer.byteLength(content, 'utf8')),
					})
					.returning()

				if (!s3Artifact) throw new Error('Failed to seed S3 artifact')

				const daemonAuth = createMockDaemonAuth({ userId, organizationId, hostId })
				const result = await call(
					upsertArtifactProcedure,
					{ taskId: task.id, fileName, content },
					{
						context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
					},
				)

				const [convertedArtifact] = await db.select().from(artifacts).where(eq(artifacts.id, s3Artifact.id))
				const versions = await db
					.select()
					.from(artifactVersions)
					.where(eq(artifactVersions.artifact_id, s3Artifact.id))

				expect(result).toMatchObject({ artifactId: s3Artifact.id, created: false })
				expect(result.versionNumber).toBeUndefined()
				expect(convertedArtifact).toMatchObject({
					storage_type: 'postgres',
					content,
					content_hash: hash(content),
					s3_key: null,
					content_type: null,
					file_size_bytes: null,
				})
				expect(versions).toHaveLength(0)
			})

			test('Test 58: Returns created: false', async () => {
				const [task] = await db
					.insert(tasks)
					.values({
						organization_id: organizationId,
						name: 'test task for unchanged',
						resource_owner_user_id: userId,
						created_by: userId,
					})
					.returning()

				if (!task) throw new Error('Failed to create task')

				const daemonAuth = createMockDaemonAuth({ userId, organizationId, hostId })

				const content = '# Same content'

				// Create the artifact
				await call(
					upsertArtifactProcedure,
					{ taskId: task.id, fileName: 'test-unchanged.md', content },
					{
						context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
					},
				)

				// Update with same content
				const updateResult = await call(
					upsertArtifactProcedure,
					{ taskId: task.id, fileName: 'test-unchanged.md', content },
					{
						context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
					},
				)

				expect(updateResult.created).toBe(false)
			})

			test('Test 59: versionNumber is undefined (no version created)', async () => {
				const [task] = await db
					.insert(tasks)
					.values({
						organization_id: organizationId,
						name: 'test task for no version',
						resource_owner_user_id: userId,
						created_by: userId,
					})
					.returning()

				if (!task) throw new Error('Failed to create task')

				const daemonAuth = createMockDaemonAuth({ userId, organizationId, hostId })

				const content = '# Same content again'

				// Create the artifact
				await call(
					upsertArtifactProcedure,
					{ taskId: task.id, fileName: 'test-no-version.md', content },
					{
						context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
					},
				)

				// Update with same content
				const updateResult = await call(
					upsertArtifactProcedure,
					{ taskId: task.id, fileName: 'test-no-version.md', content },
					{
						context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
					},
				)

				expect(updateResult.versionNumber).toBeUndefined()
			})

			test('Test 60: No new row in artifact_versions', async () => {
				const [task] = await db
					.insert(tasks)
					.values({
						organization_id: organizationId,
						name: 'test task for version count',
						resource_owner_user_id: userId,
						created_by: userId,
					})
					.returning()

				if (!task) throw new Error('Failed to create task')

				const daemonAuth = createMockDaemonAuth({ userId, organizationId, hostId })

				const content = '# Consistent content'

				// Create the artifact
				const createResult = await call(
					upsertArtifactProcedure,
					{ taskId: task.id, fileName: 'test-version-count.md', content },
					{
						context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
					},
				)

				// Count versions before update
				const versionsBefore = await db
					.select()
					.from(artifactVersions)
					.where(eq(artifactVersions.artifact_id, createResult.artifactId))

				// Update with same content
				await call(
					upsertArtifactProcedure,
					{ taskId: task.id, fileName: 'test-version-count.md', content },
					{
						context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
					},
				)

				// Count versions after update
				const versionsAfter = await db
					.select()
					.from(artifactVersions)
					.where(eq(artifactVersions.artifact_id, createResult.artifactId))

				expect(versionsAfter.length).toBe(versionsBefore.length)
				expect(versionsAfter.length).toBe(0) // No versions should exist
			})
		})

		describe('5.5 Upsert Idempotency', () => {
			test('Test 61: Same (taskId, fileName) updates same artifact', async () => {
				const [task] = await db
					.insert(tasks)
					.values({
						organization_id: organizationId,
						name: 'test task for idempotency',
						resource_owner_user_id: userId,
						created_by: userId,
					})
					.returning()

				if (!task) throw new Error('Failed to create task')

				const daemonAuth = createMockDaemonAuth({ userId, organizationId, hostId })

				const fileName = 'test-idempotent.md'

				// Create the artifact
				const createResult = await call(
					upsertArtifactProcedure,
					{ taskId: task.id, fileName, content: '# First content' },
					{
						context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
					},
				)

				// Update with same taskId and fileName
				const updateResult = await call(
					upsertArtifactProcedure,
					{ taskId: task.id, fileName, content: '# Second content' },
					{
						context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
					},
				)

				expect(updateResult.artifactId).toBe(createResult.artifactId)
			})

			test('Test 62: Different fileName creates different artifact', async () => {
				const [task] = await db
					.insert(tasks)
					.values({
						organization_id: organizationId,
						name: 'test task for different files',
						resource_owner_user_id: userId,
						created_by: userId,
					})
					.returning()

				if (!task) throw new Error('Failed to create task')

				const daemonAuth = createMockDaemonAuth({ userId, organizationId, hostId })

				// Create first artifact
				const result1 = await call(
					upsertArtifactProcedure,
					{ taskId: task.id, fileName: 'file1.md', content: '# File 1' },
					{
						context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
					},
				)

				// Create second artifact with different fileName
				const result2 = await call(
					upsertArtifactProcedure,
					{ taskId: task.id, fileName: 'file2.md', content: '# File 2' },
					{
						context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
					},
				)

				expect(result1.artifactId).not.toBe(result2.artifactId)
			})

			test('Test 63: Different taskId creates different artifact', async () => {
				const [task1] = await db
					.insert(tasks)
					.values({
						organization_id: organizationId,
						name: 'test task 1 for different tasks',
						resource_owner_user_id: userId,
						created_by: userId,
					})
					.returning()

				const [task2] = await db
					.insert(tasks)
					.values({
						organization_id: organizationId,
						name: 'test task 2 for different tasks',
						resource_owner_user_id: userId,
						created_by: userId,
					})
					.returning()

				if (!task1 || !task2) throw new Error('Failed to create tasks')

				const daemonAuth = createMockDaemonAuth({ userId, organizationId, hostId })

				const fileName = 'same-file.md'

				// Create artifact in first task
				const result1 = await call(
					upsertArtifactProcedure,
					{ taskId: task1.id, fileName, content: '# Task 1 content' },
					{
						context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
					},
				)

				// Create artifact in second task with same fileName
				const result2 = await call(
					upsertArtifactProcedure,
					{ taskId: task2.id, fileName, content: '# Task 2 content' },
					{
						context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
					},
				)

				expect(result1.artifactId).not.toBe(result2.artifactId)
			})
		})
	})

	afterAll(async () => {
		await cleanupTestDb?.()
	}, 30000)
})
