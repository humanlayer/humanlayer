import { tmpdir } from 'node:os'

import { organizations } from '@humanlayer/db/tables/organizations'
import { taskUserAcl } from '@humanlayer/db/tables/task-user-acl'
import { tasks } from '@humanlayer/db/tables/tasks'
import { call } from '@orpc/server'
import { and, eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { updateUserSharingProcedure as liveUpdateUserSharingProcedure } from '../../src/orpc/api/sharing/user/update.effect'
import { createMockApiAuth, createMockApiContext } from '../mocks'
import { bindProcedureToRuntime, createRuntimeWithTestPostgresLayer } from '../utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

/**
 * User Sharing Tests - Three-Actor Pattern
 *
 * Tests verify:
 * - Owner can grant/update/revoke user permissions
 * - Stranger cannot manage user permissions
 * - ACL-holder with edit cannot manage other users' permissions
 * - DB state verification for all mutations
 */
describe('User Sharing - Three-Actor Pattern', async () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let effectRuntime: ReturnType<typeof createRuntimeWithTestPostgresLayer> | undefined
	let updateUserSharingProcedure: typeof liveUpdateUserSharingProcedure

	let organizationId: string
	const workosOrganizationId = 'org_abc123'

	// Three actors
	const ownerUserId = 'user_owner_123'
	const aclHolderUserId = 'user_acl_holder_456'
	const strangerUserId = 'user_stranger_789'
	const targetUserId = 'user_target_999' // User to share with

	beforeAll(async () => {
		const testDb = await createTestDb('user_sharing')
		cleanupTestDb = testDb.cleanup
		db = testDb.db
		effectRuntime = createRuntimeWithTestPostgresLayer(db)
		updateUserSharingProcedure = bindProcedureToRuntime(liveUpdateUserSharingProcedure, effectRuntime)

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

	describe('sharing.user.update - grant permissions', () => {
		test('Owner can grant user read permission and DB reflects changes', async () => {
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'task for read grant',
					resource_owner_user_id: ownerUserId,
					created_by: ownerUserId,
					default_working_directory: tmpdir(),
					setup_status: 'completed',
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			const result = await call(
				updateUserSharingProcedure,
				{ taskId: task.id, subjectUserId: targetUserId, permissionLevel: 'read' },
				{
					context: createMockApiContext({
						auth: createMockApiAuth({ userId: ownerUserId, organizationId, workosOrganizationId }),
						services: { db, dbReadReplica: db },
					}),
				},
			)

			expect(result.acl).toBeDefined()
			expect(result.acl?.permission_level).toBe('read')
			expect(result.acl?.subject_user_id).toBe(targetUserId)

			// Verify DB state
			const [dbAcl] = await db
				.select()
				.from(taskUserAcl)
				.where(
					and(
						eq(taskUserAcl.task_id, task.id),
						eq(taskUserAcl.subject_user_id, targetUserId),
						eq(taskUserAcl.organization_id, organizationId),
					),
				)
				.limit(1)

			expect(dbAcl?.permission_level).toBe('read')
			expect(dbAcl?.granted_by).toBe(ownerUserId)
		})

		test('Owner can grant user edit permission and DB reflects changes', async () => {
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'task for edit grant',
					resource_owner_user_id: ownerUserId,
					created_by: ownerUserId,
					default_working_directory: tmpdir(),
					setup_status: 'completed',
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			const result = await call(
				updateUserSharingProcedure,
				{ taskId: task.id, subjectUserId: targetUserId, permissionLevel: 'edit' },
				{
					context: createMockApiContext({
						auth: createMockApiAuth({ userId: ownerUserId, organizationId, workosOrganizationId }),
						services: { db, dbReadReplica: db },
					}),
				},
			)

			expect(result.acl).toBeDefined()
			expect(result.acl?.permission_level).toBe('edit')
			expect(result.acl?.subject_user_id).toBe(targetUserId)

			// Verify DB state
			const [dbAcl] = await db
				.select()
				.from(taskUserAcl)
				.where(
					and(
						eq(taskUserAcl.task_id, task.id),
						eq(taskUserAcl.subject_user_id, targetUserId),
						eq(taskUserAcl.organization_id, organizationId),
					),
				)
				.limit(1)

			expect(dbAcl?.permission_level).toBe('edit')
			expect(dbAcl?.granted_by).toBe(ownerUserId)
		})
	})

	describe('sharing.user.update - update permissions', () => {
		test('Owner can update user permission from read to edit and DB reflects changes', async () => {
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'task for permission update',
					resource_owner_user_id: ownerUserId,
					created_by: ownerUserId,
					default_working_directory: tmpdir(),
					setup_status: 'completed',
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			// First, grant read permission
			await db.insert(taskUserAcl).values({
				organization_id: organizationId,
				subject_user_id: targetUserId,
				task_id: task.id,
				resource_owner_user_id: ownerUserId,
				permission_level: 'read',
				granted_by: ownerUserId,
			})

			// Update to edit permission
			const result = await call(
				updateUserSharingProcedure,
				{ taskId: task.id, subjectUserId: targetUserId, permissionLevel: 'edit' },
				{
					context: createMockApiContext({
						auth: createMockApiAuth({ userId: ownerUserId, organizationId, workosOrganizationId }),
						services: { db, dbReadReplica: db },
					}),
				},
			)

			expect(result.acl?.permission_level).toBe('edit')

			// Verify DB state - should have edit permission now
			const [dbAcl] = await db
				.select()
				.from(taskUserAcl)
				.where(
					and(
						eq(taskUserAcl.task_id, task.id),
						eq(taskUserAcl.subject_user_id, targetUserId),
						eq(taskUserAcl.organization_id, organizationId),
					),
				)
				.limit(1)

			expect(dbAcl?.permission_level).toBe('edit')
		})

		test('Idempotency: granting same permission twice succeeds with one ACL entry', async () => {
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'task for idempotency test',
					resource_owner_user_id: ownerUserId,
					created_by: ownerUserId,
					default_working_directory: tmpdir(),
					setup_status: 'completed',
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			// Grant read permission first time
			await call(
				updateUserSharingProcedure,
				{ taskId: task.id, subjectUserId: targetUserId, permissionLevel: 'read' },
				{
					context: createMockApiContext({
						auth: createMockApiAuth({ userId: ownerUserId, organizationId, workosOrganizationId }),
						services: { db, dbReadReplica: db },
					}),
				},
			)

			// Grant read permission second time (should upsert, not error)
			const result = await call(
				updateUserSharingProcedure,
				{ taskId: task.id, subjectUserId: targetUserId, permissionLevel: 'read' },
				{
					context: createMockApiContext({
						auth: createMockApiAuth({ userId: ownerUserId, organizationId, workosOrganizationId }),
						services: { db, dbReadReplica: db },
					}),
				},
			)

			expect(result.acl?.permission_level).toBe('read')

			// Verify only one ACL entry exists
			const dbAcls = await db
				.select()
				.from(taskUserAcl)
				.where(
					and(
						eq(taskUserAcl.task_id, task.id),
						eq(taskUserAcl.subject_user_id, targetUserId),
						eq(taskUserAcl.organization_id, organizationId),
					),
				)

			expect(dbAcls.length).toBe(1)
		})
	})

	describe('sharing.user.update - revoke permissions', () => {
		test('Owner can revoke user permission (null) and ACL is deleted from DB', async () => {
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'task for revoke',
					resource_owner_user_id: ownerUserId,
					created_by: ownerUserId,
					default_working_directory: tmpdir(),
					setup_status: 'completed',
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			// First, grant read permission
			await db.insert(taskUserAcl).values({
				organization_id: organizationId,
				subject_user_id: targetUserId,
				task_id: task.id,
				resource_owner_user_id: ownerUserId,
				permission_level: 'read',
				granted_by: ownerUserId,
			})

			// Revoke permission (set to null)
			const result = await call(
				updateUserSharingProcedure,
				{ taskId: task.id, subjectUserId: targetUserId, permissionLevel: null },
				{
					context: createMockApiContext({
						auth: createMockApiAuth({ userId: ownerUserId, organizationId, workosOrganizationId }),
						services: { db, dbReadReplica: db },
					}),
				},
			)

			expect(result.acl).toBeNull()

			// Verify ACL is deleted from DB
			const [dbAcl] = await db
				.select()
				.from(taskUserAcl)
				.where(
					and(
						eq(taskUserAcl.task_id, task.id),
						eq(taskUserAcl.subject_user_id, targetUserId),
						eq(taskUserAcl.organization_id, organizationId),
					),
				)
				.limit(1)

			expect(dbAcl).toBeUndefined()
		})
	})

	describe('sharing.user.update - authorization failures', () => {
		test('Stranger cannot manage user permissions (gets FORBIDDEN) and DB is unchanged', async () => {
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'task for stranger test',
					resource_owner_user_id: ownerUserId,
					created_by: ownerUserId,
					default_working_directory: tmpdir(),
					setup_status: 'completed',
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			// Stranger tries to grant permission
			await expect(
				call(
					updateUserSharingProcedure,
					{ taskId: task.id, subjectUserId: targetUserId, permissionLevel: 'read' },
					{
						context: createMockApiContext({
							auth: createMockApiAuth({ userId: strangerUserId, organizationId, workosOrganizationId }),
							services: { db, dbReadReplica: db },
						}),
					},
				),
			).rejects.toThrow()

			// Verify no ACL was created
			const dbAcls = await db
				.select()
				.from(taskUserAcl)
				.where(
					and(
						eq(taskUserAcl.task_id, task.id),
						eq(taskUserAcl.subject_user_id, targetUserId),
						eq(taskUserAcl.organization_id, organizationId),
					),
				)

			expect(dbAcls.length).toBe(0)
		})

		test('ACL-holder with edit cannot manage other users permissions (gets FORBIDDEN)', async () => {
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'task for acl holder test',
					resource_owner_user_id: ownerUserId,
					created_by: ownerUserId,
					default_working_directory: tmpdir(),
					setup_status: 'completed',
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			// Grant edit ACL to aclHolderUserId
			await db.insert(taskUserAcl).values({
				organization_id: organizationId,
				subject_user_id: aclHolderUserId,
				task_id: task.id,
				resource_owner_user_id: ownerUserId,
				permission_level: 'edit',
				granted_by: ownerUserId,
			})

			// ACL holder tries to grant permission to another user
			await expect(
				call(
					updateUserSharingProcedure,
					{ taskId: task.id, subjectUserId: targetUserId, permissionLevel: 'read' },
					{
						context: createMockApiContext({
							auth: createMockApiAuth({ userId: aclHolderUserId, organizationId, workosOrganizationId }),
							services: { db, dbReadReplica: db },
						}),
					},
				),
			).rejects.toThrow()

			// Verify no ACL was created for targetUserId
			const dbAcls = await db
				.select()
				.from(taskUserAcl)
				.where(
					and(
						eq(taskUserAcl.task_id, task.id),
						eq(taskUserAcl.subject_user_id, targetUserId),
						eq(taskUserAcl.organization_id, organizationId),
					),
				)

			expect(dbAcls.length).toBe(0)
		})
	})

	afterAll(async () => {
		await effectRuntime?.dispose()
		await cleanupTestDb?.()
	}, 30000)
})
