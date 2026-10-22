import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'

import { organizations } from '@humanlayer/db/tables/organizations'
import { call } from '@orpc/server'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { createTaskProcedure } from '../../src/orpc/api/tasks/create'
import { upsertTextArtifactProcedure } from '../../src/orpc/api/uploads/upsert-text.effect'
import { upsertArtifactProcedure } from '../../src/orpc/daemon/artifacts/upsert'
import { createMockApiAuth, createMockApiContext, createMockDaemonAuth, createMockDaemonContext } from '../mocks'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('artifact path traversal protection', async () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase

	let organizationId: string
	let taskId: string
	const workosOrganizationId = 'org_traversal_test'
	const userId = 'user_traversal_test'
	const hostId = randomUUID()

	beforeAll(async () => {
		const testDb = await createTestDb('artifacts-path-traversal')
		cleanupTestDb = testDb.cleanup
		db = testDb.db

		// Set up organization
		const [org] = await db
			.insert(organizations)
			.values({
				name: 'path traversal test org',
				workos_organization_id: workosOrganizationId,
			})
			.returning()

		if (!org) throw new Error('Unable to insert organization for setup')
		organizationId = org.id

		// Create a task to test against
		const apiAuth = createMockApiAuth({
			userId,
			organizationId,
			workosOrganizationId,
		})

		const createTaskResult = await call(
			createTaskProcedure,
			{
				name: 'traversal test task',
				slug: 'traversal-test-task',
				defaultWorkingDirectory: tmpdir(),
				setupStatus: 'completed',
			},
			{
				context: createMockApiContext({ auth: apiAuth, services: { db, dbReadReplica: db } }),
			},
		)

		taskId = createTaskResult.task.id
	}, 30000)

	afterAll(async () => {
		await cleanupTestDb?.()
	})

	const traversalPatterns = [
		{ name: 'raw traversal', fileName: '../../../.gitignore' },
		{ name: 'deep traversal', fileName: '../../../../../../../../etc/passwd' },
		{ name: 'URL-encoded traversal', fileName: '%2e%2e%2f%2e%2e%2f.gitignore' },
		{ name: 'absolute path', fileName: '/absolute/path.txt' },
		{ name: 'backslash', fileName: 'foo\\bar.txt' },
		{ name: 'URL-encoded slash', fileName: 'foo%2fbar.txt' },
		{ name: 'URL-encoded backslash', fileName: 'foo%5cbar.txt' },
		{ name: 'null byte', fileName: 'foo%00bar.txt' },
	]

	describe('daemon artifacts.upsert', () => {
		for (const { name, fileName } of traversalPatterns) {
			test(`rejects ${name}: ${fileName}`, async () => {
				const daemonAuth = createMockDaemonAuth({
					userId,
					organizationId,
					hostId,
				})

				await expect(
					call(
						upsertArtifactProcedure,
						{ taskId, fileName, content: 'malicious content' },
						{
							context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
						},
					),
				).rejects.toThrow()
			})
		}
	})

	describe('api uploads.upsertText', () => {
		for (const { name, fileName } of traversalPatterns) {
			test(`rejects ${name}: ${fileName}`, async () => {
				const apiAuth = createMockApiAuth({
					userId,
					organizationId,
					workosOrganizationId,
				})

				await expect(
					call(
						upsertTextArtifactProcedure,
						{ taskId, fileName, content: 'malicious content' },
						{
							context: createMockApiContext({ auth: apiAuth, services: { db, dbReadReplica: db } }),
						},
					),
				).rejects.toThrow()
			})
		}
	})

	test('accepts valid filenames and subpaths', async () => {
		const daemonAuth = createMockDaemonAuth({
			userId,
			organizationId,
			hostId,
		})

		const filenameResult = await call(
			upsertArtifactProcedure,
			{ taskId, fileName: 'valid-file.md', content: '# Valid content' },
			{
				context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
			},
		)

		const subpathResult = await call(
			upsertArtifactProcedure,
			{ taskId, fileName: 'research/valid-file.md', content: '# Valid subpath content' },
			{
				context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
			},
		)

		expect(filenameResult.artifactId).toBeTypeOf('string')
		expect(filenameResult.created).toBe(true)
		expect(subpathResult.artifactId).toBeTypeOf('string')
		expect(subpathResult.created).toBe(true)
	})
})
