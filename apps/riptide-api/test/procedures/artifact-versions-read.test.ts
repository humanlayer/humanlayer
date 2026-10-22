import { randomUUID } from 'node:crypto'

import { describe, it } from '@effect/vitest'
import { artifactVersions } from '@humanlayer/db/tables/artifact-versions'
import { artifacts } from '@humanlayer/db/tables/artifacts'
import { organizations } from '@humanlayer/db/tables/organizations'
import { taskUserAcl } from '@humanlayer/db/tables/task-user-acl'
import { tasks } from '@humanlayer/db/tables/tasks'
import { call } from '@orpc/server'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { Effect } from 'effect'
import { hash } from 'ohash'
import { afterAll, beforeAll, expect } from 'vitest'

import { getArtifactVersionProcedure as liveGetArtifactVersionProcedure } from '../../src/orpc/api/artifacts/versions-get.effect'
import { listArtifactVersionsProcedure as liveListArtifactVersionsProcedure } from '../../src/orpc/api/artifacts/versions-list.effect'
import { createMockApiAuth, createMockApiContext } from '../mocks'
import { bindProcedureToRuntime, createRuntimeWithTestPostgresLayer } from '../utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('artifact version reads', () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let runtime: ReturnType<typeof createRuntimeWithTestPostgresLayer> | undefined
	let listArtifactVersionsProcedure: typeof liveListArtifactVersionsProcedure
	let getArtifactVersionProcedure: typeof liveGetArtifactVersionProcedure

	const ownerUserId = 'user_artifact_versions_owner'
	const readerUserId = 'user_artifact_versions_reader'
	const strangerUserId = 'user_artifact_versions_stranger'
	let organizationId: string
	let otherOrganizationId: string
	let artifactId: string
	let deletedArtifactId: string
	let otherArtifactId: string
	let crossArtifactVersionId: string
	let oldestVersionId: string

	beforeAll(async () => {
		const testDb = await createTestDb('artifact_versions_read')
		cleanupTestDb = testDb.cleanup
		db = testDb.db
		runtime = createRuntimeWithTestPostgresLayer(db)
		listArtifactVersionsProcedure = bindProcedureToRuntime(liveListArtifactVersionsProcedure, runtime)
		getArtifactVersionProcedure = bindProcedureToRuntime(liveGetArtifactVersionProcedure, runtime)

		const [organization, otherOrganization] = await db
			.insert(organizations)
			.values([
				{ name: 'artifact version readers', workos_organization_id: 'org_artifact_versions_read' },
				{ name: 'other artifact version readers', workos_organization_id: 'org_artifact_versions_other' },
			])
			.returning()
		if (!organization || !otherOrganization) throw new Error('Failed to create organizations')
		organizationId = organization.id
		otherOrganizationId = otherOrganization.id

		const [task, secondTask, otherTask] = await db
			.insert(tasks)
			.values([
				{
					organization_id: organizationId,
					name: 'versioned artifact task',
					resource_owner_user_id: ownerUserId,
					created_by: ownerUserId,
				},
				{
					organization_id: organizationId,
					name: 'second versioned artifact task',
					resource_owner_user_id: ownerUserId,
					created_by: ownerUserId,
				},
				{
					organization_id: otherOrganizationId,
					name: 'other organization task',
					resource_owner_user_id: ownerUserId,
					created_by: ownerUserId,
				},
			])
			.returning()
		if (!task || !secondTask || !otherTask) throw new Error('Failed to create tasks')

		await db.insert(taskUserAcl).values({
			task_id: task.id,
			subject_user_id: readerUserId,
			organization_id: organizationId,
			resource_owner_user_id: ownerUserId,
			permission_level: 'read',
			granted_by: ownerUserId,
		})

		const [artifact, deletedArtifact, secondArtifact, otherArtifact] = await db
			.insert(artifacts)
			.values([
				{
					task_id: task.id,
					organization_id: organizationId,
					resource_owner_user_id: ownerUserId,
					file_name: 'history.md',
					content: 'latest content',
					content_hash: hash('latest content'),
					created_by: ownerUserId,
					last_updated_at: 3000n,
				},
				{
					task_id: task.id,
					organization_id: organizationId,
					resource_owner_user_id: ownerUserId,
					file_name: 'deleted.md',
					content: 'deleted latest',
					content_hash: hash('deleted latest'),
					created_by: ownerUserId,
					is_deleted: true,
				},
				{
					task_id: secondTask.id,
					organization_id: organizationId,
					resource_owner_user_id: ownerUserId,
					file_name: 'second.md',
					content: 'second latest',
					content_hash: hash('second latest'),
					created_by: ownerUserId,
				},
				{
					task_id: otherTask.id,
					organization_id: otherOrganizationId,
					resource_owner_user_id: ownerUserId,
					file_name: 'other.md',
					content: 'other latest',
					content_hash: hash('other latest'),
					created_by: ownerUserId,
				},
			])
			.returning()
		if (!artifact || !deletedArtifact || !secondArtifact || !otherArtifact) {
			throw new Error('Failed to create artifacts')
		}
		artifactId = artifact.id
		deletedArtifactId = deletedArtifact.id
		otherArtifactId = otherArtifact.id

		const [oldestVersion, newestVersion, crossArtifactVersion] = await db
			.insert(artifactVersions)
			.values([
				{
					artifact_id: artifact.id,
					task_id: task.id,
					organization_id: organizationId,
					resource_owner_user_id: ownerUserId,
					content: 'version one content',
					content_hash: hash('version one content'),
					created_by: ownerUserId,
					created_at: 1000n,
					version_number: 1,
				},
				{
					artifact_id: artifact.id,
					task_id: task.id,
					organization_id: organizationId,
					resource_owner_user_id: ownerUserId,
					content: 'version two content',
					content_hash: hash('version two content'),
					created_by: ownerUserId,
					created_at: 2000n,
					version_number: 2,
				},
				{
					artifact_id: secondArtifact.id,
					task_id: secondTask.id,
					organization_id: organizationId,
					resource_owner_user_id: ownerUserId,
					content: 'cross artifact content',
					content_hash: hash('cross artifact content'),
					created_by: ownerUserId,
					version_number: 1,
				},
			])
			.returning()
		if (!oldestVersion || !newestVersion || !crossArtifactVersion) throw new Error('Failed to create versions')
		oldestVersionId = oldestVersion.id
		crossArtifactVersionId = crossArtifactVersion.id
	}, 60000)

	afterAll(async () => {
		await runtime?.dispose()
		await cleanupTestDb?.()
	}, 30000)

	function context(userId = ownerUserId, currentOrganizationId = organizationId) {
		return createMockApiContext({
			auth: createMockApiAuth({
				userId,
				organizationId: currentOrganizationId,
				workosOrganizationId: `workos_${currentOrganizationId}`,
			}),
			services: { db, dbReadReplica: db },
		})
	}

	it.effect('lists archives newest-first and keeps live content out of metadata', () =>
		Effect.gen(function* () {
			const result = yield* Effect.promise(() =>
				call(listArtifactVersionsProcedure, { artifactId }, { context: context() }),
			)

			expect(result.latest).toEqual({
				kind: 'latest',
				id: 'latest',
				label: 'Latest',
				contentHash: hash('latest content'),
				createdAt: 3000,
			})
			expect(result.archived.map((version) => version.versionNumber)).toEqual([2, 1])
			expect(result.archived.map((version) => version.label)).toEqual(['Version 2', 'Version 1'])
			expect('content' in result.latest).toBe(false)
			expect(result.archived.every((version) => !('content' in version))).toBe(true)
		}),
	)

	it.effect('gets one authorized archived version with exact content', () =>
		Effect.gen(function* () {
			const result = yield* Effect.promise(() =>
				call(
					getArtifactVersionProcedure,
					{ artifactId, versionId: oldestVersionId },
					{ context: context(readerUserId) },
				),
			)

			expect(result).toMatchObject({
				kind: 'archived',
				label: 'Version 1',
				versionNumber: 1,
				content: 'version one content',
				contentHash: hash('version one content'),
			})
		}),
	)

	it.effect('rejects missing, deleted, and unauthorized parent artifacts', () =>
		Effect.promise(async () => {
			await expect(
				call(listArtifactVersionsProcedure, { artifactId: randomUUID() }, { context: context() }),
			).rejects.toMatchObject({ code: 'NOT_FOUND' })
			await expect(
				call(listArtifactVersionsProcedure, { artifactId: deletedArtifactId }, { context: context() }),
			).rejects.toMatchObject({ code: 'NOT_FOUND' })
			await expect(
				call(listArtifactVersionsProcedure, { artifactId }, { context: context(strangerUserId) }),
			).rejects.toMatchObject({ code: 'NOT_FOUND' })
		}),
	)

	it.effect('rejects cross-artifact version ids and missing versions', () =>
		Effect.promise(async () => {
			await expect(
				call(
					getArtifactVersionProcedure,
					{ artifactId, versionId: crossArtifactVersionId },
					{ context: context() },
				),
			).rejects.toMatchObject({ code: 'NOT_FOUND' })
			await expect(
				call(getArtifactVersionProcedure, { artifactId, versionId: randomUUID() }, { context: context() }),
			).rejects.toMatchObject({ code: 'NOT_FOUND' })
		}),
	)

	it.effect('hides artifacts and versions across organization boundaries', () =>
		Effect.promise(async () => {
			await expect(
				call(listArtifactVersionsProcedure, { artifactId: otherArtifactId }, { context: context() }),
			).rejects.toMatchObject({ code: 'NOT_FOUND' })
			await expect(
				call(
					getArtifactVersionProcedure,
					{ artifactId, versionId: oldestVersionId },
					{ context: context(ownerUserId, otherOrganizationId) },
				),
			).rejects.toMatchObject({ code: 'NOT_FOUND' })
		}),
	)
})
