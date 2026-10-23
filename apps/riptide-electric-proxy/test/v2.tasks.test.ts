import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { createElectricTestContext, createTestUser, type ElectricTestContext, waitForItem } from './fixtures'

const CI = !!process.env.CI

/**
 * Sync v2 Task Tests
 *
 * These tests verify that the /v2/tasks endpoint exposes org-wide read
 * visibility: any member of the same organization can see all tasks,
 * regardless of ACL entries.
 *
 * v1 visibility is tested separately in v1.tasks.test.ts — these tests
 * explicitly assert the OPPOSITE behaviour so regressions are immediately
 * visible if v2 ever silently reverts to ACL-gated access.
 */
describe.skipIf(CI)('/v2/tasks sync tests', () => {
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
		test('A1: Owner task syncs to owner via v2', async () => {
			const testId = randomUUID().slice(0, 8)
			const owner = createTestUser(`v2_tasks_a1_owner_${testId}`)

			const server = ctx.createProxyServer({
				user: owner,
				organization: ctx.defaultOrganization,
				key: `v2_tasks_a1_${testId}`,
			})

			const tasksCollection = await ctx.createTasksV2Collection({ server })

			const task = await ctx.seedTask({
				name: `V2 A1 Task ${testId}`,
				resource_owner_user_id: owner.userId,
				organization_id: ctx.defaultOrganization.id,
				created_by: owner.userId,
			})

			await waitForItem(tasksCollection, task.id, { timeout: 10_000 })
			expect(tasksCollection.has(task.id)).toBe(true)
		})

		test('A2: Org member sees another member task in v2 without ACL', async () => {
			const testId = randomUUID().slice(0, 8)
			const owner = createTestUser(`v2_tasks_a2_owner_${testId}`)
			const member = createTestUser(`v2_tasks_a2_member_${testId}`)

			const memberServer = ctx.createProxyServer({
				user: member,
				organization: ctx.defaultOrganization,
				key: `v2_tasks_a2_member_${testId}`,
			})

			const memberTasksCollection = await ctx.createTasksV2Collection({ server: memberServer })

			// Seed task owned by owner — no ACL for member
			const task = await ctx.seedTask({
				name: `V2 A2 Task ${testId}`,
				resource_owner_user_id: owner.userId,
				organization_id: ctx.defaultOrganization.id,
				created_by: owner.userId,
			})

			// v2: member should see the task even without ACL
			await waitForItem(memberTasksCollection, task.id, { timeout: 10_000 })
			expect(memberTasksCollection.has(task.id)).toBe(true)
		})

		test('A3: Cross-org user does NOT see task via v2 (org boundary is preserved)', async () => {
			const testId = randomUUID().slice(0, 8)
			const owner = createTestUser(`v2_tasks_a3_owner_${testId}`)
			const crossOrgUser = createTestUser(`v2_tasks_a3_crossorg_${testId}`)

			const otherOrg = await ctx.seedOrganization({ name: `V2 Tasks A3 Other Org ${testId}` })

			const crossOrgServer = ctx.createProxyServer({
				user: crossOrgUser,
				organization: otherOrg,
				key: `v2_tasks_a3_crossorg_${testId}`,
			})

			const crossOrgCollection = await ctx.createTasksV2Collection({ server: crossOrgServer })

			const task = await ctx.withElectricSentinel(crossOrgCollection, async (tx) => {
				const [denied] = await tx
					.insert(ctx.tables.tasks)
					.values({
						name: `V2 A3 Task ${testId}`,
						resource_owner_user_id: owner.userId,
						organization_id: ctx.defaultOrganization.id,
						created_by: owner.userId,
					})
					.returning()
				const [sentinel] = await tx
					.insert(ctx.tables.tasks)
					.values({
						name: `V2 A3 Sentinel ${testId}`,
						resource_owner_user_id: crossOrgUser.userId,
						organization_id: otherOrg.id,
						created_by: crossOrgUser.userId,
					})
					.returning()
				if (!denied || !sentinel) throw new Error('Failed to seed task barrier')
				return { result: denied, sentinelId: sentinel.id }
			})

			// Cross-org user must NOT see the task
			expect(crossOrgCollection.has(task.id)).toBe(false)
		})

		test('A4: All tasks in org are visible to any org member via v2', async () => {
			const testId = randomUUID().slice(0, 8)
			const userA = createTestUser(`v2_tasks_a4_userA_${testId}`)
			const userB = createTestUser(`v2_tasks_a4_userB_${testId}`)

			const serverA = ctx.createProxyServer({
				user: userA,
				organization: ctx.defaultOrganization,
				key: `v2_tasks_a4_userA_${testId}`,
			})
			const serverB = ctx.createProxyServer({
				user: userB,
				organization: ctx.defaultOrganization,
				key: `v2_tasks_a4_userB_${testId}`,
			})

			const [collectionA, collectionB] = await Promise.all([
				ctx.createTasksV2Collection({ server: serverA }),
				ctx.createTasksV2Collection({ server: serverB }),
			])

			const taskA = await ctx.seedTask({
				name: `V2 A4 UserA Task ${testId}`,
				resource_owner_user_id: userA.userId,
				organization_id: ctx.defaultOrganization.id,
				created_by: userA.userId,
			})

			const taskB = await ctx.seedTask({
				name: `V2 A4 UserB Task ${testId}`,
				resource_owner_user_id: userB.userId,
				organization_id: ctx.defaultOrganization.id,
				created_by: userB.userId,
			})

			// Both collections should see both tasks
			await waitForItem(collectionA, taskA.id, { timeout: 10_000 })
			await waitForItem(collectionA, taskB.id, { timeout: 10_000 })
			await waitForItem(collectionB, taskA.id, { timeout: 10_000 })
			await waitForItem(collectionB, taskB.id, { timeout: 10_000 })

			expect(collectionA.has(taskA.id)).toBe(true)
			expect(collectionA.has(taskB.id)).toBe(true)
			expect(collectionB.has(taskA.id)).toBe(true)
			expect(collectionB.has(taskB.id)).toBe(true)
		})
	})
})
