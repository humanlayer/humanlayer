import { randomUUID } from 'node:crypto'

import { artifactVersions } from '@humanlayer/db/tables/artifact-versions'
import { organizations } from '@humanlayer/db/tables/organizations'
import { tasks } from '@humanlayer/db/tables/tasks'
import { call } from '@orpc/server'
import { eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { hash } from 'ohash'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { upsertArtifactProcedure } from '../../src/orpc/daemon/artifacts/upsert'
import { createMockDaemonAuth, createMockDaemonContext } from '../mocks'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('artifact versioning test', async () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase

	let organizationId: string
	const workosOrganizationId = 'org_abc123'
	const userId = 'user_abc1234'
	const _otherUserId = 'user_other456'
	const hostId = randomUUID()

	beforeAll(async () => {
		const testDb = await createTestDb('artifact_versioning')
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

	describe('Section 6: Artifact Versioning', () => {
		describe('6.1 Version Creation on Content Change', () => {
			test('Test 64: Version row created when content changes', async () => {
				const [task] = await db
					.insert(tasks)
					.values({
						organization_id: organizationId,
						name: 'test task for version creation',
						resource_owner_user_id: userId,
						created_by: userId,
					})
					.returning()

				if (!task) throw new Error('Failed to create task')

				const daemonAuth = createMockDaemonAuth({ userId, organizationId, hostId })

				// Create the artifact
				const createResult = await call(
					upsertArtifactProcedure,
					{ taskId: task.id, fileName: 'test-version.md', content: '# Original content' },
					{
						context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
					},
				)

				// Update the artifact with different content
				await call(
					upsertArtifactProcedure,
					{ taskId: task.id, fileName: 'test-version.md', content: '# Updated content' },
					{
						context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
					},
				)

				// Check that a version row was created
				const versions = await db
					.select()
					.from(artifactVersions)
					.where(eq(artifactVersions.artifact_id, createResult.artifactId))

				expect(versions.length).toBe(1)
			})

			test('Test 65: Version contains PREVIOUS content (before update)', async () => {
				const [task] = await db
					.insert(tasks)
					.values({
						organization_id: organizationId,
						name: 'test task for version content',
						resource_owner_user_id: userId,
						created_by: userId,
					})
					.returning()

				if (!task) throw new Error('Failed to create task')

				const daemonAuth = createMockDaemonAuth({ userId, organizationId, hostId })

				const originalContent = '# Original content for version'
				const updatedContent = '# Updated content for version'

				// Create the artifact
				const createResult = await call(
					upsertArtifactProcedure,
					{ taskId: task.id, fileName: 'test-version-content.md', content: originalContent },
					{
						context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
					},
				)

				// Update the artifact
				await call(
					upsertArtifactProcedure,
					{ taskId: task.id, fileName: 'test-version-content.md', content: updatedContent },
					{
						context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
					},
				)

				// Check that the version contains the PREVIOUS content
				const [version] = await db
					.select()
					.from(artifactVersions)
					.where(eq(artifactVersions.artifact_id, createResult.artifactId))
					.limit(1)

				expect(version).toBeDefined()
				expect(version?.content).toBe(originalContent)
				expect(version?.content).not.toBe(updatedContent)
			})

			test('Test 66: Version has correct content_hash of previous content', async () => {
				const [task] = await db
					.insert(tasks)
					.values({
						organization_id: organizationId,
						name: 'test task for version hash',
						resource_owner_user_id: userId,
						created_by: userId,
					})
					.returning()

				if (!task) throw new Error('Failed to create task')

				const daemonAuth = createMockDaemonAuth({ userId, organizationId, hostId })

				const originalContent = '# Original content for hash'
				const updatedContent = '# Updated content for hash'

				// Create the artifact
				const createResult = await call(
					upsertArtifactProcedure,
					{ taskId: task.id, fileName: 'test-version-hash.md', content: originalContent },
					{
						context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
					},
				)

				// Update the artifact
				await call(
					upsertArtifactProcedure,
					{ taskId: task.id, fileName: 'test-version-hash.md', content: updatedContent },
					{
						context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
					},
				)

				// Check that the version has the correct hash
				const [version] = await db
					.select()
					.from(artifactVersions)
					.where(eq(artifactVersions.artifact_id, createResult.artifactId))
					.limit(1)

				expect(version).toBeDefined()
				expect(version?.content_hash).toBe(hash(originalContent))
				expect(version?.content_hash).not.toBe(hash(updatedContent))
			})

			test('Test 68: Version inherits task_id, task_slug, resource_owner_user_id, organization_id', async () => {
				const taskSlug = 'test-slug-for-version'
				const [task] = await db
					.insert(tasks)
					.values({
						organization_id: organizationId,
						name: 'test task for version inheritance',
						slug: taskSlug,
						resource_owner_user_id: userId,
						created_by: userId,
					})
					.returning()

				if (!task) throw new Error('Failed to create task')

				const daemonAuth = createMockDaemonAuth({ userId, organizationId, hostId })

				// Create the artifact
				const createResult = await call(
					upsertArtifactProcedure,
					{ taskId: task.id, fileName: 'test-inherit.md', content: '# Original' },
					{
						context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
					},
				)

				// Update the artifact
				await call(
					upsertArtifactProcedure,
					{ taskId: task.id, fileName: 'test-inherit.md', content: '# Updated' },
					{
						context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
					},
				)

				// Check that the version inherits all the fields
				const [version] = await db
					.select()
					.from(artifactVersions)
					.where(eq(artifactVersions.artifact_id, createResult.artifactId))
					.limit(1)

				expect(version).toBeDefined()
				expect(version?.task_id).toBe(task.id)
				expect(version?.task_slug).toBe(taskSlug)
				expect(version?.resource_owner_user_id).toBe(userId)
				expect(version?.organization_id).toBe(organizationId)
			})

			test('Test 69: Version created_by is the user who triggered the update', async () => {
				const [task] = await db
					.insert(tasks)
					.values({
						organization_id: organizationId,
						name: 'test task for version created_by',
						resource_owner_user_id: userId,
						created_by: userId,
					})
					.returning()

				if (!task) throw new Error('Failed to create task')

				// First, create the artifact with userId
				const daemonAuth1 = createMockDaemonAuth({ userId, organizationId, hostId })

				const createResult = await call(
					upsertArtifactProcedure,
					{ taskId: task.id, fileName: 'test-created-by.md', content: '# Original' },
					{
						context: createMockDaemonContext({ auth: daemonAuth1, services: { db, dbReadReplica: db } }),
					},
				)

				// Update the artifact with userId (same user)
				await call(
					upsertArtifactProcedure,
					{ taskId: task.id, fileName: 'test-created-by.md', content: '# Updated' },
					{
						context: createMockDaemonContext({ auth: daemonAuth1, services: { db, dbReadReplica: db } }),
					},
				)

				// Check that the version was created_by userId
				const [version] = await db
					.select()
					.from(artifactVersions)
					.where(eq(artifactVersions.artifact_id, createResult.artifactId))
					.limit(1)

				expect(version).toBeDefined()
				expect(version?.created_by).toBe(userId)
			})
		})

		describe('6.2 Version Number Incrementing', () => {
			test('Test 70: First update creates version 1', async () => {
				const [task] = await db
					.insert(tasks)
					.values({
						organization_id: organizationId,
						name: 'test task for first version',
						resource_owner_user_id: userId,
						created_by: userId,
					})
					.returning()

				if (!task) throw new Error('Failed to create task')

				const daemonAuth = createMockDaemonAuth({ userId, organizationId, hostId })

				// Create the artifact
				const createResult = await call(
					upsertArtifactProcedure,
					{ taskId: task.id, fileName: 'test-first-version.md', content: '# Original' },
					{
						context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
					},
				)

				// First update
				await call(
					upsertArtifactProcedure,
					{ taskId: task.id, fileName: 'test-first-version.md', content: '# First update' },
					{
						context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
					},
				)

				const [version] = await db
					.select()
					.from(artifactVersions)
					.where(eq(artifactVersions.artifact_id, createResult.artifactId))
					.limit(1)

				expect(version).toBeDefined()
				expect(version?.version_number).toBe(1)
			})

			test('Test 71: Second update creates version 2', async () => {
				const [task] = await db
					.insert(tasks)
					.values({
						organization_id: organizationId,
						name: 'test task for second version',
						resource_owner_user_id: userId,
						created_by: userId,
					})
					.returning()

				if (!task) throw new Error('Failed to create task')

				const daemonAuth = createMockDaemonAuth({ userId, organizationId, hostId })

				// Create the artifact
				const createResult = await call(
					upsertArtifactProcedure,
					{ taskId: task.id, fileName: 'test-second-version.md', content: '# Original' },
					{
						context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
					},
				)

				// First update
				await call(
					upsertArtifactProcedure,
					{ taskId: task.id, fileName: 'test-second-version.md', content: '# First update' },
					{
						context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
					},
				)

				// Second update
				await call(
					upsertArtifactProcedure,
					{ taskId: task.id, fileName: 'test-second-version.md', content: '# Second update' },
					{
						context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
					},
				)

				const versions = await db
					.select()
					.from(artifactVersions)
					.where(eq(artifactVersions.artifact_id, createResult.artifactId))

				expect(versions.length).toBe(2)
				const versionNumbers = versions.map((v) => v.version_number).sort()
				expect(versionNumbers).toEqual([1, 2])
			})

			test('Test 73: Version numbers are sequential per artifact and each version has correct previous content hash', async () => {
				const [task] = await db
					.insert(tasks)
					.values({
						organization_id: organizationId,
						name: 'test task for sequential versions',
						resource_owner_user_id: userId,
						created_by: userId,
					})
					.returning()

				if (!task) throw new Error('Failed to create task')

				const daemonAuth = createMockDaemonAuth({ userId, organizationId, hostId })

				// Define all content versions in order
				const contents = ['# Original', '# Update 1', '# Update 2', '# Update 3', '# Update 4', '# Update 5']

				// Create the artifact with initial content
				const createResult = await call(
					upsertArtifactProcedure,
					// @ts-expect-error
					{ taskId: task.id, fileName: 'test-sequential.md', content: contents[0] },
					{
						context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
					},
				)

				// Perform multiple updates (contents[1] through contents[5])
				for (let i = 1; i <= 5; i++) {
					await call(
						upsertArtifactProcedure,
						// @ts-expect-error
						{ taskId: task.id, fileName: 'test-sequential.md', content: contents[i] },
						{
							context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
						},
					)
				}

				const versions = await db
					.select()
					.from(artifactVersions)
					.where(eq(artifactVersions.artifact_id, createResult.artifactId))

				expect(versions.length).toBe(5)

				// Sort versions by version_number to check them in order
				const sortedVersions = versions.sort((a, b) => a.version_number - b.version_number)

				// Check version numbers are sequential
				const versionNumbers = sortedVersions.map((v) => v.version_number)
				expect(versionNumbers).toEqual([1, 2, 3, 4, 5])

				// Each version should contain the PREVIOUS content and its hash
				// Version 1 was created when updating from contents[0] to contents[1], so it should have contents[0]
				// Version 2 was created when updating from contents[1] to contents[2], so it should have contents[1]
				// etc.
				for (let i = 0; i < sortedVersions.length; i++) {
					const version = sortedVersions[i]!
					const expectedContent = contents[i]! // The content BEFORE the update that created this version
					const expectedHash = hash(expectedContent)

					expect(version.content).toBe(expectedContent)
					expect(version.content_hash).toBe(expectedHash)
				}
			})
		})

		describe('6.3 No Version on Same Content', () => {
			test('Test 74: No version created when hash unchanged', async () => {
				const [task] = await db
					.insert(tasks)
					.values({
						organization_id: organizationId,
						name: 'test task for no version on same hash',
						resource_owner_user_id: userId,
						created_by: userId,
					})
					.returning()

				if (!task) throw new Error('Failed to create task')

				const daemonAuth = createMockDaemonAuth({ userId, organizationId, hostId })

				const content = '# Same content'

				// Create the artifact
				const createResult = await call(
					upsertArtifactProcedure,
					{ taskId: task.id, fileName: 'test-no-version.md', content },
					{
						context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
					},
				)

				// Update with same content (hash unchanged)
				await call(
					upsertArtifactProcedure,
					{ taskId: task.id, fileName: 'test-no-version.md', content },
					{
						context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
					},
				)

				const versions = await db
					.select()
					.from(artifactVersions)
					.where(eq(artifactVersions.artifact_id, createResult.artifactId))

				expect(versions.length).toBe(0)
			})

			test('Test 75: Multiple identical updates do not create versions', async () => {
				const [task] = await db
					.insert(tasks)
					.values({
						organization_id: organizationId,
						name: 'test task for multiple identical updates',
						resource_owner_user_id: userId,
						created_by: userId,
					})
					.returning()

				if (!task) throw new Error('Failed to create task')

				const daemonAuth = createMockDaemonAuth({ userId, organizationId, hostId })

				const content = '# Identical content'

				// Create the artifact
				const createResult = await call(
					upsertArtifactProcedure,
					{ taskId: task.id, fileName: 'test-multiple-identical.md', content },
					{
						context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
					},
				)

				// Perform multiple identical updates
				for (let i = 0; i < 5; i++) {
					await call(
						upsertArtifactProcedure,
						{ taskId: task.id, fileName: 'test-multiple-identical.md', content },
						{
							context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
						},
					)
				}

				const versions = await db
					.select()
					.from(artifactVersions)
					.where(eq(artifactVersions.artifact_id, createResult.artifactId))

				expect(versions.length).toBe(0)
			})
		})
	})

	afterAll(async () => {
		await cleanupTestDb?.()
	}, 30000)
})
