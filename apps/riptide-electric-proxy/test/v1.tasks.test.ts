import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { createElectricTestContext, createTestUser, type ElectricTestContext, waitForItem } from './fixtures'

const CI = !!process.env.CI

/**
 * Task Sync Tests
 *
 * Tests for ensuring proper isolation and ACL-based sync behavior for tasks.
 * All tests within each describe.concurrent block are concurrency-safe:
 * - Each test creates its own unique users
 * - Each test creates its own data
 * - Tests do not share mutable state
 */
describe.skipIf(CI)('/v1/tasks sync tests', () => {
	let ctx: ElectricTestContext

	beforeAll(async () => {
		ctx = await createElectricTestContext()
	})

	afterAll(async () => {
		await ctx.shutdown()
	})

	// =========================================================================
	// Section A: Basic Ownership Isolation
	// =========================================================================
	describe.concurrent('Section A: Basic Ownership Isolation', () => {
		test('A1: Owner task syncs to owner', async () => {
			const testId = randomUUID().slice(0, 8)
			const owner = createTestUser(`a1_owner_${testId}`)

			const server = ctx.createProxyServer({
				user: owner,
				organization: ctx.defaultOrganization,
				key: `a1_${testId}`,
			})

			const tasksCollection = await ctx.createTasksCollection({ server })

			const task = await ctx.seedTask({
				name: `A1 Test Task ${testId}`,
				resource_owner_user_id: owner.userId,
				organization_id: ctx.defaultOrganization.id,
				created_by: owner.userId,
			})

			await waitForItem(tasksCollection, task.id, { timeout: 10_000 })
			expect(tasksCollection.has(task.id)).toBe(true)
		})

		test('A2: Task does NOT sync to different user in same org', async () => {
			const testId = randomUUID().slice(0, 8)
			const owner = createTestUser(`a2_owner_${testId}`)
			const otherUser = createTestUser(`a2_other_${testId}`)

			// Create proxy for the other user (who should NOT see owner's task)
			const otherServer = ctx.createProxyServer({
				user: otherUser,
				organization: ctx.defaultOrganization,
				key: `a2_other_${testId}`,
			})

			const otherTasksCollection = await ctx.createTasksCollection({ server: otherServer })

			// Seed task owned by owner
			const task = await ctx.withElectricSentinel(otherTasksCollection, async (tx) => {
				const [denied, sentinel] = await tx
					.insert(ctx.tables.tasks)
					.values([
						{
							name: `A2 Test Task ${testId}`,
							resource_owner_user_id: owner.userId,
							organization_id: ctx.defaultOrganization.id,
							created_by: owner.userId,
						},
						{
							name: `A2 Sentinel ${testId}`,
							resource_owner_user_id: otherUser.userId,
							organization_id: ctx.defaultOrganization.id,
							created_by: otherUser.userId,
						},
					])
					.returning()
				if (!denied || !sentinel) throw new Error('Failed to seed task barrier')
				return { result: denied, sentinelId: sentinel.id }
			})

			// Other user should NOT see the task
			expect(otherTasksCollection.has(task.id)).toBe(false)
		})

		test('A3: Task does NOT sync to user in different org', async () => {
			const testId = randomUUID().slice(0, 8)
			const owner = createTestUser(`a3_owner_${testId}`)
			const crossOrgUser = createTestUser(`a3_crossorg_${testId}`)

			// Create a different organization for the cross-org user
			const otherOrg = await ctx.seedOrganization({ name: `A3 Other Org ${testId}` })

			// Create proxy for cross-org user
			const crossOrgServer = ctx.createProxyServer({
				user: crossOrgUser,
				organization: otherOrg,
				key: `a3_crossorg_${testId}`,
			})

			const crossOrgTasksCollection = await ctx.createTasksCollection({ server: crossOrgServer })

			// Seed task in default org
			const task = await ctx.withElectricSentinel(crossOrgTasksCollection, async (tx) => {
				const [denied, sentinel] = await tx
					.insert(ctx.tables.tasks)
					.values([
						{
							name: `A3 Test Task ${testId}`,
							resource_owner_user_id: owner.userId,
							organization_id: ctx.defaultOrganization.id,
							created_by: owner.userId,
						},
						{
							name: `A3 Sentinel ${testId}`,
							resource_owner_user_id: crossOrgUser.userId,
							organization_id: otherOrg.id,
							created_by: crossOrgUser.userId,
						},
					])
					.returning()
				if (!denied || !sentinel) throw new Error('Failed to seed task barrier')
				return { result: denied, sentinelId: sentinel.id }
			})

			// Cross-org user should NOT see the task
			expect(crossOrgTasksCollection.has(task.id)).toBe(false)
		})
	})

	// =========================================================================
	// Section B: User ACL Sharing
	// =========================================================================
	describe.concurrent('Section B: User ACL Sharing', () => {
		test('B1: Task syncs to user with task_user_acl entry', async () => {
			const testId = randomUUID().slice(0, 8)
			const owner = createTestUser(`b1_owner_${testId}`)
			const grantee = createTestUser(`b1_grantee_${testId}`)

			// Create proxy for grantee
			const granteeServer = ctx.createProxyServer({
				user: grantee,
				organization: ctx.defaultOrganization,
				key: `b1_grantee_${testId}`,
			})

			const granteeTasksCollection = await ctx.createTasksCollection({ server: granteeServer })

			// Seed task owned by owner
			const task = await ctx.withElectricSentinel(granteeTasksCollection, async (tx) => {
				const [denied, sentinel] = await tx
					.insert(ctx.tables.tasks)
					.values([
						{
							name: `B1 Test Task ${testId}`,
							resource_owner_user_id: owner.userId,
							organization_id: ctx.defaultOrganization.id,
							created_by: owner.userId,
						},
						{
							name: `B1 Sentinel ${testId}`,
							resource_owner_user_id: grantee.userId,
							organization_id: ctx.defaultOrganization.id,
							created_by: grantee.userId,
						},
					])
					.returning()
				if (!denied || !sentinel) throw new Error('Failed to seed task barrier')
				return { result: denied, sentinelId: sentinel.id }
			})

			expect(granteeTasksCollection.has(task.id)).toBe(false)

			// Grant ACL to grantee
			await ctx.seedTaskUserAcl({
				granted_by: owner.userId,
				task_id: task.id,
				subject_user_id: grantee.userId,
				organization_id: ctx.defaultOrganization.id,
				resource_owner_user_id: owner.userId,
				permission_level: 'read',
			})

			// Now grantee should see the task
			await waitForItem(granteeTasksCollection, task.id, { timeout: 10_000 })
			expect(granteeTasksCollection.has(task.id)).toBe(true)
		})

		test('B2: ACL in different org does NOT grant access', async () => {
			const testId = randomUUID().slice(0, 8)
			const owner = createTestUser(`b2_owner_${testId}`)
			const crossOrgUser = createTestUser(`b2_crossorg_${testId}`)

			// Create different org for cross-org user
			const otherOrg = await ctx.seedOrganization({ name: `B2 Other Org ${testId}` })

			// Create proxy for cross-org user viewing their own org
			const crossOrgServer = ctx.createProxyServer({
				user: crossOrgUser,
				organization: otherOrg,
				key: `b2_crossorg_${testId}`,
			})

			const crossOrgTasksCollection = await ctx.createTasksCollection({ server: crossOrgServer })

			// Seed task in default org
			const task = await ctx.seedTask({
				name: `B2 Test Task ${testId}`,
				resource_owner_user_id: owner.userId,
				organization_id: ctx.defaultOrganization.id,
				created_by: owner.userId,
			})

			await ctx.withElectricSentinel(crossOrgTasksCollection, async (tx) => {
				await tx.insert(ctx.tables.taskUserAcl).values({
					granted_by: owner.userId,
					task_id: task.id,
					subject_user_id: crossOrgUser.userId,
					organization_id: otherOrg.id,
					resource_owner_user_id: owner.userId,
					permission_level: 'read',
				})
				const [sentinel] = await tx
					.insert(ctx.tables.tasks)
					.values({
						name: `B2 Sentinel ${testId}`,
						resource_owner_user_id: crossOrgUser.userId,
						organization_id: otherOrg.id,
						created_by: crossOrgUser.userId,
					})
					.returning()
				if (!sentinel) throw new Error('Failed to seed task barrier')
				return { result: undefined, sentinelId: sentinel.id }
			})
			expect(crossOrgTasksCollection.has(task.id)).toBe(false)
		})

		test('B3: ACL for different task does NOT grant access to other tasks', async () => {
			const testId = randomUUID().slice(0, 8)
			const owner = createTestUser(`b3_owner_${testId}`)
			const grantee = createTestUser(`b3_grantee_${testId}`)

			// Create proxy for grantee
			const granteeServer = ctx.createProxyServer({
				user: grantee,
				organization: ctx.defaultOrganization,
				key: `b3_grantee_${testId}`,
			})

			const granteeTasksCollection = await ctx.createTasksCollection({ server: granteeServer })

			// Seed two tasks
			const taskA = await ctx.seedTask({
				name: `B3 Task A ${testId}`,
				resource_owner_user_id: owner.userId,
				organization_id: ctx.defaultOrganization.id,
				created_by: owner.userId,
			})

			const taskB = await ctx.seedTask({
				name: `B3 Task B ${testId}`,
				resource_owner_user_id: owner.userId,
				organization_id: ctx.defaultOrganization.id,
				created_by: owner.userId,
			})

			// Grant ACL only for taskA
			await ctx.seedTaskUserAcl({
				granted_by: owner.userId,
				task_id: taskA.id,
				subject_user_id: grantee.userId,
				organization_id: ctx.defaultOrganization.id,
				resource_owner_user_id: owner.userId,
				permission_level: 'read',
			})

			// Wait for taskA to sync
			await waitForItem(granteeTasksCollection, taskA.id, { timeout: 10_000 })

			// Grantee should see taskA but NOT taskB
			expect(granteeTasksCollection.has(taskA.id)).toBe(true)
			expect(granteeTasksCollection.has(taskB.id)).toBe(false)
		})
	})

	// =========================================================================
	// Section C: Organization ACL Sharing
	// =========================================================================
	describe.concurrent('Section C: Organization ACL Sharing', () => {
		test('C1: Task syncs to any user when task_organization_acl exists', async () => {
			const testId = randomUUID().slice(0, 8)
			const owner = createTestUser(`c1_owner_${testId}`)
			const orgMember = createTestUser(`c1_member_${testId}`)

			// Create proxy for org member
			const memberServer = ctx.createProxyServer({
				user: orgMember,
				organization: ctx.defaultOrganization,
				key: `c1_member_${testId}`,
			})

			const memberTasksCollection = await ctx.createTasksCollection({ server: memberServer })

			// Seed task
			const task = await ctx.withElectricSentinel(memberTasksCollection, async (tx) => {
				const [denied, sentinel] = await tx
					.insert(ctx.tables.tasks)
					.values([
						{
							name: `C1 Test Task ${testId}`,
							resource_owner_user_id: owner.userId,
							organization_id: ctx.defaultOrganization.id,
							created_by: owner.userId,
						},
						{
							name: `C1 Sentinel ${testId}`,
							resource_owner_user_id: orgMember.userId,
							organization_id: ctx.defaultOrganization.id,
							created_by: orgMember.userId,
						},
					])
					.returning()
				if (!denied || !sentinel) throw new Error('Failed to seed task barrier')
				return { result: denied, sentinelId: sentinel.id }
			})

			expect(memberTasksCollection.has(task.id)).toBe(false)

			// Grant org-wide ACL
			await ctx.seedTaskOrganizationAcl({
				granted_by: owner.userId,
				task_id: task.id,
				organization_id: ctx.defaultOrganization.id,
				resource_owner_user_id: owner.userId,
				permission_level: 'read',
			})

			// Now member should see the task
			await waitForItem(memberTasksCollection, task.id, { timeout: 10_000 })
			expect(memberTasksCollection.has(task.id)).toBe(true)
		})

		test('C2: Org ACL in different org does NOT grant access', async () => {
			const testId = randomUUID().slice(0, 8)
			const owner = createTestUser(`c2_owner_${testId}`)
			const crossOrgUser = createTestUser(`c2_crossorg_${testId}`)

			// Create different org
			const otherOrg = await ctx.seedOrganization({ name: `C2 Other Org ${testId}` })

			// Create proxy for cross-org user
			const crossOrgServer = ctx.createProxyServer({
				user: crossOrgUser,
				organization: otherOrg,
				key: `c2_crossorg_${testId}`,
			})

			const crossOrgTasksCollection = await ctx.createTasksCollection({ server: crossOrgServer })

			// Seed task in default org
			const task = await ctx.seedTask({
				name: `C2 Test Task ${testId}`,
				resource_owner_user_id: owner.userId,
				organization_id: ctx.defaultOrganization.id,
				created_by: owner.userId,
			})

			await ctx.withElectricSentinel(crossOrgTasksCollection, async (tx) => {
				await tx.insert(ctx.tables.taskOrganizationAcl).values({
					granted_by: owner.userId,
					task_id: task.id,
					organization_id: ctx.defaultOrganization.id,
					resource_owner_user_id: owner.userId,
					permission_level: 'read',
				})
				const [sentinel] = await tx
					.insert(ctx.tables.tasks)
					.values({
						name: `C2 Sentinel ${testId}`,
						resource_owner_user_id: crossOrgUser.userId,
						organization_id: otherOrg.id,
						created_by: crossOrgUser.userId,
					})
					.returning()
				if (!sentinel) throw new Error('Failed to seed task barrier')
				return { result: undefined, sentinelId: sentinel.id }
			})
			expect(crossOrgTasksCollection.has(task.id)).toBe(false)
		})
	})

	// =========================================================================
	// Section D: Adversarial - ACL Revocation
	// =========================================================================
	describe.concurrent('Section D: Adversarial - ACL Revocation', () => {
		test('D1: Removing task_user_acl removes task from grantee sync', async () => {
			const testId = randomUUID().slice(0, 8)
			const owner = createTestUser(`d1_owner_${testId}`)
			const grantee = createTestUser(`d1_grantee_${testId}`)

			// Create proxy for grantee
			const granteeServer = ctx.createProxyServer({
				user: grantee,
				organization: ctx.defaultOrganization,
				key: `d1_grantee_${testId}`,
			})

			const granteeTasksCollection = await ctx.createTasksCollection({ server: granteeServer })

			// Seed task
			const task = await ctx.seedTask({
				name: `D1 Test Task ${testId}`,
				resource_owner_user_id: owner.userId,
				organization_id: ctx.defaultOrganization.id,
				created_by: owner.userId,
			})

			// Grant ACL
			const acl = await ctx.seedTaskUserAcl({
				granted_by: owner.userId,
				task_id: task.id,
				subject_user_id: grantee.userId,
				organization_id: ctx.defaultOrganization.id,
				resource_owner_user_id: owner.userId,
				permission_level: 'read',
			})

			// Wait for task to appear
			await waitForItem(granteeTasksCollection, task.id, { timeout: 10_000 })
			expect(granteeTasksCollection.has(task.id)).toBe(true)

			// REVOKE ACL
			await ctx.withElectricSentinel(granteeTasksCollection, async (tx) => {
				await tx.delete(ctx.tables.taskUserAcl).where(eq(ctx.tables.taskUserAcl.id, acl.id))
				const [sentinel] = await tx
					.insert(ctx.tables.tasks)
					.values({
						name: `D1 Sentinel ${testId}`,
						resource_owner_user_id: grantee.userId,
						organization_id: ctx.defaultOrganization.id,
						created_by: grantee.userId,
					})
					.returning()
				if (!sentinel) throw new Error('Failed to seed task barrier')
				return { result: undefined, sentinelId: sentinel.id }
			})

			expect(granteeTasksCollection.has(task.id)).toBe(false)
		})

		test('D2: Removing task_organization_acl removes task from org members sync', async () => {
			const testId = randomUUID().slice(0, 8)
			const owner = createTestUser(`d2_owner_${testId}`)
			const orgMember = createTestUser(`d2_member_${testId}`)

			// Create proxy for org member
			const memberServer = ctx.createProxyServer({
				user: orgMember,
				organization: ctx.defaultOrganization,
				key: `d2_member_${testId}`,
			})

			const memberTasksCollection = await ctx.createTasksCollection({ server: memberServer })

			// Seed task
			const task = await ctx.seedTask({
				name: `D2 Test Task ${testId}`,
				resource_owner_user_id: owner.userId,
				organization_id: ctx.defaultOrganization.id,
				created_by: owner.userId,
			})

			// Grant org ACL
			const acl = await ctx.seedTaskOrganizationAcl({
				granted_by: owner.userId,
				task_id: task.id,
				organization_id: ctx.defaultOrganization.id,
				resource_owner_user_id: owner.userId,
				permission_level: 'read',
			})

			// Wait for task to appear
			await waitForItem(memberTasksCollection, task.id, { timeout: 10_000 })
			expect(memberTasksCollection.has(task.id)).toBe(true)

			// REVOKE org ACL
			await ctx.withElectricSentinel(memberTasksCollection, async (tx) => {
				await tx.delete(ctx.tables.taskOrganizationAcl).where(eq(ctx.tables.taskOrganizationAcl.id, acl.id))
				const [sentinel] = await tx
					.insert(ctx.tables.tasks)
					.values({
						name: `D2 Sentinel ${testId}`,
						resource_owner_user_id: orgMember.userId,
						organization_id: ctx.defaultOrganization.id,
						created_by: orgMember.userId,
					})
					.returning()
				if (!sentinel) throw new Error('Failed to seed task barrier')
				return { result: undefined, sentinelId: sentinel.id }
			})

			expect(memberTasksCollection.has(task.id)).toBe(false)
		})
	})

	// =========================================================================
	// Section E: Edge Cases
	// =========================================================================
	describe.concurrent('Section E: Edge Cases', () => {
		test('E1: Owner still sees task if org ACL is removed', async () => {
			const testId = randomUUID().slice(0, 8)
			const owner = createTestUser(`e1_owner_${testId}`)

			// Create proxy for owner
			const ownerServer = ctx.createProxyServer({
				user: owner,
				organization: ctx.defaultOrganization,
				key: `e1_owner_${testId}`,
			})

			const ownerTasksCollection = await ctx.createTasksCollection({ server: ownerServer })

			// Seed task
			const task = await ctx.seedTask({
				name: `E1 Test Task ${testId}`,
				resource_owner_user_id: owner.userId,
				organization_id: ctx.defaultOrganization.id,
				created_by: owner.userId,
			})

			// Wait for task to appear for owner
			await waitForItem(ownerTasksCollection, task.id, { timeout: 10_000 })

			// Add org ACL (redundant for owner but tests the scenario)
			const acl = await ctx.seedTaskOrganizationAcl({
				granted_by: owner.userId,
				task_id: task.id,
				organization_id: ctx.defaultOrganization.id,
				resource_owner_user_id: owner.userId,
				permission_level: 'read',
			})

			// Remove org ACL
			await ctx.withElectricSentinel(ownerTasksCollection, async (tx) => {
				await tx.delete(ctx.tables.taskOrganizationAcl).where(eq(ctx.tables.taskOrganizationAcl.id, acl.id))
				const [sentinel] = await tx
					.insert(ctx.tables.tasks)
					.values({
						name: `E1 Sentinel ${testId}`,
						resource_owner_user_id: owner.userId,
						organization_id: ctx.defaultOrganization.id,
						created_by: owner.userId,
					})
					.returning()
				if (!sentinel) throw new Error('Failed to seed task barrier')
				return { result: undefined, sentinelId: sentinel.id }
			})

			expect(ownerTasksCollection.has(task.id)).toBe(true)
		})

		test('E2: Both user ACL and org ACL exist - removal of one does not break access', async () => {
			const testId = randomUUID().slice(0, 8)
			const owner = createTestUser(`e2_owner_${testId}`)
			const grantee = createTestUser(`e2_grantee_${testId}`)

			// Create proxy for grantee
			const granteeServer = ctx.createProxyServer({
				user: grantee,
				organization: ctx.defaultOrganization,
				key: `e2_grantee_${testId}`,
			})

			const granteeTasksCollection = await ctx.createTasksCollection({ server: granteeServer })

			// Seed task
			const task = await ctx.seedTask({
				name: `E2 Test Task ${testId}`,
				resource_owner_user_id: owner.userId,
				organization_id: ctx.defaultOrganization.id,
				created_by: owner.userId,
			})

			// Grant BOTH user ACL and org ACL
			const userAcl = await ctx.seedTaskUserAcl({
				granted_by: owner.userId,
				task_id: task.id,
				subject_user_id: grantee.userId,
				organization_id: ctx.defaultOrganization.id,
				resource_owner_user_id: owner.userId,
				permission_level: 'read',
			})

			await ctx.seedTaskOrganizationAcl({
				granted_by: owner.userId,
				task_id: task.id,
				organization_id: ctx.defaultOrganization.id,
				resource_owner_user_id: owner.userId,
				permission_level: 'read',
			})

			// Wait for task to appear
			await waitForItem(granteeTasksCollection, task.id, { timeout: 10_000 })
			expect(granteeTasksCollection.has(task.id)).toBe(true)

			// Remove user ACL (org ACL remains)
			await ctx.withElectricSentinel(granteeTasksCollection, async (tx) => {
				await tx.delete(ctx.tables.taskUserAcl).where(eq(ctx.tables.taskUserAcl.id, userAcl.id))
				const [sentinel] = await tx
					.insert(ctx.tables.tasks)
					.values({
						name: `E2 Sentinel ${testId}`,
						resource_owner_user_id: grantee.userId,
						organization_id: ctx.defaultOrganization.id,
						created_by: grantee.userId,
					})
					.returning()
				if (!sentinel) throw new Error('Failed to seed task barrier')
				return { result: undefined, sentinelId: sentinel.id }
			})

			expect(granteeTasksCollection.has(task.id)).toBe(true)
		})
	})
})
