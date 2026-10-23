import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { createElectricTestContext, createTestUser, type ElectricTestContext, waitForItem } from './fixtures'

const CI = !!process.env.CI

describe.skipIf(CI)('/v2/diff-comments sync', () => {
	let ctx: ElectricTestContext

	beforeAll(async () => {
		ctx = await createElectricTestContext()
	})

	afterAll(async () => {
		await ctx.shutdown()
	})

	test('syncs the canonical row including bigint times and independent range sides', async () => {
		const testId = randomUUID().slice(0, 8)
		const viewer = createTestUser(`v2_diff_viewer_${testId}`)
		const server = ctx.createProxyServer({
			user: viewer,
			organization: ctx.defaultOrganization,
			key: `v2_diff_viewer_${testId}`,
		})
		const collection = await ctx.createDiffCommentsV2Collection({ server })
		const task = await ctx.seedTask({
			name: `V2 diff comments ${testId}`,
			resource_owner_user_id: viewer.userId,
			organization_id: ctx.defaultOrganization.id,
			created_by: viewer.userId,
		})
		const root = await ctx.seedDiffComment({
			organization_id: ctx.defaultOrganization.id,
			resource_owner_user_id: viewer.userId,
			task_id: task.id,
			created_by_user_id: 'another-org-member',
			content_text: 'Cross-side range',
			anchor_json: {
				v: 1,
				repoId: 'repo-1',
				path: 'src/file.ts',
				patchHash: 'patch-1',
				start: { side: 'old', line: 3 },
				end: { side: 'new', line: 7 },
			},
		})

		await waitForItem(collection, root.id, { timeout: 10_000 })
		const synced = collection.get(root.id)
		expect(synced?.anchor_json).toEqual(root.anchor_json)
		expect(synced?.created_at).toBeTypeOf('bigint')
		expect(synced?.updated_at).toBeTypeOf('bigint')
	})

	test('does not expose cross-organization rows', async () => {
		const testId = randomUUID().slice(0, 8)
		const viewer = createTestUser(`v2_diff_cross_${testId}`)
		const otherOrganization = await ctx.seedOrganization({ name: `Other v2 diff org ${testId}` })
		const server = ctx.createProxyServer({
			user: viewer,
			organization: ctx.defaultOrganization,
			key: `v2_diff_cross_${testId}`,
		})
		const collection = await ctx.createDiffCommentsV2Collection({ server })
		const visibleTask = await ctx.seedTask({
			name: `Visible v2 sentinel task ${testId}`,
			resource_owner_user_id: viewer.userId,
			organization_id: ctx.defaultOrganization.id,
			created_by: viewer.userId,
		})
		const hiddenTask = await ctx.seedTask({
			name: `Hidden v2 task ${testId}`,
			resource_owner_user_id: viewer.userId,
			organization_id: otherOrganization.id,
			created_by: viewer.userId,
		})

		const hidden = await ctx.withElectricSentinel(collection, async (tx) => {
			const [denied] = await tx
				.insert(ctx.tables.diffComments)
				.values({
					organization_id: otherOrganization.id,
					resource_owner_user_id: viewer.userId,
					task_id: hiddenTask.id,
					created_by_user_id: viewer.userId,
					content_text: 'Hidden v2 comment',
				})
				.returning()
			const [sentinel] = await tx
				.insert(ctx.tables.diffComments)
				.values({
					organization_id: ctx.defaultOrganization.id,
					resource_owner_user_id: viewer.userId,
					task_id: visibleTask.id,
					created_by_user_id: viewer.userId,
					content_text: 'Visible v2 sentinel',
				})
				.returning()
			if (!denied || !sentinel) throw new Error('Failed to seed v2 diff comment barrier')
			return { result: denied, sentinelId: sentinel.id }
		})

		expect(collection.has(hidden.id)).toBe(false)
	})
})
