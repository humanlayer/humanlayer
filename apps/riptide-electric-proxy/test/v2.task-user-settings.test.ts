import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { createElectricTestContext, createTestUser, type ElectricTestContext, waitForItem } from './fixtures'

const CI = !!process.env.CI

/**
 * Sync v2 Task User Settings Tests
 *
 * These tests verify that the /v2/task-user-settings endpoint exposes
 * org-wide read visibility: any member of the same organization can see all
 * task-user-settings entries, without user-scoping.
 *
 * v2 uses buildWhereFragmentForOrgScopedRows which filters only by organization_id,
 * in contrast to v1 which filters by organization_id AND user_id (user can only
 * see their own settings).
 */
describe.skipIf(CI)('/v2/task-user-settings sync tests', () => {
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
		test('A1: User settings sync to owning user via v2', async () => {
			const testId = randomUUID().slice(0, 8)
			const owner = createTestUser(`v2_tus_a1_owner_${testId}`)

			const server = ctx.createProxyServer({
				user: owner,
				organization: ctx.defaultOrganization,
				key: `v2_tus_a1_${testId}`,
			})

			const settingsCollection = await ctx.createTaskUserSettingsV2Collection({ server })

			const task = await ctx.seedTask({
				name: `V2 TUS A1 Task ${testId}`,
				resource_owner_user_id: owner.userId,
				organization_id: ctx.defaultOrganization.id,
				created_by: owner.userId,
			})

			const settings = await ctx.seedTaskUserSettings({
				task_id: task.id,
				user_id: owner.userId,
				organization_id: ctx.defaultOrganization.id,
				working_directory: '/test/dir',
			})

			await waitForItem(settingsCollection, settings.id, { timeout: 10_000 })
			expect(settingsCollection.has(settings.id)).toBe(true)
		})

		test('A2: Org member sees another member user settings in v2 without user-scoping', async () => {
			const testId = randomUUID().slice(0, 8)
			const owner = createTestUser(`v2_tus_a2_owner_${testId}`)
			const member = createTestUser(`v2_tus_a2_member_${testId}`)

			// Member's v2 proxy server — same org, different user
			const memberServer = ctx.createProxyServer({
				user: member,
				organization: ctx.defaultOrganization,
				key: `v2_tus_a2_member_${testId}`,
			})

			const memberSettingsCollection = await ctx.createTaskUserSettingsV2Collection({ server: memberServer })

			const task = await ctx.seedTask({
				name: `V2 TUS A2 Task ${testId}`,
				resource_owner_user_id: owner.userId,
				organization_id: ctx.defaultOrganization.id,
				created_by: owner.userId,
			})

			const settings = await ctx.seedTaskUserSettings({
				task_id: task.id,
				user_id: owner.userId,
				organization_id: ctx.defaultOrganization.id,
				working_directory: '/test/dir',
			})

			// v2: member should see owner's settings
			await waitForItem(memberSettingsCollection, settings.id, { timeout: 10_000 })
			expect(memberSettingsCollection.has(settings.id)).toBe(true)
		})

		test('A3: Cross-org user does NOT see user settings via v2 (org boundary is preserved)', async () => {
			const testId = randomUUID().slice(0, 8)
			const owner = createTestUser(`v2_tus_a3_owner_${testId}`)
			const crossOrgUser = createTestUser(`v2_tus_a3_crossorg_${testId}`)

			// Create a second organization
			const otherOrg = await ctx.seedOrganization({ name: `V2 TUS A3 Other Org ${testId}` })

			const crossOrgServer = ctx.createProxyServer({
				user: crossOrgUser,
				organization: otherOrg,
				key: `v2_tus_a3_crossorg_${testId}`,
			})

			const crossOrgCollection = await ctx.createTaskUserSettingsV2Collection({ server: crossOrgServer })

			const task = await ctx.seedTask({
				name: `V2 TUS A3 Task ${testId}`,
				resource_owner_user_id: owner.userId,
				organization_id: ctx.defaultOrganization.id,
				created_by: owner.userId,
			})

			const settings = await ctx.withElectricSentinel(crossOrgCollection, async (tx) => {
				const [denied] = await tx
					.insert(ctx.tables.taskUserSettings)
					.values({
						task_id: task.id,
						user_id: owner.userId,
						organization_id: ctx.defaultOrganization.id,
						working_directory: '/test/dir',
					})
					.returning()
				const [sentinel] = await tx
					.insert(ctx.tables.taskUserSettings)
					.values({
						task_id: task.id,
						user_id: crossOrgUser.userId,
						organization_id: otherOrg.id,
						working_directory: '/test/sentinel',
					})
					.returning()
				if (!denied || !sentinel) throw new Error('Failed to seed task user settings barrier')
				return { result: denied, sentinelId: sentinel.id }
			})

			// Cross-org user must NOT see the settings
			expect(crossOrgCollection.has(settings.id)).toBe(false)
		})

		test('A4: All user settings in org are visible to any org member via v2', async () => {
			const testId = randomUUID().slice(0, 8)
			const userA = createTestUser(`v2_tus_a4_userA_${testId}`)
			const userB = createTestUser(`v2_tus_a4_userB_${testId}`)

			const serverA = ctx.createProxyServer({
				user: userA,
				organization: ctx.defaultOrganization,
				key: `v2_tus_a4_userA_${testId}`,
			})
			const serverB = ctx.createProxyServer({
				user: userB,
				organization: ctx.defaultOrganization,
				key: `v2_tus_a4_userB_${testId}`,
			})

			const [collectionA, collectionB] = await Promise.all([
				ctx.createTaskUserSettingsV2Collection({ server: serverA }),
				ctx.createTaskUserSettingsV2Collection({ server: serverB }),
			])

			const task = await ctx.seedTask({
				name: `V2 TUS A4 Task ${testId}`,
				resource_owner_user_id: userA.userId,
				organization_id: ctx.defaultOrganization.id,
				created_by: userA.userId,
			})

			const settingsA = await ctx.seedTaskUserSettings({
				task_id: task.id,
				user_id: userA.userId,
				organization_id: ctx.defaultOrganization.id,
				working_directory: '/test/dir',
			})
			const settingsB = await ctx.seedTaskUserSettings({
				task_id: task.id,
				user_id: userB.userId,
				organization_id: ctx.defaultOrganization.id,
				working_directory: '/test/other-dir',
			})

			// Both collections should see both settings entries
			await waitForItem(collectionA, settingsA.id, { timeout: 10_000 })
			await waitForItem(collectionA, settingsB.id, { timeout: 10_000 })
			await waitForItem(collectionB, settingsA.id, { timeout: 10_000 })
			await waitForItem(collectionB, settingsB.id, { timeout: 10_000 })

			expect(collectionA.has(settingsA.id)).toBe(true)
			expect(collectionA.has(settingsB.id)).toBe(true)
			expect(collectionB.has(settingsA.id)).toBe(true)
			expect(collectionB.has(settingsB.id)).toBe(true)
		})
	})

	// =========================================================================
	// Section B: v1 vs v2 contrast
	// =========================================================================
	describe('Section B: v1 vs v2 contrast', () => {
		test('B1: User settings visible in v2 but not v1 for same-org different user', async () => {
			const testId = randomUUID().slice(0, 8)
			const owner = createTestUser(`v2_tus_b1_owner_${testId}`)
			const viewer = createTestUser(`v2_tus_b1_viewer_${testId}`)

			const v1Server = ctx.createProxyServer({
				user: viewer,
				organization: ctx.defaultOrganization,
				key: `v2_tus_b1_v1_${testId}`,
			})
			const v2Server = ctx.createProxyServer({
				user: viewer,
				organization: ctx.defaultOrganization,
				key: `v2_tus_b1_v2_${testId}`,
			})

			const v1Collection = await ctx.createTaskUserSettingsCollection({ server: v1Server })
			const v2Collection = await ctx.createTaskUserSettingsV2Collection({ server: v2Server })

			const task = await ctx.seedTask({
				name: `V2 TUS B1 Task ${testId}`,
				resource_owner_user_id: owner.userId,
				organization_id: ctx.defaultOrganization.id,
				created_by: owner.userId,
			})

			const settings = await ctx.withElectricSentinel(v1Collection, async (tx) => {
				const [denied] = await tx
					.insert(ctx.tables.taskUserSettings)
					.values({
						task_id: task.id,
						user_id: owner.userId,
						organization_id: ctx.defaultOrganization.id,
						working_directory: '/test/dir',
					})
					.returning()
				const [sentinel] = await tx
					.insert(ctx.tables.taskUserSettings)
					.values({
						task_id: task.id,
						user_id: viewer.userId,
						organization_id: ctx.defaultOrganization.id,
						working_directory: '/test/sentinel',
					})
					.returning()
				if (!denied || !sentinel) throw new Error('Failed to seed task user settings barrier')
				return { result: denied, sentinelId: sentinel.id }
			})

			// v2: viewer should see owner's settings
			await waitForItem(v2Collection, settings.id, { timeout: 10_000 })
			expect(v2Collection.has(settings.id)).toBe(true)

			// v1: viewer should NOT see owner's settings (user-scoped)
			expect(v1Collection.has(settings.id)).toBe(false)
		})
	})
})
