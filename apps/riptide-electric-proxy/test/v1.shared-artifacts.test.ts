import { randomUUID } from 'node:crypto'

import { artifacts } from '@humanlayer/db/tables/artifacts'
import { organizationSettings } from '@humanlayer/db/tables/organization-settings'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { PUBLIC_ARTIFACT_COLUMNS } from '../src/routes/v1'
import { createElectricTestContext, createTestUser, type ElectricTestContext, waitForItem } from './fixtures'

describe('/v1/shared/artifacts/:artifactId', () => {
	let ctx: ElectricTestContext

	beforeAll(async () => {
		ctx = await createElectricTestContext()
	})

	afterAll(async () => {
		await ctx.shutdown()
	})

	test('syncs only the public-safe artifact columns for a valid capability', async () => {
		const shareKey = randomUUID()
		const user = createTestUser('shared-artifact-owner')
		const task = await ctx.seedTask({
			organization_id: ctx.defaultOrganization.id,
			resource_owner_user_id: user.userId,
			created_by: user.userId,
			name: 'Public safe task',
		})
		const artifact = await ctx.seedArtifact({
			organization_id: ctx.defaultOrganization.id,
			resource_owner_user_id: user.userId,
			task_id: task.id,
			task_slug: task.slug,
			file_name: 'public-safe.md',
			content: '# Public safe',
			share_key: shareKey,
			share_enabled: true,
			public_permission: 'view',
		})
		const server = ctx.createProxyServer({
			user,
			organization: ctx.defaultOrganization,
			key: `shared-${randomUUID()}`,
		})
		const collection = await ctx.createSharedArtifactCollection({ server, artifactId: artifact.id, shareKey })

		const row = await waitForItem(collection, artifact.id, { timeout: 10_000 })
		expect(
			Object.keys(row)
				.filter((key) => !key.startsWith('$'))
				.sort(),
		).toEqual([...PUBLIC_ARTIFACT_COLUMNS].sort())
		expect(row).toMatchObject({ id: artifact.id, file_name: 'public-safe.md', content: '# Public safe' })
	})

	test('rejects wrong and revoked capabilities without exposing a row', async () => {
		const shareKey = randomUUID()
		const user = createTestUser('revoked-artifact-owner')
		const task = await ctx.seedTask({
			organization_id: ctx.defaultOrganization.id,
			resource_owner_user_id: user.userId,
			created_by: user.userId,
			name: 'Revoked artifact task',
		})
		const artifact = await ctx.seedArtifact({
			organization_id: ctx.defaultOrganization.id,
			resource_owner_user_id: user.userId,
			task_id: task.id,
			task_slug: task.slug,
			file_name: 'revoked.md',
			content: '# Revoked',
			share_key: shareKey,
			share_enabled: true,
			public_permission: 'view',
		})
		const server = ctx.createProxyServer({
			user,
			organization: ctx.defaultOrganization,
			key: `shared-denied-${randomUUID()}`,
		})
		const request = (key: string) =>
			fetch(`http://localhost:${server.port}/v1/shared/artifacts/${artifact.id}`, {
				method: 'POST',
				headers: { 'x-share-key': key },
			})
		const wrongKeyResponse = await request('wrong-key')
		expect(wrongKeyResponse.status).toBe(404)

		await ctx.db
			.update(artifacts)
			.set({ share_enabled: false, public_permission: 'off' })
			.where(eq(artifacts.id, artifact.id))
		const revokedResponse = await request(shareKey)
		expect(revokedResponse.status).toBe(404)
	})

	test('rejects artifact and comment shapes while the org disallows public links', async () => {
		const shareKey = randomUUID()
		const user = createTestUser('org-policy-artifact-owner')
		const organization = await ctx.seedOrganization({})
		const task = await ctx.seedTask({
			organization_id: organization.id,
			resource_owner_user_id: user.userId,
			created_by: user.userId,
			name: 'Org policy task',
		})
		// Leave the artifact row shared so only the org policy can deny access.
		const artifact = await ctx.seedArtifact({
			organization_id: organization.id,
			resource_owner_user_id: user.userId,
			task_id: task.id,
			task_slug: task.slug,
			file_name: 'org-policy.md',
			content: '# Org policy',
			share_key: shareKey,
			share_enabled: true,
			public_permission: 'comment',
		})
		await ctx.db
			.insert(organizationSettings)
			.values({ organization_id: organization.id, enable_creating_publicly_shareable_links: false })
		const server = ctx.createProxyServer({
			user,
			organization: ctx.defaultOrganization,
			key: `shared-org-policy-${randomUUID()}`,
		})
		const request = (path: string) =>
			fetch(`http://localhost:${server.port}/v1/shared/artifacts/${artifact.id}${path}`, {
				method: 'POST',
				headers: { 'x-share-key': shareKey },
			})

		expect((await request('')).status).toBe(404)
		expect((await request('/comments')).status).toBe(404)
	})

	test('rejects malformed artifact IDs', async () => {
		const user = createTestUser('malformed-artifact-request')
		const server = ctx.createProxyServer({
			user,
			organization: ctx.defaultOrganization,
			key: `shared-malformed-${randomUUID()}`,
		})
		const response = await fetch(`http://localhost:${server.port}/v1/shared/artifacts/not-a-uuid`, {
			method: 'POST',
			headers: { 'x-share-key': 'share-key' },
		})
		expect(response.status).toBe(400)
	})
})
