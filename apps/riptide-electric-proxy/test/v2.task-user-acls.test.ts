import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { createElectricTestContext, createTestUser, type ElectricTestContext, waitForItem } from './fixtures'

const CI = !!process.env.CI

/**
 * Sync v2 Task User ACL Tests
 *
 * These tests verify that the /v2/task-user-acls endpoint exposes
 * org-wide read visibility: any member of the same organization can see all
 * task-user-acl entries, without ACL gating.
 *
 * v2 uses buildWhereFragmentForOrgScopedRows which filters only by organization_id,
 * in contrast to v1 which applies user-centric ACL filtering (checking ownership
 * or subject relationships).
 */
describe.skipIf(CI)('/v2/task-user-acls sync tests', () => {
	let ctx: ElectricTestContext

	beforeAll(async () => {
		ctx = await createElectricTestContext()
	})

	afterAll(async () => {
		await ctx.shutdown()
	})

	// =========================================================================
	// Section A: Org-Wide Visibility
	// =========================================================================
	describe('Section A: Org-Wide Visibility', () => {
		test('A1: User ACL entry syncs to owning user via v2', async () => {
			const testId = randomUUID().slice(0, 8)
			const owner = createTestUser(`v2_tuacl_a1_owner_${testId}`)
			const subject = createTestUser(`v2_tuacl_a1_subject_${testId}`)

			const server = ctx.createProxyServer({
				user: owner,
				organization: ctx.defaultOrganization,
				key: `v2_tuacl_a1_${testId}`,
			})

			const aclCollection = await ctx.createTaskUserAclV2Collection({ server })

			const task = await ctx.seedTask({
				name: `V2 TUAcl A1 Task ${testId}`,
				resource_owner_user_id: owner.userId,
				organization_id: ctx.defaultOrganization.id,
				created_by: owner.userId,
			})

			const acl = await ctx.seedTaskUserAcl({
				task_id: task.id,
				subject_user_id: subject.userId,
				organization_id: ctx.defaultOrganization.id,
				resource_owner_user_id: owner.userId,
				permission_level: 'read',
				granted_by: owner.userId,
			})

			await waitForItem(aclCollection, acl.id, { timeout: 10_000 })
			expect(aclCollection.has(acl.id)).toBe(true)
		})

		test('A2: Org member sees another member user ACL entry in v2 without ACL gating', async () => {
			const testId = randomUUID().slice(0, 8)
			const owner = createTestUser(`v2_tuacl_a2_owner_${testId}`)
			const subject = createTestUser(`v2_tuacl_a2_subject_${testId}`)
			const member = createTestUser(`v2_tuacl_a2_member_${testId}`)

			// Member's v2 proxy server — same org, not the subject of the ACL
			const memberServer = ctx.createProxyServer({
				user: member,
				organization: ctx.defaultOrganization,
				key: `v2_tuacl_a2_member_${testId}`,
			})

			const memberAclCollection = await ctx.createTaskUserAclV2Collection({ server: memberServer })

			const task = await ctx.seedTask({
				name: `V2 TUAcl A2 Task ${testId}`,
				resource_owner_user_id: owner.userId,
				organization_id: ctx.defaultOrganization.id,
				created_by: owner.userId,
			})

			const acl = await ctx.seedTaskUserAcl({
				task_id: task.id,
				subject_user_id: subject.userId,
				organization_id: ctx.defaultOrganization.id,
				resource_owner_user_id: owner.userId,
				permission_level: 'read',
				granted_by: owner.userId,
			})

			// v2: member should see the ACL entry even though they are neither owner nor subject
			await waitForItem(memberAclCollection, acl.id, { timeout: 10_000 })
			expect(memberAclCollection.has(acl.id)).toBe(true)
		})

		test('A3: Cross-org user does NOT see user ACL entry via v2 (org boundary is preserved)', async () => {
			const testId = randomUUID().slice(0, 8)
			const owner = createTestUser(`v2_tuacl_a3_owner_${testId}`)
			const subject = createTestUser(`v2_tuacl_a3_subject_${testId}`)
			const crossOrgUser = createTestUser(`v2_tuacl_a3_crossorg_${testId}`)

			// Create a second organization
			const otherOrg = await ctx.seedOrganization({ name: `V2 TUAcl A3 Other Org ${testId}` })

			const crossOrgServer = ctx.createProxyServer({
				user: crossOrgUser,
				organization: otherOrg,
				key: `v2_tuacl_a3_crossorg_${testId}`,
			})

			const crossOrgCollection = await ctx.createTaskUserAclV2Collection({ server: crossOrgServer })

			const task = await ctx.seedTask({
				name: `V2 TUAcl A3 Task ${testId}`,
				resource_owner_user_id: owner.userId,
				organization_id: ctx.defaultOrganization.id,
				created_by: owner.userId,
			})

			const acl = await ctx.withElectricSentinel(crossOrgCollection, async (tx) => {
				const [denied] = await tx
					.insert(ctx.tables.taskUserAcl)
					.values({
						task_id: task.id,
						subject_user_id: subject.userId,
						organization_id: ctx.defaultOrganization.id,
						resource_owner_user_id: owner.userId,
						permission_level: 'read',
						granted_by: owner.userId,
					})
					.returning()
				const [sentinel] = await tx
					.insert(ctx.tables.taskUserAcl)
					.values({
						task_id: task.id,
						subject_user_id: crossOrgUser.userId,
						organization_id: otherOrg.id,
						resource_owner_user_id: crossOrgUser.userId,
						permission_level: 'read',
						granted_by: crossOrgUser.userId,
					})
					.returning()
				if (!denied || !sentinel) throw new Error('Failed to seed task user ACL barrier')
				return { result: denied, sentinelId: sentinel.id }
			})

			// Cross-org user must NOT see the ACL entry
			expect(crossOrgCollection.has(acl.id)).toBe(false)
		})

		test('A4: All user ACL entries in org are visible to any org member via v2', async () => {
			const testId = randomUUID().slice(0, 8)
			const userA = createTestUser(`v2_tuacl_a4_userA_${testId}`)
			const userB = createTestUser(`v2_tuacl_a4_userB_${testId}`)
			const subjectA = createTestUser(`v2_tuacl_a4_subjectA_${testId}`)
			const subjectB = createTestUser(`v2_tuacl_a4_subjectB_${testId}`)

			const serverA = ctx.createProxyServer({
				user: userA,
				organization: ctx.defaultOrganization,
				key: `v2_tuacl_a4_userA_${testId}`,
			})
			const serverB = ctx.createProxyServer({
				user: userB,
				organization: ctx.defaultOrganization,
				key: `v2_tuacl_a4_userB_${testId}`,
			})

			const [collectionA, collectionB] = await Promise.all([
				ctx.createTaskUserAclV2Collection({ server: serverA }),
				ctx.createTaskUserAclV2Collection({ server: serverB }),
			])

			const taskA = await ctx.seedTask({
				name: `V2 TUAcl A4 UserA Task ${testId}`,
				resource_owner_user_id: userA.userId,
				organization_id: ctx.defaultOrganization.id,
				created_by: userA.userId,
			})
			const taskB = await ctx.seedTask({
				name: `V2 TUAcl A4 UserB Task ${testId}`,
				resource_owner_user_id: userB.userId,
				organization_id: ctx.defaultOrganization.id,
				created_by: userB.userId,
			})

			const aclA = await ctx.seedTaskUserAcl({
				task_id: taskA.id,
				subject_user_id: subjectA.userId,
				organization_id: ctx.defaultOrganization.id,
				resource_owner_user_id: userA.userId,
				permission_level: 'read',
				granted_by: userA.userId,
			})
			const aclB = await ctx.seedTaskUserAcl({
				task_id: taskB.id,
				subject_user_id: subjectB.userId,
				organization_id: ctx.defaultOrganization.id,
				resource_owner_user_id: userB.userId,
				permission_level: 'read',
				granted_by: userB.userId,
			})

			// Both collections should see both ACL entries
			await waitForItem(collectionA, aclA.id, { timeout: 10_000 })
			await waitForItem(collectionA, aclB.id, { timeout: 10_000 })
			await waitForItem(collectionB, aclA.id, { timeout: 10_000 })
			await waitForItem(collectionB, aclB.id, { timeout: 10_000 })

			expect(collectionA.has(aclA.id)).toBe(true)
			expect(collectionA.has(aclB.id)).toBe(true)
			expect(collectionB.has(aclA.id)).toBe(true)
			expect(collectionB.has(aclB.id)).toBe(true)
		})
	})

	// =========================================================================
	// Section B: v1 vs v2 contrast
	// =========================================================================
	describe('Section B: v1 vs v2 contrast', () => {
		test('B1: User ACL entry visible in v2 but not v1 for same-org non-owner/non-subject', async () => {
			const testId = randomUUID().slice(0, 8)
			const owner = createTestUser(`v2_tuacl_b1_owner_${testId}`)
			const subject = createTestUser(`v2_tuacl_b1_subject_${testId}`)
			const viewer = createTestUser(`v2_tuacl_b1_viewer_${testId}`)

			const v1Server = ctx.createProxyServer({
				user: viewer,
				organization: ctx.defaultOrganization,
				key: `v2_tuacl_b1_v1_${testId}`,
			})
			const v2Server = ctx.createProxyServer({
				user: viewer,
				organization: ctx.defaultOrganization,
				key: `v2_tuacl_b1_v2_${testId}`,
			})

			const v1Collection = await ctx.createTaskUserAclCollection({ server: v1Server })
			const v2Collection = await ctx.createTaskUserAclV2Collection({ server: v2Server })

			const task = await ctx.seedTask({
				name: `V2 TUAcl B1 Task ${testId}`,
				resource_owner_user_id: owner.userId,
				organization_id: ctx.defaultOrganization.id,
				created_by: owner.userId,
			})

			const acl = await ctx.withElectricSentinel(v1Collection, async (tx) => {
				const [denied] = await tx
					.insert(ctx.tables.taskUserAcl)
					.values({
						task_id: task.id,
						subject_user_id: subject.userId,
						organization_id: ctx.defaultOrganization.id,
						resource_owner_user_id: owner.userId,
						permission_level: 'read',
						granted_by: owner.userId,
					})
					.returning()
				const [sentinel] = await tx
					.insert(ctx.tables.taskUserAcl)
					.values({
						task_id: task.id,
						subject_user_id: viewer.userId,
						organization_id: ctx.defaultOrganization.id,
						resource_owner_user_id: owner.userId,
						permission_level: 'read',
						granted_by: owner.userId,
					})
					.returning()
				if (!denied || !sentinel) throw new Error('Failed to seed task user ACL barrier')
				return { result: denied, sentinelId: sentinel.id }
			})

			// v2: viewer should see the ACL entry
			await waitForItem(v2Collection, acl.id, { timeout: 10_000 })
			expect(v2Collection.has(acl.id)).toBe(true)

			// v1: viewer should NOT see the ACL entry (not owner or subject)
			expect(v1Collection.has(acl.id)).toBe(false)
		})
	})
})
