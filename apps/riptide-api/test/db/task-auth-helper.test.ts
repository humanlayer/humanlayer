import { randomUUID } from 'node:crypto'

import { organizations } from '@humanlayer/db/tables/organizations'
import { taskOrganizationAcl } from '@humanlayer/db/tables/task-organization-acl'
import { taskUserAcl } from '@humanlayer/db/tables/task-user-acl'
import { tasks } from '@humanlayer/db/tables/tasks'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { canWriteSession, getTaskWithEffectivePermissions, maybeGetTaskWithAuthCheck } from '../../src/db/task-auth'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('Task Auth Helper Tests', async () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase

	let organizationId: string
	let otherOrganizationId: string
	const workosOrganizationId = 'org_workos123'
	const workosOrganizationId2 = 'org_workos456'
	const userId = 'user_abc123'
	const otherUserId = 'user_def456'

	beforeAll(async () => {
		const testDb = await createTestDb('task_auth_helper')
		cleanupTestDb = testDb.cleanup
		db = testDb.db

		// Seed required data
		const [org] = await db
			.insert(organizations)
			.values({
				name: 'test organization',
				workos_organization_id: workosOrganizationId,
			})
			.returning()

		if (!org) throw new Error('Unable to insert organization for setup')
		organizationId = org.id

		const [org2] = await db
			.insert(organizations)
			.values({
				name: 'other organization',
				workos_organization_id: workosOrganizationId2,
			})
			.returning()

		if (!org2) throw new Error('Unable to insert second organization for setup')
		otherOrganizationId = org2.id
	})

	afterAll(async () => {
		await cleanupTestDb?.()
	}, 30000)

	describe('3.1 Basic Ownership Lookup', () => {
		test('Test 24: Returns task when user is owner via resource_owner_user_id', async () => {
			// Create task owned by userId
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'owned task',
					resource_owner_user_id: userId,
					created_by: userId,
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			const result = await db.transaction(async (tx) => {
				return maybeGetTaskWithAuthCheck(tx, task.id, userId, organizationId)
			})

			expect(result).not.toBeNull()
			expect(result?.id).toBe(task.id)
			expect(result?.resource_owner_user_id).toBe(userId)
		})

		test('Test 25: Returns null when task does not exist', async () => {
			const nonExistentTaskId = randomUUID()

			const result = await db.transaction(async (tx) => {
				return maybeGetTaskWithAuthCheck(tx, nonExistentTaskId, userId, organizationId)
			})

			expect(result).toBeNull()
		})

		test('Test 26: Returns null when task exists but wrong organization_id', async () => {
			// Create task in organizationId
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'task in org 1',
					resource_owner_user_id: userId,
					created_by: userId,
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			// Try to access it with wrong organization_id
			const result = await db.transaction(async (tx) => {
				return maybeGetTaskWithAuthCheck(tx, task.id, userId, otherOrganizationId)
			})

			expect(result).toBeNull()
		})

		test('Test 27: Returns null when user is not owner and has no ACL', async () => {
			// Create task owned by userId
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'unshared task',
					resource_owner_user_id: userId,
					created_by: userId,
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			// Try to access as otherUserId (no ACL)
			const result = await db.transaction(async (tx) => {
				return maybeGetTaskWithAuthCheck(tx, task.id, otherUserId, organizationId)
			})

			expect(result).toBeNull()
		})
	})

	describe('3.2 User ACL Lookup', () => {
		test('Test 28: Returns task when user has task_user_acl entry', async () => {
			// Create task owned by userId
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'shared via user acl',
					resource_owner_user_id: userId,
					created_by: userId,
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			// Grant access to otherUserId via user ACL
			await db.insert(taskUserAcl).values({
				task_id: task.id,
				subject_user_id: otherUserId,
				organization_id: organizationId,
				resource_owner_user_id: userId,
				permission_level: 'read',
				granted_by: userId,
			})

			// Try to access as otherUserId
			const result = await db.transaction(async (tx) => {
				return maybeGetTaskWithAuthCheck(tx, task.id, otherUserId, organizationId)
			})

			expect(result).not.toBeNull()
			expect(result?.id).toBe(task.id)
		})

		test('Test 29: Returns null when user has ACL for different task', async () => {
			// Create two tasks
			const [task1] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'task 1',
					resource_owner_user_id: userId,
					created_by: userId,
				})
				.returning()

			if (!task1) throw new Error('Failed to create task1')

			const [task2] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'task 2',
					resource_owner_user_id: userId,
					created_by: userId,
				})
				.returning()

			if (!task2) throw new Error('Failed to create task2')

			// Grant access to task1 but not task2
			await db.insert(taskUserAcl).values({
				task_id: task1.id,
				subject_user_id: otherUserId,
				organization_id: organizationId,
				resource_owner_user_id: userId,
				permission_level: 'read',
				granted_by: userId,
			})

			// Try to access task2 (should fail)
			const result = await db.transaction(async (tx) => {
				return maybeGetTaskWithAuthCheck(tx, task2.id, otherUserId, organizationId)
			})

			expect(result).toBeNull()
		})

		test('Test 30: Returns null when user has ACL in different organization', async () => {
			// Create task in otherOrganizationId
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: otherOrganizationId,
					name: 'task in other org',
					resource_owner_user_id: userId,
					created_by: userId,
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			// Grant ACL in the wrong organization (organizationId instead of otherOrganizationId)
			await db.insert(taskUserAcl).values({
				task_id: task.id,
				subject_user_id: otherUserId,
				organization_id: organizationId, // Wrong org!
				resource_owner_user_id: userId,
				permission_level: 'read',
				granted_by: userId,
			})

			// Try to access with organizationId (should fail)
			const result = await db.transaction(async (tx) => {
				return maybeGetTaskWithAuthCheck(tx, task.id, otherUserId, organizationId)
			})

			expect(result).toBeNull()
		})
	})

	describe('3.3 Organization ACL Lookup', () => {
		test("Test 31: Returns task when task_organization_acl exists for user's org", async () => {
			// Create task owned by userId
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'shared via org acl',
					resource_owner_user_id: userId,
					created_by: userId,
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			// Grant org-wide access
			await db.insert(taskOrganizationAcl).values({
				task_id: task.id,
				organization_id: organizationId,
				resource_owner_user_id: userId,
				permission_level: 'read',
				granted_by: userId,
			})

			// Try to access as otherUserId (same org)
			const result = await db.transaction(async (tx) => {
				return maybeGetTaskWithAuthCheck(tx, task.id, otherUserId, organizationId)
			})

			expect(result).not.toBeNull()
			expect(result?.id).toBe(task.id)
		})

		test('Test 32: Returns null when org ACL exists for different organization', async () => {
			// Create task in organizationId
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'task with wrong org acl',
					resource_owner_user_id: userId,
					created_by: userId,
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			// Grant org-wide access to a DIFFERENT org
			await db.insert(taskOrganizationAcl).values({
				task_id: task.id,
				organization_id: otherOrganizationId, // Different org!
				resource_owner_user_id: userId,
				permission_level: 'read',
				granted_by: userId,
			})

			// Try to access with original organizationId (should fail)
			const result = await db.transaction(async (tx) => {
				return maybeGetTaskWithAuthCheck(tx, task.id, otherUserId, organizationId)
			})

			expect(result).toBeNull()
		})
	})

	describe('3.4 Combined Conditions', () => {
		test('Test 33: Owner access works even when ACL entries exist', async () => {
			// Create task owned by userId
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'task with acl and owner',
					resource_owner_user_id: userId,
					created_by: userId,
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			// Add both user and org ACL entries
			await db.insert(taskUserAcl).values({
				task_id: task.id,
				subject_user_id: otherUserId,
				organization_id: organizationId,
				resource_owner_user_id: userId,
				permission_level: 'read',
				granted_by: userId,
			})

			await db.insert(taskOrganizationAcl).values({
				task_id: task.id,
				organization_id: organizationId,
				resource_owner_user_id: userId,
				permission_level: 'edit',
				granted_by: userId,
			})

			// Owner should still have access
			const result = await db.transaction(async (tx) => {
				return maybeGetTaskWithAuthCheck(tx, task.id, userId, organizationId)
			})

			expect(result).not.toBeNull()
			expect(result?.id).toBe(task.id)
			expect(result?.resource_owner_user_id).toBe(userId)
		})

		test('Test 34: User ACL grants access when not owner', async () => {
			// Create task owned by userId
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'user acl without ownership',
					resource_owner_user_id: userId,
					created_by: userId,
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			// Grant user ACL to otherUserId
			await db.insert(taskUserAcl).values({
				task_id: task.id,
				subject_user_id: otherUserId,
				organization_id: organizationId,
				resource_owner_user_id: userId,
				permission_level: 'edit',
				granted_by: userId,
			})

			// otherUserId should have access via ACL
			const result = await db.transaction(async (tx) => {
				return maybeGetTaskWithAuthCheck(tx, task.id, otherUserId, organizationId)
			})

			expect(result).not.toBeNull()
			expect(result?.id).toBe(task.id)
		})

		test('Test 35: Org ACL grants access when not owner and no user ACL', async () => {
			// Create task owned by userId
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'org acl without ownership or user acl',
					resource_owner_user_id: userId,
					created_by: userId,
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			// Grant org-wide ACL (no user ACL)
			await db.insert(taskOrganizationAcl).values({
				task_id: task.id,
				organization_id: organizationId,
				resource_owner_user_id: userId,
				permission_level: 'read',
				granted_by: userId,
			})

			// otherUserId should have access via org ACL
			const result = await db.transaction(async (tx) => {
				return maybeGetTaskWithAuthCheck(tx, task.id, otherUserId, organizationId)
			})

			expect(result).not.toBeNull()
			expect(result?.id).toBe(task.id)
		})
	})

	describe('getTaskWithEffectivePermissions', () => {
		test('Owner always has edit permission', async () => {
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'owner edit test',
					resource_owner_user_id: userId,
					created_by: userId,
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			const result = await db.transaction(async (tx) => {
				return getTaskWithEffectivePermissions(tx, task.id, userId, organizationId)
			})

			expect(result).not.toBeNull()
			expect(result?.effectivePermission).toBe('edit')
		})

		test('Returns null when task does not exist', async () => {
			const result = await db.transaction(async (tx) => {
				return getTaskWithEffectivePermissions(tx, randomUUID(), userId, organizationId)
			})

			expect(result).toBeNull()
		})

		test('Returns null when user has no access (not owner, no ACL)', async () => {
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'no access test',
					resource_owner_user_id: userId,
					created_by: userId,
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			const result = await db.transaction(async (tx) => {
				return getTaskWithEffectivePermissions(tx, task.id, otherUserId, organizationId)
			})

			expect(result).toBeNull()
		})

		test('User ACL read permission returns read', async () => {
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'user acl read test',
					resource_owner_user_id: userId,
					created_by: userId,
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			await db.insert(taskUserAcl).values({
				task_id: task.id,
				subject_user_id: otherUserId,
				organization_id: organizationId,
				resource_owner_user_id: userId,
				permission_level: 'read',
				granted_by: userId,
			})

			const result = await db.transaction(async (tx) => {
				return getTaskWithEffectivePermissions(tx, task.id, otherUserId, organizationId)
			})

			expect(result).not.toBeNull()
			expect(result?.effectivePermission).toBe('read')
		})

		test('User ACL edit permission returns edit', async () => {
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'user acl edit test',
					resource_owner_user_id: userId,
					created_by: userId,
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			await db.insert(taskUserAcl).values({
				task_id: task.id,
				subject_user_id: otherUserId,
				organization_id: organizationId,
				resource_owner_user_id: userId,
				permission_level: 'edit',
				granted_by: userId,
			})

			const result = await db.transaction(async (tx) => {
				return getTaskWithEffectivePermissions(tx, task.id, otherUserId, organizationId)
			})

			expect(result).not.toBeNull()
			expect(result?.effectivePermission).toBe('edit')
		})

		test('User ACL comment permission returns comment', async () => {
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'user acl comment test',
					resource_owner_user_id: userId,
					created_by: userId,
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			await db.insert(taskUserAcl).values({
				task_id: task.id,
				subject_user_id: otherUserId,
				organization_id: organizationId,
				resource_owner_user_id: userId,
				permission_level: 'comment',
				granted_by: userId,
			})

			const result = await db.transaction(async (tx) => {
				return getTaskWithEffectivePermissions(tx, task.id, otherUserId, organizationId)
			})

			expect(result).not.toBeNull()
			expect(result?.effectivePermission).toBe('comment')
		})

		test('Org ACL read permission returns read', async () => {
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'org acl read test',
					resource_owner_user_id: userId,
					created_by: userId,
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			await db.insert(taskOrganizationAcl).values({
				task_id: task.id,
				organization_id: organizationId,
				resource_owner_user_id: userId,
				permission_level: 'read',
				granted_by: userId,
			})

			const result = await db.transaction(async (tx) => {
				return getTaskWithEffectivePermissions(tx, task.id, otherUserId, organizationId)
			})

			expect(result).not.toBeNull()
			expect(result?.effectivePermission).toBe('read')
		})

		test('Org ACL comment permission returns comment', async () => {
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'org acl comment test',
					resource_owner_user_id: userId,
					created_by: userId,
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			await db.insert(taskOrganizationAcl).values({
				task_id: task.id,
				organization_id: organizationId,
				resource_owner_user_id: userId,
				permission_level: 'comment',
				granted_by: userId,
			})

			const result = await db.transaction(async (tx) => {
				return getTaskWithEffectivePermissions(tx, task.id, otherUserId, organizationId)
			})

			expect(result).not.toBeNull()
			expect(result?.effectivePermission).toBe('comment')
		})

		test('Org ACL edit permission returns edit', async () => {
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'org acl edit test',
					resource_owner_user_id: userId,
					created_by: userId,
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			await db.insert(taskOrganizationAcl).values({
				task_id: task.id,
				organization_id: organizationId,
				resource_owner_user_id: userId,
				permission_level: 'edit',
				granted_by: userId,
			})

			const result = await db.transaction(async (tx) => {
				return getTaskWithEffectivePermissions(tx, task.id, otherUserId, organizationId)
			})

			expect(result).not.toBeNull()
			expect(result?.effectivePermission).toBe('edit')
		})

		test('Max of user ACL and org ACL: org read + user comment = comment', async () => {
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'max perm test 1',
					resource_owner_user_id: userId,
					created_by: userId,
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			// Org ACL with read
			await db.insert(taskOrganizationAcl).values({
				task_id: task.id,
				organization_id: organizationId,
				resource_owner_user_id: userId,
				permission_level: 'read',
				granted_by: userId,
			})

			// User ACL with comment (higher than read)
			await db.insert(taskUserAcl).values({
				task_id: task.id,
				subject_user_id: otherUserId,
				organization_id: organizationId,
				resource_owner_user_id: userId,
				permission_level: 'comment',
				granted_by: userId,
			})

			const result = await db.transaction(async (tx) => {
				return getTaskWithEffectivePermissions(tx, task.id, otherUserId, organizationId)
			})

			expect(result).not.toBeNull()
			expect(result?.effectivePermission).toBe('comment')
		})

		test('Max of user ACL and org ACL: org edit + user comment = edit', async () => {
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'max perm test 2',
					resource_owner_user_id: userId,
					created_by: userId,
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			// Org ACL with write (higher than comment)
			await db.insert(taskOrganizationAcl).values({
				task_id: task.id,
				organization_id: organizationId,
				resource_owner_user_id: userId,
				permission_level: 'edit',
				granted_by: userId,
			})

			// User ACL with comment
			await db.insert(taskUserAcl).values({
				task_id: task.id,
				subject_user_id: otherUserId,
				organization_id: organizationId,
				resource_owner_user_id: userId,
				permission_level: 'comment',
				granted_by: userId,
			})

			const result = await db.transaction(async (tx) => {
				return getTaskWithEffectivePermissions(tx, task.id, otherUserId, organizationId)
			})

			expect(result).not.toBeNull()
			expect(result?.effectivePermission).toBe('edit')
		})

		test('Max of user ACL and org ACL: user edit + org read = edit', async () => {
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'max perm test 3',
					resource_owner_user_id: userId,
					created_by: userId,
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			// Org ACL with read
			await db.insert(taskOrganizationAcl).values({
				task_id: task.id,
				organization_id: organizationId,
				resource_owner_user_id: userId,
				permission_level: 'read',
				granted_by: userId,
			})

			// User ACL with write (higher)
			await db.insert(taskUserAcl).values({
				task_id: task.id,
				subject_user_id: otherUserId,
				organization_id: organizationId,
				resource_owner_user_id: userId,
				permission_level: 'edit',
				granted_by: userId,
			})

			const result = await db.transaction(async (tx) => {
				return getTaskWithEffectivePermissions(tx, task.id, otherUserId, organizationId)
			})

			expect(result).not.toBeNull()
			expect(result?.effectivePermission).toBe('edit')
		})

		test('Max of user ACL and org ACL: org comment + user read = comment', async () => {
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'max perm test 4',
					resource_owner_user_id: userId,
					created_by: userId,
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			// Org ACL with comment (higher than read)
			await db.insert(taskOrganizationAcl).values({
				task_id: task.id,
				organization_id: organizationId,
				resource_owner_user_id: userId,
				permission_level: 'comment',
				granted_by: userId,
			})

			// User ACL with read
			await db.insert(taskUserAcl).values({
				task_id: task.id,
				subject_user_id: otherUserId,
				organization_id: organizationId,
				resource_owner_user_id: userId,
				permission_level: 'read',
				granted_by: userId,
			})

			const result = await db.transaction(async (tx) => {
				return getTaskWithEffectivePermissions(tx, task.id, otherUserId, organizationId)
			})

			expect(result).not.toBeNull()
			expect(result?.effectivePermission).toBe('comment')
		})

		test('Max of user ACL and org ACL: org edit + user read = edit', async () => {
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'max perm test 5',
					resource_owner_user_id: userId,
					created_by: userId,
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			// Org ACL with write (highest)
			await db.insert(taskOrganizationAcl).values({
				task_id: task.id,
				organization_id: organizationId,
				resource_owner_user_id: userId,
				permission_level: 'edit',
				granted_by: userId,
			})

			// User ACL with read
			await db.insert(taskUserAcl).values({
				task_id: task.id,
				subject_user_id: otherUserId,
				organization_id: organizationId,
				resource_owner_user_id: userId,
				permission_level: 'read',
				granted_by: userId,
			})

			const result = await db.transaction(async (tx) => {
				return getTaskWithEffectivePermissions(tx, task.id, otherUserId, organizationId)
			})

			expect(result).not.toBeNull()
			expect(result?.effectivePermission).toBe('edit')
		})

		test('Returns null when task exists but wrong organization_id', async () => {
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'wrong org test',
					resource_owner_user_id: userId,
					created_by: userId,
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			// Try to access with wrong organization
			const result = await db.transaction(async (tx) => {
				return getTaskWithEffectivePermissions(tx, task.id, userId, otherOrganizationId)
			})

			expect(result).toBeNull()
		})

		test('Owner still has edit even when ACL entries exist', async () => {
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'owner with acl test',
					resource_owner_user_id: userId,
					created_by: userId,
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			// Add both user and org ACL entries (shouldn't affect owner)
			await db.insert(taskOrganizationAcl).values({
				task_id: task.id,
				organization_id: organizationId,
				resource_owner_user_id: userId,
				permission_level: 'read',
				granted_by: userId,
			})

			await db.insert(taskUserAcl).values({
				task_id: task.id,
				subject_user_id: userId, // ACL for owner themselves
				organization_id: organizationId,
				resource_owner_user_id: userId,
				permission_level: 'comment',
				granted_by: userId,
			})

			// Owner should still have edit
			const result = await db.transaction(async (tx) => {
				return getTaskWithEffectivePermissions(tx, task.id, userId, organizationId)
			})

			expect(result).not.toBeNull()
			expect(result?.effectivePermission).toBe('edit')
		})
	})

	describe('canWriteSession', () => {
		test('returns false when created_by !== userId even if user has edit access', async () => {
			// Create task owned by userId, session created by a different user
			const [task] = await db
				.insert(tasks)
				.values({
					name: 'test task for canWriteSession',
					resource_owner_user_id: userId,
					organization_id: organizationId,
					created_by: userId,
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			const result = await db.transaction(async (tx) => {
				return canWriteSession(
					tx,
					{ task_id: task.id, resource_owner_user_id: userId, created_by: 'other_user' },
					userId,
					organizationId,
				)
			})
			expect(result).toBe(false)
		})

		test('returns true when created_by === userId and user has edit access', async () => {
			const [task] = await db
				.insert(tasks)
				.values({
					name: 'test task creator edit',
					resource_owner_user_id: userId,
					organization_id: organizationId,
					created_by: userId,
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			const result = await db.transaction(async (tx) => {
				return canWriteSession(
					tx,
					{ task_id: task.id, resource_owner_user_id: userId, created_by: userId },
					userId,
					organizationId,
				)
			})
			expect(result).toBe(true)
		})

		test('returns false when created_by === userId but user lacks edit access', async () => {
			const nonOwnerUserId = 'user_no_access'
			const [task] = await db
				.insert(tasks)
				.values({
					name: 'test task no access',
					resource_owner_user_id: userId,
					organization_id: organizationId,
					created_by: userId,
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			const result = await db.transaction(async (tx) => {
				return canWriteSession(
					tx,
					{ task_id: task.id, resource_owner_user_id: userId, created_by: nonOwnerUserId },
					nonOwnerUserId,
					organizationId,
				)
			})
			expect(result).toBe(false)
		})

		test('works for standalone sessions — created_by === userId and resource_owner matches', async () => {
			const result = await db.transaction(async (tx) => {
				return canWriteSession(
					tx,
					{ task_id: null, resource_owner_user_id: userId, created_by: userId },
					userId,
					organizationId,
				)
			})
			expect(result).toBe(true)
		})
	})
})
