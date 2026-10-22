import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'

import { artifacts } from '@humanlayer/db/tables/artifacts'
import { organizationSettings } from '@humanlayer/db/tables/organization-settings'
import { organizations } from '@humanlayer/db/tables/organizations'
import { taskOrganizationAcl } from '@humanlayer/db/tables/task-organization-acl'
import { tasks } from '@humanlayer/db/tables/tasks'
import { call } from '@orpc/server'
import { and, eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { Effect, Layer } from 'effect'
import { hash } from 'ohash'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { WorkosService } from '../../src/effects/services/workos/workos.service'
import { resolveSharedArtifactProcedure as liveResolveSharedArtifactProcedure } from '../../src/orpc/api/public/artifacts/resolve.effect'
import { createMockApiAuth, createMockApiContext } from '../mocks'
import {
	bindProcedureToRuntime,
	createRuntimeWithTestPostgresLayer,
	makeTestWorkosService,
} from '../utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('shared artifact resolver', () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let runtime: ReturnType<typeof createRuntimeWithTestPostgresLayer>
	let procedure: typeof liveResolveSharedArtifactProcedure
	let organizationId: string
	let otherOrganizationId: string
	let taskId: string
	let artifactId: string
	const shareKey = randomUUID()
	const ownerId = 'shared-resolver-owner'
	const viewerId = 'shared-resolver-viewer'
	const targetWorkosOrganizationId = 'workos-shared-resolver-target'

	beforeAll(async () => {
		const testDb = await createTestDb('shared_artifact_resolve')
		cleanupTestDb = testDb.cleanup
		db = testDb.db

		const [organization, otherOrganization] = await db
			.insert(organizations)
			.values([
				{ name: 'Shared resolver target', workos_organization_id: targetWorkosOrganizationId },
				{ name: 'Shared resolver other', workos_organization_id: 'workos-shared-resolver-other' },
			])
			.returning()
		if (!organization || !otherOrganization) throw new Error('Could not seed organizations')
		organizationId = organization.id
		otherOrganizationId = otherOrganization.id

		const [task] = await db
			.insert(tasks)
			.values({
				organization_id: organizationId,
				name: 'Shared resolver task',
				resource_owner_user_id: ownerId,
				created_by: ownerId,
				default_working_directory: tmpdir(),
				setup_status: 'completed',
			})
			.returning()
		if (!task) throw new Error('Could not seed task')
		taskId = task.id

		await db.insert(taskOrganizationAcl).values({
			task_id: taskId,
			organization_id: organizationId,
			resource_owner_user_id: ownerId,
			permission_level: 'read',
			granted_by: ownerId,
		})

		const content = '# Shared resolver artifact'
		const [artifact] = await db
			.insert(artifacts)
			.values({
				task_id: taskId,
				organization_id: organizationId,
				resource_owner_user_id: ownerId,
				created_by: ownerId,
				file_name: 'shared-resolver.md',
				content,
				content_hash: hash(content),
				share_key: shareKey,
				share_enabled: true,
				public_permission: 'view',
			})
			.returning()
		if (!artifact) throw new Error('Could not seed artifact')
		artifactId = artifact.id

		const workos = Layer.succeed(
			WorkosService,
			makeTestWorkosService({
				listActiveOrganizationMemberships: ({ userId, organizationId: workosOrganizationId }) =>
					Effect.succeed(
						userId === viewerId && workosOrganizationId === targetWorkosOrganizationId
							? [{ userId, organizationId: workosOrganizationId }]
							: [],
					),
			}),
		)
		runtime = createRuntimeWithTestPostgresLayer(db, { workos })
		procedure = bindProcedureToRuntime(liveResolveSharedArtifactProcedure, runtime)
	}, 60_000)

	afterAll(async () => {
		await runtime?.dispose()
		await cleanupTestDb?.()
	}, 30_000)

	const context = (auth: ReturnType<typeof createMockApiAuth> | null) =>
		createMockApiContext({ auth, services: { db, dbReadReplica: db } })

	test('prefers ordinary access in the current organization over the capability', async () => {
		const result = await call(
			procedure,
			{ artifactId, shareKey },
			{
				context: context(
					createMockApiAuth({
						userId: viewerId,
						organizationId,
						workosOrganizationId: targetWorkosOrganizationId,
					}),
				),
			},
		)
		expect(result).toEqual({ kind: 'authenticated', taskId, artifactId })
	})

	test('returns an organization switch only after membership and task access pass', async () => {
		const result = await call(
			procedure,
			{ artifactId, shareKey },
			{
				context: context(
					createMockApiAuth({
						userId: viewerId,
						organizationId: otherOrganizationId,
						workosOrganizationId: 'workos-shared-resolver-other',
					}),
				),
			},
		)
		expect(result).toEqual({
			kind: 'switch_organization',
			workosOrganizationId: targetWorkosOrganizationId,
			taskId,
			artifactId,
		})
	})

	test('falls back to capability access for anonymous and non-member viewers', async () => {
		await expect(call(procedure, { artifactId, shareKey }, { context: context(null) })).resolves.toEqual({
			kind: 'public',
			permission: 'view',
		})

		const result = await call(
			procedure,
			{ artifactId, shareKey },
			{
				context: context(
					createMockApiAuth({
						userId: 'non-member',
						organizationId: otherOrganizationId,
						workosOrganizationId: 'workos-shared-resolver-other',
					}),
				),
			},
		)
		expect(result).toEqual({ kind: 'public', permission: 'view' })
	})

	test('returns unavailable to anonymous viewers while the org disallows public links', async () => {
		// Leave the artifact row shared so only the org policy can deny access.
		await db
			.insert(organizationSettings)
			.values({ organization_id: organizationId, enable_creating_publicly_shareable_links: false })
		try {
			await expect(call(procedure, { artifactId, shareKey }, { context: context(null) })).resolves.toEqual({
				kind: 'unavailable',
			})
		} finally {
			await db.delete(organizationSettings).where(eq(organizationSettings.organization_id, organizationId))
		}
	})

	test('returns the same unavailable result for missing, wrong-key, and revoked artifacts', async () => {
		await expect(call(procedure, { artifactId }, { context: context(null) })).resolves.toEqual({
			kind: 'unavailable',
		})
		await expect(
			call(procedure, { artifactId, shareKey: 'wrong-key' }, { context: context(null) }),
		).resolves.toEqual({
			kind: 'unavailable',
		})
		await expect(
			call(procedure, { artifactId: randomUUID(), shareKey }, { context: context(null) }),
		).resolves.toEqual({ kind: 'unavailable' })

		await db
			.update(artifacts)
			.set({ share_enabled: false, public_permission: 'off' })
			.where(and(eq(artifacts.id, artifactId)))
		await expect(call(procedure, { artifactId, shareKey }, { context: context(null) })).resolves.toEqual({
			kind: 'unavailable',
		})
	})
})
