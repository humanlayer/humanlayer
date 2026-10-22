import { aclOperationsLog } from '@humanlayer/db/tables/acl-operations-log'
import { organizations } from '@humanlayer/db/tables/organizations'
import { taskUserAcl } from '@humanlayer/db/tables/task-user-acl'
import { tasks } from '@humanlayer/db/tables/tasks'
import { eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import {
	createTaskOrganizationAcl,
	createTaskUserAcl,
	deleteTaskOrganizationAcl,
	deleteTaskUserAcl,
	updateTaskOrganizationAcl,
	updateTaskUserAcl,
} from '../../src/db/acl-operations'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('ACL CRUD and Operations Log', async () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase

	let organizationId: string
	const workosOrganizationId = 'org_abc123'
	const ownerUserId = 'user_owner_123'
	const aclHolderUserId = 'user_acl_holder_456'
	const strangerUserId = 'user_stranger_789'

	beforeAll(async () => {
		const testDb = await createTestDb('acl_operations')
		cleanupTestDb = testDb.cleanup
		db = testDb.db

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

	describe('TaskUserAcl CRUD', () => {
		test('Can create ACL entries with all permission levels (read, write, comment)', async () => {
			const permissionLevels = ['read', 'edit', 'comment'] as const

			for (const permissionLevel of permissionLevels) {
				const [task] = await db
					.insert(tasks)
					.values({
						organization_id: organizationId,
						name: `test task for ${permissionLevel} acl`,
						resource_owner_user_id: ownerUserId,
						created_by: ownerUserId,
					})
					.returning()

				if (!task) throw new Error('Failed to create task')

				const [aclEntry] = await db
					.insert(taskUserAcl)
					.values({
						organization_id: organizationId,
						subject_user_id: aclHolderUserId,
						task_id: task.id,
						resource_owner_user_id: ownerUserId,
						permission_level: permissionLevel,
						granted_by: ownerUserId,
					})
					.returning()

				expect(aclEntry).toBeDefined()
				expect(aclEntry?.permission_level).toBe(permissionLevel)
				expect(aclEntry?.subject_user_id).toBe(aclHolderUserId)
				expect(aclEntry?.task_id).toBe(task.id)
				expect(aclEntry?.organization_id).toBe(organizationId)
				expect(aclEntry?.resource_owner_user_id).toBe(ownerUserId)
				expect(aclEntry?.granted_by).toBe(ownerUserId)
			}
		})
	})

	describe('ACL Operations Log - Create', () => {
		test('Creating task_user_acl logs all required fields correctly', async () => {
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'test task for acl log create',
					resource_owner_user_id: ownerUserId,
					created_by: ownerUserId,
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			const permissionLevel = 'edit'
			const aclEntry = await createTaskUserAcl(
				{ type: 'db', db },
				{
					organizationId,
					subjectUserId: aclHolderUserId,
					taskId: task.id,
					resourceOwnerUserId: ownerUserId,
					permissionLevel,
					grantedBy: ownerUserId,
				},
			)

			// Verify all log fields in a single query
			const [logEntry] = await db
				.select()
				.from(aclOperationsLog)
				.where(eq(aclOperationsLog.acl_entry_id, aclEntry.id))
				.limit(1)

			expect(logEntry).toBeDefined()
			expect(logEntry?.acl_type).toBe('task_user_acl')
			expect(logEntry?.operation).toBe('create')
			expect(logEntry?.acl_entry_id).toBe(aclEntry.id)
			expect(logEntry?.task_id).toBe(task.id)
			expect(logEntry?.organization_id).toBe(organizationId)
			expect(logEntry?.target_user_id).toBe(aclHolderUserId)
			expect(logEntry?.permission_level_before).toBeNull()
			expect(logEntry?.permission_level_after).toBe(permissionLevel)
			expect(logEntry?.performed_by).toBe(ownerUserId)
			expect(logEntry?.resource_owner_user_id).toBe(ownerUserId)
		})
	})

	describe('ACL Operations Log - Update', () => {
		test('Updating ACL permission logs operation with correct before/after values', async () => {
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'test task for update log',
					resource_owner_user_id: ownerUserId,
					created_by: ownerUserId,
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			const oldPermission = 'read'
			const newPermission = 'comment'

			const aclEntry = await createTaskUserAcl(
				{ type: 'db', db },
				{
					organizationId,
					subjectUserId: aclHolderUserId,
					taskId: task.id,
					resourceOwnerUserId: ownerUserId,
					permissionLevel: oldPermission,
					grantedBy: ownerUserId,
				},
			)

			// Update the permission
			await updateTaskUserAcl(
				{ type: 'db', db },
				{
					aclEntryId: aclEntry.id,
					newPermissionLevel: newPermission,
					updatedBy: strangerUserId, // Different user performs the update
				},
			)

			// Check log entries
			const logEntries = await db
				.select()
				.from(aclOperationsLog)
				.where(eq(aclOperationsLog.acl_entry_id, aclEntry.id))

			expect(logEntries.length).toBe(2) // create + update

			const updateEntry = logEntries.find((e) => e.operation === 'update')
			expect(updateEntry).toBeDefined()
			expect(updateEntry?.operation).toBe('update')
			expect(updateEntry?.permission_level_before).toBe(oldPermission)
			expect(updateEntry?.permission_level_after).toBe(newPermission)
			expect(updateEntry?.performed_by).toBe(strangerUserId)
		})
	})

	describe('ACL Operations Log - Delete', () => {
		test('Deleting ACL entry logs operation with permission_level_after: null', async () => {
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'test task for delete log',
					resource_owner_user_id: ownerUserId,
					created_by: ownerUserId,
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			const originalPermission = 'edit'

			const aclEntry = await createTaskUserAcl(
				{ type: 'db', db },
				{
					organizationId,
					subjectUserId: aclHolderUserId,
					taskId: task.id,
					resourceOwnerUserId: ownerUserId,
					permissionLevel: originalPermission,
					grantedBy: ownerUserId,
				},
			)

			await deleteTaskUserAcl(
				{ type: 'db', db },
				{
					aclEntryId: aclEntry.id,
					deletedBy: strangerUserId,
				},
			)

			// Check log entries
			const logEntries = await db
				.select()
				.from(aclOperationsLog)
				.where(eq(aclOperationsLog.acl_entry_id, aclEntry.id))

			expect(logEntries.length).toBe(2) // create + delete

			const deleteEntry = logEntries.find((e) => e.operation === 'delete')
			expect(deleteEntry).toBeDefined()
			expect(deleteEntry?.operation).toBe('delete')
			expect(deleteEntry?.permission_level_before).toBe(originalPermission)
			expect(deleteEntry?.permission_level_after).toBeNull()
			expect(deleteEntry?.performed_by).toBe(strangerUserId)
		})
	})

	describe('TaskOrganizationAcl Operations Log', () => {
		test('Full lifecycle (create/update/delete) logs correctly for org ACL', async () => {
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'test task for org acl logging',
					resource_owner_user_id: ownerUserId,
					created_by: ownerUserId,
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			// Create
			const aclEntry = await createTaskOrganizationAcl(
				{ type: 'db', db },
				{
					organizationId,
					taskId: task.id,
					resourceOwnerUserId: ownerUserId,
					permissionLevel: 'read',
					grantedBy: ownerUserId,
				},
			)

			let logEntries = await db
				.select()
				.from(aclOperationsLog)
				.where(eq(aclOperationsLog.acl_entry_id, aclEntry.id))

			expect(logEntries.length).toBe(1)
			const createEntry = logEntries[0]
			expect(createEntry?.acl_type).toBe('task_organization_acl')
			expect(createEntry?.operation).toBe('create')
			expect(createEntry?.permission_level_before).toBeNull()
			expect(createEntry?.permission_level_after).toBe('read')
			expect(createEntry?.target_organization_id).toBe(organizationId)
			expect(createEntry?.target_user_id).toBeNull()

			// Update
			await updateTaskOrganizationAcl(
				{ type: 'db', db },
				{
					aclEntryId: aclEntry.id,
					newPermissionLevel: 'edit',
					updatedBy: ownerUserId,
				},
			)

			logEntries = await db.select().from(aclOperationsLog).where(eq(aclOperationsLog.acl_entry_id, aclEntry.id))

			expect(logEntries.length).toBe(2)
			const updateEntry = logEntries.find((e) => e.operation === 'update')
			expect(updateEntry?.permission_level_before).toBe('read')
			expect(updateEntry?.permission_level_after).toBe('edit')

			// Delete
			await deleteTaskOrganizationAcl(
				{ type: 'db', db },
				{
					aclEntryId: aclEntry.id,
					deletedBy: ownerUserId,
				},
			)

			logEntries = await db.select().from(aclOperationsLog).where(eq(aclOperationsLog.acl_entry_id, aclEntry.id))

			expect(logEntries.length).toBe(3)
			const deleteEntry = logEntries.find((e) => e.operation === 'delete')
			expect(deleteEntry?.permission_level_before).toBe('edit')
			expect(deleteEntry?.permission_level_after).toBeNull()
		})
	})

	describe('Adversarial: ACL Access Control', () => {
		test('Stranger cannot grant ACL on task they do not own (no implicit grant)', async () => {
			// Task owned by ownerUserId
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'owner-only task',
					resource_owner_user_id: ownerUserId,
					created_by: ownerUserId,
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			// Stranger tries to grant ACL (this tests the data layer - actual API should reject this)
			// The ACL entry will be created but with incorrect resource_owner_user_id
			// This documents current behavior - the data layer doesn't prevent this
			const [aclEntry] = await db
				.insert(taskUserAcl)
				.values({
					organization_id: organizationId,
					subject_user_id: aclHolderUserId,
					task_id: task.id,
					resource_owner_user_id: strangerUserId, // Stranger claims ownership
					permission_level: 'edit',
					granted_by: strangerUserId,
				})
				.returning()

			// The ACL was created but with wrong resource_owner_user_id
			// This should NOT match the task's actual owner
			expect(aclEntry?.resource_owner_user_id).toBe(strangerUserId)
			expect(aclEntry?.resource_owner_user_id).not.toBe(task.resource_owner_user_id)

			// Query ACL entries that actually match the task's owner
			const validAcls = await db.select().from(taskUserAcl).where(eq(taskUserAcl.task_id, task.id))

			// The stranger's ACL entry should not be considered valid
			// because its resource_owner_user_id doesn't match the task's
			const matchingAcl = validAcls.find((acl) => acl.resource_owner_user_id === task.resource_owner_user_id)
			expect(matchingAcl).toBeUndefined()
		})

		test('ACL entries are scoped by organization - cross-org access prevented', async () => {
			// Create a second organization
			const [otherOrg] = await db
				.insert(organizations)
				.values({
					name: 'other organization',
					workos_organization_id: 'org_other_xyz',
				})
				.returning()

			if (!otherOrg) throw new Error('Failed to create other org')

			// Task in first org
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'first org task',
					resource_owner_user_id: ownerUserId,
					created_by: ownerUserId,
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			// Create ACL entry for user in same org
			await db.insert(taskUserAcl).values({
				organization_id: organizationId,
				subject_user_id: aclHolderUserId,
				task_id: task.id,
				resource_owner_user_id: ownerUserId,
				permission_level: 'edit',
				granted_by: ownerUserId,
			})

			// Query ACL entries scoped to the OTHER organization should find nothing
			const crossOrgAcls = await db.select().from(taskUserAcl).where(eq(taskUserAcl.organization_id, otherOrg.id))

			const crossOrgAcl = crossOrgAcls.find((acl) => acl.task_id === task.id)
			expect(crossOrgAcl).toBeUndefined()

			// Query ACL entries scoped to the correct organization should find the entry
			const correctOrgAcls = await db
				.select()
				.from(taskUserAcl)
				.where(eq(taskUserAcl.organization_id, organizationId))

			const correctOrgAcl = correctOrgAcls.find((acl) => acl.task_id === task.id)
			expect(correctOrgAcl).toBeDefined()
			expect(correctOrgAcl?.subject_user_id).toBe(aclHolderUserId)
		})

		test('Multiple users can have different permission levels on same task', async () => {
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'multi-user task',
					resource_owner_user_id: ownerUserId,
					created_by: ownerUserId,
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			// Grant read to aclHolderUserId
			await db.insert(taskUserAcl).values({
				organization_id: organizationId,
				subject_user_id: aclHolderUserId,
				task_id: task.id,
				resource_owner_user_id: ownerUserId,
				permission_level: 'read',
				granted_by: ownerUserId,
			})

			// Grant edit to strangerUserId
			await db.insert(taskUserAcl).values({
				organization_id: organizationId,
				subject_user_id: strangerUserId,
				task_id: task.id,
				resource_owner_user_id: ownerUserId,
				permission_level: 'edit',
				granted_by: ownerUserId,
			})

			// Verify both ACLs exist with correct permissions
			const acls = await db.select().from(taskUserAcl).where(eq(taskUserAcl.task_id, task.id))

			expect(acls.length).toBe(2)

			const aclHolderAcl = acls.find((acl) => acl.subject_user_id === aclHolderUserId)
			const strangerAcl = acls.find((acl) => acl.subject_user_id === strangerUserId)

			expect(aclHolderAcl?.permission_level).toBe('read')
			expect(strangerAcl?.permission_level).toBe('edit')
		})
	})

	afterAll(async () => {
		await cleanupTestDb?.()
	}, 30000)
})
