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

describe('api/artifacts/updateDeletionStatus (restore)', async () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let effectRuntime: ReturnType<typeof createRuntimeWithTestPostgresLayer> | undefined
	let updateArtifactDeletionStatusProcedure: typeof liveUpdateArtifactDeletionStatusProcedure

	let organizationId: string
	const workosOrganizationId = 'org_artifacts_restore'
	const userId = 'user_artifacts_restore_owner'
	const hostId = randomUUID()

	let taskId: string
	let artifactId: string

	beforeAll(async () => {
		const testDb = await createTestDb('artifacts_restore')
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
				name: 'artifact restore test org',
				workos_organization_id: workosOrganizationId,
			})
			.returning()

		if (!org) throw new Error('Unable to insert organization for setup')
		organizationId = org.id

		const [task] = await db
			.insert(tasks)
			.values({
				organization_id: organizationId,
				name: 'artifact restore test task',
				resource_owner_user_id: userId,
				created_by: userId,
			})
			.returning()

		if (!task) throw new Error('Unable to insert task for setup')
		taskId = task.id

		// Create and soft-delete an artifact so restore tests have something to work with
		artifactId = await createAndDeleteArtifact()
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

	async function createAndDeleteArtifact(fileName = 'restore-test.md') {
		const daemonAuth = createMockDaemonAuth({ userId, organizationId, hostId })
		const result = await call(
			upsertArtifactProcedure,
			{ taskId, fileName, content: `# ${fileName}` },
			{
				context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
			},
		)

		// Soft-delete the artifact
		await call(
			updateArtifactDeletionStatusProcedure,
			{ artifactId: result.artifactId, isDeleted: true },
			{ context: makeContext() },
		)

		return result.artifactId
	}

	test('restore sets is_deleted back to false', async () => {
		const result = await call(
			updateArtifactDeletionStatusProcedure,
			{ artifactId, isDeleted: false },
			{ context: makeContext() },
		)

		expect(result.success).toBe(true)
		expect(result.transactionId).toBeTypeOf('string')

		const [row] = await db.select().from(artifacts).where(eq(artifacts.id, artifactId)).limit(1)
		expect(row).toBeDefined()
		expect(row?.is_deleted).toBe(false)
	})

	test('restore idempotency: restoring non-deleted artifact succeeds', async () => {
		// artifactId was already restored in previous test
		const result = await call(
			updateArtifactDeletionStatusProcedure,
			{ artifactId, isDeleted: false },
			{ context: makeContext() },
		)

		expect(result.success).toBe(true)
	})
})
