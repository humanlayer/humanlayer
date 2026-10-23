import { randomUUID } from 'node:crypto'

import { artifacts } from '@humanlayer/db/tables/artifacts'
import { organizations } from '@humanlayer/db/tables/organizations'
import { tasks } from '@humanlayer/db/tables/tasks'
import { call } from '@orpc/server'
import { eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { updateArtifactDeletionStatusProcedure as liveUpdateArtifactDeletionStatusProcedure } from '../../src/orpc/api/artifacts/update-deletion-status.effect'
import { upsertArtifactProcedure } from '../../src/orpc/daemon/artifacts/upsert'
import { createMockApiAuth, createMockApiContext, createMockDaemonAuth, createMockDaemonContext } from '../mocks'
import { bindProcedureToRuntime, createRuntimeWithTestPostgresLayer } from '../utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('api/artifacts/updateDeletionStatus', async () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let effectRuntime: ReturnType<typeof createRuntimeWithTestPostgresLayer> | undefined
	let updateArtifactDeletionStatusProcedure: typeof liveUpdateArtifactDeletionStatusProcedure

	let organizationId: string
	const workosOrganizationId = 'org_artifacts_delete'
	const userId = 'user_artifacts_delete_owner'
	const otherUserId = 'user_artifacts_delete_viewer'
	const hostId = randomUUID()

	let taskId: string
	let artifactId: string

	beforeAll(async () => {
		const testDb = await createTestDb('artifacts_delete')
		cleanupTestDb = testDb.cleanup
		db = testDb.db
		effectRuntime = createRuntimeWithTestPostgresLayer(db)
		updateArtifactDeletionStatusProcedure = bindProcedureToRuntime(
			liveUpdateArtifactDeletionStatusProcedure,
			effectRuntime,
		)

		const [org] = await db
			.insert(organizations)
			.values({
				name: 'artifact delete test org',
				workos_organization_id: workosOrganizationId,
			})
			.returning()

		if (!org) throw new Error('Unable to insert organization for setup')
		organizationId = org.id

		const [task] = await db
			.insert(tasks)
			.values({
				organization_id: organizationId,
				name: 'artifact delete test task',
				resource_owner_user_id: userId,
				created_by: userId,
			})
			.returning()

		if (!task) throw new Error('Unable to insert task for setup')
		taskId = task.id

		// Create the main artifact used across multiple tests
		artifactId = await createArtifact()
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

	async function createArtifact(fileName = 'delete-test.md') {
		const daemonAuth = createMockDaemonAuth({ userId, organizationId, hostId })
		const result = await call(
			upsertArtifactProcedure,
			{ taskId, fileName, content: `# ${fileName}` },
			{
				context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
			},
		)
		return result.artifactId
	}

	test('delete soft-tombstones the artifact (row still exists, is_deleted=true)', async () => {
		const result = await call(
			updateArtifactDeletionStatusProcedure,
			{ artifactId, isDeleted: true },
			{ context: makeContext() },
		)

		expect(result.success).toBe(true)
		expect(result.transactionId).toBeTypeOf('string')

		const [row] = await db.select().from(artifacts).where(eq(artifacts.id, artifactId)).limit(1)
		expect(row).toBeDefined()
		expect(row?.is_deleted).toBe(true)
	})

	test('idempotency: deleting already-deleted artifact succeeds', async () => {
		// artifactId was already deleted in previous test
		const result = await call(
			updateArtifactDeletionStatusProcedure,
			{ artifactId, isDeleted: true },
			{ context: makeContext() },
		)

		expect(result.success).toBe(true)
	})

	test('non-edit user cannot delete artifact - FORBIDDEN', async () => {
		const newArtifactId = await createArtifact('no-permission.md')

		// otherUserId has no ACL entry — not the owner, so no access
		await expect(
			call(
				updateArtifactDeletionStatusProcedure,
				{ artifactId: newArtifactId, isDeleted: true },
				{ context: makeContext(otherUserId) },
			),
		).rejects.toThrow()

		// Verify artifact is still not deleted
		const [row] = await db.select().from(artifacts).where(eq(artifacts.id, newArtifactId)).limit(1)
		expect(row?.is_deleted).toBe(false)
	})

	test('non-existent artifact returns NOT_FOUND', async () => {
		await expect(
			call(
				updateArtifactDeletionStatusProcedure,
				{ artifactId: randomUUID(), isDeleted: true },
				{ context: makeContext() },
			),
		).rejects.toThrow()
	})
})
