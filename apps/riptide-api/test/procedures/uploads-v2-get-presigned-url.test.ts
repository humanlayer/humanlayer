import { randomUUID } from 'node:crypto'

import { artifacts } from '@humanlayer/db/tables/artifacts'
import { organizations } from '@humanlayer/db/tables/organizations'
import { taskUserAcl } from '@humanlayer/db/tables/task-user-acl'
import { tasks } from '@humanlayer/db/tables/tasks'
import { call } from '@orpc/server'
import { eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { Effect, Layer } from 'effect'
import { uuidv7 } from 'uuidv7'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { S3 } from '../../src/effects/services/s3/s3.service'
import { getPresignedUrlProcedure as liveExistingTaskPresignProcedure } from '../../src/orpc/api/uploads/get-presigned-url.effect'
import { getPresignedUrlV2Procedure as liveFutureTaskPresignProcedure } from '../../src/orpc/api/uploads/v2/get-presigned-url.effect'
import { bindProcedureToRuntime, createRuntimeWithTestPostgresLayer } from '../utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('uploads.v2.getPresignedUrl', () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let runtime: ReturnType<typeof createRuntimeWithTestPostgresLayer>
	let organizationId: string
	let otherOrganizationId: string

	const ownerUserId = 'future-upload-owner'
	const editorUserId = 'future-upload-editor'
	const strangerUserId = 'future-upload-stranger'
	const workosOrganizationId = `workos-future-upload-${randomUUID()}`
	const otherWorkosOrganizationId = `workos-future-upload-other-${randomUUID()}`
	const presignInputs: Array<{ key: string; contentType: string }> = []

	beforeAll(async () => {
		const testDb = await createTestDb('uploads_v2_get_presigned_url')
		cleanupTestDb = testDb.cleanup
		db = testDb.db

		const s3Layer = Layer.succeed(S3, {
			getPresignedDownloadUrl: () => Effect.die('unused'),
			getPresignedUploadUrl: (key, contentType) =>
				Effect.sync(() => {
					presignInputs.push({ key, contentType })
					return `https://s3.test/upload/${encodeURIComponent(key)}`
				}),
			presignDownload: () => Effect.die('unused'),
			presignUpload: () => Effect.die('unused'),
			uploadArtifactBytes: () => Effect.die('unused'),
		})
		runtime = createRuntimeWithTestPostgresLayer(db, { s3: s3Layer })

		const insertedOrganizations = await db
			.insert(organizations)
			.values([
				{ name: 'Future Upload Organization', workos_organization_id: workosOrganizationId },
				{ name: 'Other Future Upload Organization', workos_organization_id: otherWorkosOrganizationId },
			])
			.returning()
		const [organization, otherOrganization] = insertedOrganizations
		if (!organization || !otherOrganization) throw new Error('Failed to seed upload test organizations')
		organizationId = organization.id
		otherOrganizationId = otherOrganization.id
	}, 60_000)

	beforeEach(() => {
		presignInputs.length = 0
	})

	afterAll(async () => {
		await runtime?.dispose()
		await cleanupTestDb?.()
	}, 30_000)

	const context = (
		userId = ownerUserId,
		selectedOrganizationId = organizationId,
		selectedWorkosOrganizationId = workosOrganizationId,
	) => ({
		auth: {
			userId,
			organizationId: selectedOrganizationId,
			workosOrganizationId: selectedWorkosOrganizationId,
			role: '',
			roles: [],
			permissions: [],
			entitlements: [],
			sessionId: `session-${userId}`,
		},
	})

	const futureTaskPresignProcedure = () => bindProcedureToRuntime(liveFutureTaskPresignProcedure, runtime)
	const existingTaskPresignProcedure = () => bindProcedureToRuntime(liveExistingTaskPresignProcedure, runtime)

	async function insertTask(taskOrganizationId = organizationId) {
		const [task] = await db
			.insert(tasks)
			.values({
				id: uuidv7(),
				organization_id: taskOrganizationId,
				name: 'Upload authorization task',
				resource_owner_user_id: ownerUserId,
				created_by: ownerUserId,
				setup_status: 'completed',
			})
			.returning()
		if (!task) throw new Error('Failed to seed upload authorization task')
		return task
	}

	test('presigns a server-derived key for a missing future task without creating rows', async () => {
		const taskId = uuidv7()
		const result = await call(
			futureTaskPresignProcedure(),
			{ taskId, fileName: 'context/notes.txt', contentType: 'text/plain' },
			{ context: context() },
		)

		const expectedKey = `${organizationId}/${taskId}/context/notes.txt`
		expect(result).toEqual({ uploadUrl: `https://s3.test/upload/${encodeURIComponent(expectedKey)}` })
		expect(presignInputs).toEqual([{ key: expectedKey, contentType: 'text/plain' }])
		expect(await db.select().from(tasks).where(eq(tasks.id, taskId))).toHaveLength(0)
		expect(await db.select().from(artifacts).where(eq(artifacts.task_id, taskId))).toHaveLength(0)
	})

	test('presigns for an existing task owner', async () => {
		const task = await insertTask()

		await expect(
			call(
				futureTaskPresignProcedure(),
				{ taskId: task.id, fileName: 'owned.txt', contentType: 'text/plain' },
				{ context: context() },
			),
		).resolves.toEqual({
			uploadUrl: `https://s3.test/upload/${encodeURIComponent(`${organizationId}/${task.id}/owned.txt`)}`,
		})
	})

	test('presigns for an existing task editor', async () => {
		const task = await insertTask()
		await db.insert(taskUserAcl).values({
			task_id: task.id,
			subject_user_id: editorUserId,
			organization_id: organizationId,
			resource_owner_user_id: ownerUserId,
			permission_level: 'edit',
			granted_by: ownerUserId,
		})

		await expect(
			call(
				futureTaskPresignProcedure(),
				{ taskId: task.id, fileName: 'editor.txt', contentType: 'text/plain' },
				{ context: context(editorUserId) },
			),
		).resolves.toMatchObject({ uploadUrl: expect.stringContaining(encodeURIComponent(task.id)) })
	})

	test('rejects an existing same-organization task without edit access', async () => {
		const task = await insertTask()
		await db.insert(taskUserAcl).values({
			task_id: task.id,
			subject_user_id: strangerUserId,
			organization_id: organizationId,
			resource_owner_user_id: ownerUserId,
			permission_level: 'read',
			granted_by: ownerUserId,
		})

		await expect(
			call(
				futureTaskPresignProcedure(),
				{ taskId: task.id, fileName: 'forbidden.txt', contentType: 'text/plain' },
				{ context: context(strangerUserId) },
			),
		).rejects.toMatchObject({ code: 'FORBIDDEN' })
		expect(presignInputs).toHaveLength(0)
	})

	test('rejects an existing cross-organization task opaquely', async () => {
		const task = await insertTask(otherOrganizationId)

		await expect(
			call(
				futureTaskPresignProcedure(),
				{ taskId: task.id, fileName: 'foreign.txt', contentType: 'text/plain' },
				{ context: context() },
			),
		).rejects.toMatchObject({ code: 'NOT_FOUND' })
		expect(presignInputs).toHaveLength(0)
	})

	test.each([
		['non-v7 task ID', { taskId: randomUUID(), fileName: 'notes.txt', contentType: 'text/plain' }],
		['path traversal', { taskId: uuidv7(), fileName: '../notes.txt', contentType: 'text/plain' }],
		['absolute path', { taskId: uuidv7(), fileName: '/notes.txt', contentType: 'text/plain' }],
		['blank content type', { taskId: uuidv7(), fileName: 'notes.txt', contentType: ' ' }],
	])('rejects invalid %s input before presigning', async (_caseName, input) => {
		await expect(call(futureTaskPresignProcedure(), input, { context: context() })).rejects.toBeDefined()
		expect(presignInputs).toHaveLength(0)
	})

	test('leaves the original existing-task endpoint existing-task-only', async () => {
		await expect(
			call(
				existingTaskPresignProcedure(),
				{ taskId: uuidv7(), fileName: 'notes.txt', contentType: 'text/plain' },
				{ context: context() },
			),
		).rejects.toMatchObject({ code: 'NOT_FOUND' })
		expect(presignInputs).toHaveLength(0)
	})
})
