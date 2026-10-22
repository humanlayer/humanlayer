import { randomUUID } from 'node:crypto'

import { artifacts } from '@humanlayer/db/tables/artifacts'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { isSharedArtifactCommentAccessible } from '../src/lib/queries'
import { PUBLIC_ARTIFACT_COMMENT_COLUMNS } from '../src/routes/v1'
import { createElectricTestContext, createTestUser, type ElectricTestContext, waitForItem } from './fixtures'

describe('/v1/shared/artifacts/:artifactId/comments', () => {
	let ctx: ElectricTestContext

	beforeAll(async () => {
		ctx = await createElectricTestContext()
	})

	afterAll(async () => {
		await ctx.shutdown()
	})

	test('syncs only the shared artifact comments with public-safe columns', async () => {
		const shareKey = randomUUID()
		const user = createTestUser('shared-comment-owner')
		const task = await ctx.seedTask({
			organization_id: ctx.defaultOrganization.id,
			resource_owner_user_id: user.userId,
			created_by: user.userId,
			name: 'Shared comments task',
		})
		const artifact = await ctx.seedArtifact({
			organization_id: ctx.defaultOrganization.id,
			resource_owner_user_id: user.userId,
			task_id: task.id,
			task_slug: task.slug,
			file_name: 'shared-comments.md',
			content: '# Shared comments',
			share_key: shareKey,
			share_enabled: true,
			public_permission: 'comment',
		})
		const otherArtifact = await ctx.seedArtifact({
			organization_id: ctx.defaultOrganization.id,
			resource_owner_user_id: user.userId,
			task_id: task.id,
			task_slug: task.slug,
			file_name: 'other.md',
			content: '# Other',
		})
		const seedComment = (artifactId: string, content: string) =>
			ctx.seedArtifactComment({
				artifact_id: artifactId,
				task_id: task.id,
				organization_id: ctx.defaultOrganization.id,
				resource_owner_user_id: user.userId,
				created_by_user_id: user.userId,
				content_text: content,
			})
		const comment = await seedComment(artifact.id, 'Visible comment')
		await seedComment(otherArtifact.id, 'Private sibling comment')
		expect(await isSharedArtifactCommentAccessible(ctx.db, artifact.id, shareKey)).toBe(true)
		const server = ctx.createProxyServer({ user, organization: ctx.defaultOrganization, key: randomUUID() })
		const collection = await ctx.createSharedArtifactCommentsCollection({
			server,
			artifactId: artifact.id,
			shareKey,
		})

		const row = await waitForItem(collection, comment.id, { timeout: 10_000 })
		expect(
			Object.keys(row)
				.filter((key) => !key.startsWith('$'))
				.sort(),
		).toEqual([...PUBLIC_ARTIFACT_COMMENT_COLUMNS].sort())
		expect(row).toMatchObject({ artifact_id: artifact.id, content_text: 'Visible comment' })
		expect(collection.state.size).toBe(1)

		await collection.cleanup()
		await ctx.db.update(artifacts).set({ public_permission: 'view' }).where(eq(artifacts.id, artifact.id))
		const revoked = await fetch(`http://localhost:${server.port}/v1/shared/artifacts/${artifact.id}/comments`, {
			method: 'POST',
			headers: { 'x-share-key': shareKey },
		})
		expect(revoked.status).toBe(404)
	})

	test('rejects an invalid capability', async () => {
		const user = createTestUser('shared-comment-denied')
		const server = ctx.createProxyServer({ user, organization: ctx.defaultOrganization, key: randomUUID() })
		const response = await fetch(`http://localhost:${server.port}/v1/shared/artifacts/${randomUUID()}/comments`, {
			method: 'POST',
			headers: { 'x-share-key': 'wrong-key' },
		})
		expect(response.status).toBe(404)
	})
})
