import { randomUUID } from 'node:crypto'

import { hash } from 'ohash'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { createElectricTestContext, createTestUser, type ElectricTestContext, waitForItem } from './fixtures'

/**
 * Task-Scoped Artifacts Sync Tests
 *
 * Tests for /v1/tasks/:taskId/artifacts (task-scoped, full content)
 * Covers task filtering, ownership isolation, and ACL grants.
 */
describe('/v1/tasks/:taskId/artifacts sync tests', () => {
	let ctx: ElectricTestContext

	beforeAll(async () => {
		ctx = await createElectricTestContext()
	})

	afterAll(async () => {
		await ctx.shutdown()
	})

	describe('/v1/tasks/:taskId/artifacts task-scoped', () => {
		test('User sees only artifacts for the specified task', async () => {
			const testId = randomUUID().slice(0, 8)
			const owner = createTestUser(`c1_owner_${testId}`)

			const taskA = await ctx.seedTask({
				name: `C1 Task A ${testId}`,
				resource_owner_user_id: owner.userId,
				organization_id: ctx.defaultOrganization.id,
				created_by: owner.userId,
			})

			const taskB = await ctx.seedTask({
				name: `C1 Task B ${testId}`,
				resource_owner_user_id: owner.userId,
				organization_id: ctx.defaultOrganization.id,
				created_by: owner.userId,
			})

			const artifactA = await ctx.seedArtifact({
				task_id: taskA.id,
				task_slug: taskA.slug,
				file_name: `c1-taskA-${testId}.md`,
				content: 'C1 task A content',
				resource_owner_user_id: owner.userId,
				organization_id: ctx.defaultOrganization.id,
			})

			const artifactB = await ctx.seedArtifact({
				task_id: taskB.id,
				task_slug: taskB.slug,
				file_name: `c1-taskB-${testId}.md`,
				content: 'C1 task B content',
				resource_owner_user_id: owner.userId,
				organization_id: ctx.defaultOrganization.id,
			})

			const server = ctx.createProxyServer({
				user: owner,
				organization: ctx.defaultOrganization,
				key: `c1_owner_${testId}`,
			})

			const taskACollection = await ctx.createTaskArtifactsCollection({
				server,
				taskId: taskA.id,
			})

			await waitForItem(taskACollection, artifactA.id, { timeout: 10_000 })
			expect(taskACollection.has(artifactA.id)).toBe(true)
			expect(taskACollection.has(artifactB.id)).toBe(false)
		})

		test('Non-owner does NOT see artifacts via task-scoped endpoint without ACL', async () => {
			const testId = randomUUID().slice(0, 8)
			const owner = createTestUser(`c2_owner_${testId}`)
			const other = createTestUser(`c2_other_${testId}`)

			const task = await ctx.seedTask({
				name: `C2 Task ${testId}`,
				resource_owner_user_id: owner.userId,
				organization_id: ctx.defaultOrganization.id,
				created_by: owner.userId,
			})

			const serverOther = ctx.createProxyServer({
				user: other,
				organization: ctx.defaultOrganization,
				key: `c2_other_${testId}`,
			})

			const taskCollection = await ctx.createTaskArtifactsCollection({
				server: serverOther,
				taskId: task.id,
			})

			const denied = await ctx.withElectricSentinel(taskCollection, async (tx) => {
				const [privateArtifact, sentinel] = await tx
					.insert(ctx.tables.artifacts)
					.values([
						{
							task_id: task.id,
							task_slug: task.slug,
							file_name: `c2-test-${testId}.md`,
							content: 'C2 private content',
							content_hash: hash('C2 private content'),
							resource_owner_user_id: owner.userId,
							organization_id: ctx.defaultOrganization.id,
							created_by: owner.userId,
						},
						{
							task_id: task.id,
							task_slug: task.slug,
							file_name: `c2-sentinel-${testId}.md`,
							content: 'C2 sentinel',
							content_hash: hash('C2 sentinel'),
							resource_owner_user_id: other.userId,
							organization_id: ctx.defaultOrganization.id,
							created_by: other.userId,
						},
					])
					.returning()
				if (!privateArtifact || !sentinel) throw new Error('Failed to seed artifact barrier')
				return { result: privateArtifact, sentinelId: sentinel.id }
			})
			expect(taskCollection.has(denied.id)).toBe(false)
		})

		test('ACL grant for task allows artifact visibility via task-scoped endpoint', async () => {
			const testId = randomUUID().slice(0, 8)
			const owner = createTestUser(`c3_owner_${testId}`)
			const grantee = createTestUser(`c3_grantee_${testId}`)

			const task = await ctx.seedTask({
				name: `C3 Task ${testId}`,
				resource_owner_user_id: owner.userId,
				organization_id: ctx.defaultOrganization.id,
				created_by: owner.userId,
			})

			const artifact = await ctx.seedArtifact({
				task_id: task.id,
				task_slug: task.slug,
				file_name: `c3-test-${testId}.md`,
				content: 'C3 shared task content',
				resource_owner_user_id: owner.userId,
				organization_id: ctx.defaultOrganization.id,
			})

			await ctx.seedTaskUserAcl({
				granted_by: owner.userId,
				task_id: task.id,
				subject_user_id: grantee.userId,
				organization_id: ctx.defaultOrganization.id,
				resource_owner_user_id: owner.userId,
				permission_level: 'read',
			})

			const serverGrantee = ctx.createProxyServer({
				user: grantee,
				organization: ctx.defaultOrganization,
				key: `c3_grantee_${testId}`,
			})

			const taskCollection = await ctx.createTaskArtifactsCollection({
				server: serverGrantee,
				taskId: task.id,
			})

			await waitForItem(taskCollection, artifact.id, { timeout: 10_000 })
			expect(taskCollection.has(artifact.id)).toBe(true)
		})
	})
})
