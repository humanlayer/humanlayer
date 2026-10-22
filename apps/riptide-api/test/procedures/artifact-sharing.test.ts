import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'

import { artifacts } from '@humanlayer/db/tables/artifacts'
import { organizations } from '@humanlayer/db/tables/organizations'
import { taskUserAcl } from '@humanlayer/db/tables/task-user-acl'
import { tasks } from '@humanlayer/db/tables/tasks'
import { call, isDefinedError } from '@orpc/server'
import { eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { hash } from 'ohash'
import { uuidv7 } from 'uuidv7'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { setOrgSettingsEffectProcedure as liveSetOrgSettingsProcedure } from '../../src/orpc/api/auth/admin/organizations-settings-set.effect'
import { updateArtifactSharingProcedure as liveUpdateArtifactSharingProcedure } from '../../src/orpc/api/sharing/artifact/update.effect'
import { createMockApiAuth, createMockApiContext } from '../mocks'
import { bindProcedureToRuntime, createRuntimeWithTestPostgresLayer } from '../utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('Sharing - Artifact Share Link', async () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let effectRuntime: ReturnType<typeof createRuntimeWithTestPostgresLayer> | undefined
	let setOrgSettingsProcedure!: typeof liveSetOrgSettingsProcedure
	let updateArtifactSharingProcedure: typeof liveUpdateArtifactSharingProcedure
	let organizationId: string
	const workosOrganizationId = 'org_artifact_sharing_test'
	const ownerUserId = 'user_owner_artifact_sharing'
	const strangerUserId = 'user_stranger_artifact_sharing'

	beforeAll(async () => {
		const testDb = await createTestDb('artifact_sharing')
		cleanupTestDb = testDb.cleanup
		db = testDb.db
		effectRuntime = createRuntimeWithTestPostgresLayer(db)
		setOrgSettingsProcedure = bindProcedureToRuntime(liveSetOrgSettingsProcedure, effectRuntime)
		updateArtifactSharingProcedure = bindProcedureToRuntime(liveUpdateArtifactSharingProcedure, effectRuntime)

		const [org] = await db
			.insert(organizations)
			.values({
				name: 'artifact sharing test org',
				workos_organization_id: workosOrganizationId,
			})
			.returning()

		if (!org) throw new Error('Unable to insert organization')
		organizationId = org.id
	}, 30000)

	const createOwnerContext = () =>
		createMockApiContext({
			auth: createMockApiAuth({ userId: ownerUserId, organizationId, workosOrganizationId }),
			services: { db, dbReadReplica: db },
		})

	const createStrangerContext = () =>
		createMockApiContext({
			auth: createMockApiAuth({ userId: strangerUserId, organizationId, workosOrganizationId }),
			services: { db, dbReadReplica: db },
		})

	// Helper to create a task and artifact owned by ownerUserId
	async function seedArtifact() {
		const [task] = await db
			.insert(tasks)
			.values({
				organization_id: organizationId,
				name: `sharing test task ${randomUUID().slice(0, 8)}`,
				resource_owner_user_id: ownerUserId,
				created_by: ownerUserId,
				default_working_directory: tmpdir(),
				setup_status: 'completed',
			})
			.returning()
		if (!task) throw new Error('Failed to create task')

		const content = `test content ${randomUUID()}`
		const [artifact] = await db
			.insert(artifacts)
			.values({
				task_id: task.id,
				file_name: `test-${randomUUID().slice(0, 8)}.md`,
				content,
				content_hash: hash(content),
				resource_owner_user_id: ownerUserId,
				organization_id: organizationId,
				created_by: ownerUserId,
			})
			.returning()
		if (!artifact) throw new Error('Failed to create artifact')

		return { task, artifact }
	}

	describe('Authorization', () => {
		test('Owner can enable share link', async () => {
			const { artifact } = await seedArtifact()

			const result = await call(
				updateArtifactSharingProcedure,
				{ artifactId: artifact.id, enabled: true },
				{ context: createOwnerContext() },
			)

			expect(result.shareKey).not.toBeNull()
			expect(result.shareKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
			expect(result.transactionId).toBeDefined()

			// Verify DB state
			const [dbArtifact] = await db.select().from(artifacts).where(eq(artifacts.id, artifact.id)).limit(1)
			expect(dbArtifact?.share_enabled).toBe(true)
			expect(dbArtifact?.public_permission).toBe('view')
			expect(dbArtifact?.share_key).toBe(result.shareKey)
			expect(dbArtifact?.shared_by).toBe(ownerUserId)
		})

		test('Owner can disable share link', async () => {
			const { artifact } = await seedArtifact()

			// Enable first
			const enableResult = await call(
				updateArtifactSharingProcedure,
				{ artifactId: artifact.id, enabled: true },
				{ context: createOwnerContext() },
			)

			// Disable
			const result = await call(
				updateArtifactSharingProcedure,
				{ artifactId: artifact.id, enabled: false },
				{ context: createOwnerContext() },
			)

			expect(result.transactionId).toBeDefined()

			// Verify DB: share_enabled = false but share_key and shared_by preserved
			const [dbArtifact] = await db.select().from(artifacts).where(eq(artifacts.id, artifact.id)).limit(1)
			expect(dbArtifact?.share_enabled).toBe(false)
			expect(dbArtifact?.public_permission).toBe('off')
			expect(dbArtifact?.share_key).toBe(enableResult.shareKey)
			expect(dbArtifact?.shared_by).toBe(ownerUserId)
		})

		test('Re-enabling returns same key', async () => {
			const { artifact } = await seedArtifact()

			const first = await call(
				updateArtifactSharingProcedure,
				{ artifactId: artifact.id, enabled: true },
				{ context: createOwnerContext() },
			)

			await call(
				updateArtifactSharingProcedure,
				{ artifactId: artifact.id, enabled: false },
				{ context: createOwnerContext() },
			)

			const second = await call(
				updateArtifactSharingProcedure,
				{ artifactId: artifact.id, enabled: true },
				{ context: createOwnerContext() },
			)

			expect(second.shareKey).toBe(first.shareKey)
		})

		test('Task editor can change public access', async () => {
			const { task, artifact } = await seedArtifact()
			await db.insert(taskUserAcl).values({
				task_id: task.id,
				subject_user_id: strangerUserId,
				organization_id: organizationId,
				resource_owner_user_id: ownerUserId,
				permission_level: 'edit',
				granted_by: ownerUserId,
			})

			const result = await call(
				updateArtifactSharingProcedure,
				{ artifactId: artifact.id, permission: 'view' },
				{ context: createStrangerContext() },
			)

			expect(result.permission).toBe('view')
			const [dbArtifact] = await db.select().from(artifacts).where(eq(artifacts.id, artifact.id)).limit(1)
			expect(dbArtifact?.public_permission).toBe('view')
			expect(dbArtifact?.share_enabled).toBe(true)
		})

		test('Non-editor gets FORBIDDEN', async () => {
			const { task, artifact } = await seedArtifact()
			await db.insert(taskUserAcl).values({
				task_id: task.id,
				subject_user_id: strangerUserId,
				organization_id: organizationId,
				resource_owner_user_id: ownerUserId,
				permission_level: 'read',
				granted_by: ownerUserId,
			})

			try {
				await call(
					updateArtifactSharingProcedure,
					{ artifactId: artifact.id, enabled: true },
					{ context: createStrangerContext() },
				)
				expect.unreachable('Should have thrown')
			} catch (err) {
				const error = err as any
				expect(isDefinedError(error)).toBe(true)
				expect(error.code).toBe('FORBIDDEN')
			}
		})

		test('permission off and view keep compatibility fields aligned', async () => {
			const { artifact } = await seedArtifact()

			const enabled = await call(
				updateArtifactSharingProcedure,
				{ artifactId: artifact.id, permission: 'view' },
				{ context: createOwnerContext() },
			)
			expect(enabled.permission).toBe('view')

			const disabled = await call(
				updateArtifactSharingProcedure,
				{ artifactId: artifact.id, permission: 'off' },
				{ context: createOwnerContext() },
			)
			expect(disabled.permission).toBe('off')
			expect(disabled.shareKey).toBe(enabled.shareKey)

			const [dbArtifact] = await db.select().from(artifacts).where(eq(artifacts.id, artifact.id)).limit(1)
			expect(dbArtifact).toMatchObject({ public_permission: 'off', share_enabled: false })
		})

		test('enables comment permission', async () => {
			const { artifact } = await seedArtifact()

			const response = await call(
				updateArtifactSharingProcedure,
				{ artifactId: artifact.id, permission: 'comment' },
				{ context: createOwnerContext() },
			)
			expect(response).toMatchObject({ permission: 'comment' })

			const [dbArtifact] = await db.select().from(artifacts).where(eq(artifacts.id, artifact.id)).limit(1)
			expect(dbArtifact).toMatchObject({ public_permission: 'comment', share_enabled: true })
		})

		test('Non-existent artifact returns NOT_FOUND', async () => {
			try {
				await call(
					updateArtifactSharingProcedure,
					{ artifactId: uuidv7(), enabled: true },
					{ context: createOwnerContext() },
				)
				expect.unreachable('Should have thrown')
			} catch (err) {
				const error = err as any
				expect(isDefinedError(error)).toBe(true)
				expect(error.code).toBe('NOT_FOUND')
			}
		})
	})

	describe('Idempotency', () => {
		test('Enabling when already enabled is idempotent', async () => {
			const { artifact } = await seedArtifact()

			const first = await call(
				updateArtifactSharingProcedure,
				{ artifactId: artifact.id, enabled: true },
				{ context: createOwnerContext() },
			)

			const second = await call(
				updateArtifactSharingProcedure,
				{ artifactId: artifact.id, enabled: true },
				{ context: createOwnerContext() },
			)

			expect(second.shareKey).toBe(first.shareKey)
		})

		test('Disabling when not shared succeeds', async () => {
			const { artifact } = await seedArtifact()

			const result = await call(
				updateArtifactSharingProcedure,
				{ artifactId: artifact.id, enabled: false },
				{ context: createOwnerContext() },
			)

			expect(result.transactionId).toBeDefined()
			expect(result.shareKey).toBeNull()
		})
	})

	describe('Org setting enforcement', () => {
		// Each test in this block uses its own isolated org to avoid state pollution
		// with the shared organizationId used by Authorization/Idempotency tests.
		const createIsolatedOrg = async () => {
			const isolatedOrgId = randomUUID()
			const [org] = await db
				.insert(organizations)
				.values({
					name: `Isolated Org ${isolatedOrgId}`,
					workos_organization_id: `workos-isolated-${isolatedOrgId}`,
				})
				.returning()
			if (!org) throw new Error('Failed to create isolated org')
			return org.id
		}

		const createIsolatedOwnerContext = (isolatedOrgId: string) =>
			createMockApiContext({
				auth: createMockApiAuth({
					userId: ownerUserId,
					organizationId: isolatedOrgId,
					workosOrganizationId: `workos-isolated-${isolatedOrgId}`,
				}),
				services: { db, dbReadReplica: db },
			})

		const createIsolatedAdminContext = (isolatedOrgId: string) =>
			createMockApiContext({
				auth: createMockApiAuth({
					userId: ownerUserId,
					organizationId: isolatedOrgId,
					workosOrganizationId: `workos-isolated-${isolatedOrgId}`,
					role: 'admin',
					roles: ['admin'],
				}),
				services: { db, dbReadReplica: db },
			})

		const seedIsolatedArtifact = async (isolatedOrgId: string) => {
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: isolatedOrgId,
					name: `enforcement test task ${randomUUID().slice(0, 8)}`,
					resource_owner_user_id: ownerUserId,
					created_by: ownerUserId,
					default_working_directory: tmpdir(),
					setup_status: 'completed',
				})
				.returning()
			if (!task) throw new Error('Failed to create task')

			const content = `enforcement test content ${randomUUID()}`
			const [artifact] = await db
				.insert(artifacts)
				.values({
					task_id: task.id,
					file_name: `enforcement-test-${randomUUID().slice(0, 8)}.md`,
					content,
					content_hash: hash(content),
					resource_owner_user_id: ownerUserId,
					organization_id: isolatedOrgId,
					created_by: ownerUserId,
				})
				.returning()
			if (!artifact) throw new Error('Failed to create artifact')
			return { task, artifact }
		}

		test('enabled=true returns FEATURE_DISABLED_BY_ORG when org setting is off', async () => {
			const isolatedOrgId = await createIsolatedOrg()
			const { artifact } = await seedIsolatedArtifact(isolatedOrgId)

			// Disable org setting for this isolated org
			await call(
				setOrgSettingsProcedure,
				{ enableCreatingPubliclyShareableLinks: false },
				{ context: createIsolatedAdminContext(isolatedOrgId) },
			)

			try {
				await call(
					updateArtifactSharingProcedure,
					{ artifactId: artifact.id, enabled: true },
					{ context: createIsolatedOwnerContext(isolatedOrgId) },
				)
				expect.unreachable('Should have thrown FEATURE_DISABLED_BY_ORG')
			} catch (err) {
				const error = err as any
				expect(isDefinedError(error)).toBe(true)
				expect(error.code).toBe('FEATURE_DISABLED_BY_ORG')
			}
		})

		test('enabled=false returns FEATURE_DISABLED_BY_ORG when org setting is off', async () => {
			const isolatedOrgId = await createIsolatedOrg()
			const { artifact } = await seedIsolatedArtifact(isolatedOrgId)

			// Disable org setting for this isolated org
			await call(
				setOrgSettingsProcedure,
				{ enableCreatingPubliclyShareableLinks: false },
				{ context: createIsolatedAdminContext(isolatedOrgId) },
			)

			try {
				await call(
					updateArtifactSharingProcedure,
					{ artifactId: artifact.id, enabled: false },
					{ context: createIsolatedOwnerContext(isolatedOrgId) },
				)
				expect.unreachable('Should have thrown FEATURE_DISABLED_BY_ORG')
			} catch (err) {
				const error = err as any
				expect(isDefinedError(error)).toBe(true)
				expect(error.code).toBe('FEATURE_DISABLED_BY_ORG')
			}
		})

		test.each(['view', 'comment'] as const)(
			'permission=%s returns FEATURE_DISABLED_BY_ORG when org setting is off',
			async (permission) => {
				const isolatedOrgId = await createIsolatedOrg()
				const { artifact } = await seedIsolatedArtifact(isolatedOrgId)

				await call(
					setOrgSettingsProcedure,
					{ enableCreatingPubliclyShareableLinks: false },
					{ context: createIsolatedAdminContext(isolatedOrgId) },
				)

				try {
					await call(
						updateArtifactSharingProcedure,
						{ artifactId: artifact.id, permission },
						{ context: createIsolatedOwnerContext(isolatedOrgId) },
					)
					expect.unreachable('Should have thrown FEATURE_DISABLED_BY_ORG')
				} catch (err) {
					const error = err as any
					expect(isDefinedError(error)).toBe(true)
					expect(error.code).toBe('FEATURE_DISABLED_BY_ORG')
				}
				const [row] = await db.select().from(artifacts).where(eq(artifacts.id, artifact.id)).limit(1)
				expect(row?.share_enabled).toBe(false)
				expect(row?.public_permission).toBe('off')
			},
		)

		test('admin toggle-off bulk revokes existing enabled artifact links', async () => {
			const isolatedOrgId = await createIsolatedOrg()
			const { artifact: artifact1 } = await seedIsolatedArtifact(isolatedOrgId)
			const { artifact: artifact2 } = await seedIsolatedArtifact(isolatedOrgId)

			// Enable sharing on both artifacts
			await call(
				updateArtifactSharingProcedure,
				{ artifactId: artifact1.id, enabled: true },
				{ context: createIsolatedOwnerContext(isolatedOrgId) },
			)
			await call(
				updateArtifactSharingProcedure,
				{ artifactId: artifact2.id, enabled: true },
				{ context: createIsolatedOwnerContext(isolatedOrgId) },
			)

			// Verify both are enabled
			const [db1Before] = await db.select().from(artifacts).where(eq(artifacts.id, artifact1.id)).limit(1)
			const [db2Before] = await db.select().from(artifacts).where(eq(artifacts.id, artifact2.id)).limit(1)
			expect(db1Before?.share_enabled).toBe(true)
			expect(db2Before?.share_enabled).toBe(true)

			// Admin disables org setting — should revoke all links in the same transaction
			await call(
				setOrgSettingsProcedure,
				{ enableCreatingPubliclyShareableLinks: false },
				{ context: createIsolatedAdminContext(isolatedOrgId) },
			)

			// Both artifacts should now have share_enabled = false
			const [db1After] = await db.select().from(artifacts).where(eq(artifacts.id, artifact1.id)).limit(1)
			const [db2After] = await db.select().from(artifacts).where(eq(artifacts.id, artifact2.id)).limit(1)
			expect(db1After?.share_enabled).toBe(false)
			expect(db2After?.share_enabled).toBe(false)
			expect(db1After?.public_permission).toBe('off')
			expect(db2After?.public_permission).toBe('off')
		})
	})

	afterAll(async () => {
		await effectRuntime?.dispose()
		await cleanupTestDb?.()
	}, 30000)
})
