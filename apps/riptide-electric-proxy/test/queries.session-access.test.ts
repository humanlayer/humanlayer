import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'

import { organizationSettings } from '@humanlayer/db/tables/organization-settings'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { canReadSession } from '../src/lib/queries'
import { createElectricTestContext, createTestUser, type ElectricTestContext } from './fixtures'

describe('canReadSession', () => {
	let ctx: ElectricTestContext

	beforeAll(async () => {
		ctx = await createElectricTestContext()
	})

	afterAll(async () => {
		await ctx.shutdown()
	})

	async function seedStandaloneSession(input: {
		ownerUserId: string
		organizationId?: string
		multiplayerUserIds?: string[]
		startedAt?: bigint | null
		expiresAt?: bigint | null
	}) {
		return ctx.seedSession({
			resource_owner_user_id: input.ownerUserId,
			organization_id: input.organizationId ?? ctx.defaultOrganization.id,
			working_directory: tmpdir(),
			status: 'ready_for_input',
			host_id: randomUUID(),
			created_by: input.ownerUserId,
			multiplayer_prompting_user_ids: input.multiplayerUserIds ?? [],
			multiplayer_prompting_started_at: input.startedAt,
			multiplayer_prompting_expires_at: input.expiresAt,
		})
	}

	test('allows the standalone session owner', async () => {
		const owner = createTestUser('stream_owner')
		const session = await seedStandaloneSession({ ownerUserId: owner.userId })

		await expect(canReadSession(ctx.db, session.id, owner.userId, ctx.defaultOrganization.id)).resolves.toBe(true)
	})

	test.each(['read', 'edit'] as const)('allows a task user with %s access', async (permissionLevel) => {
		const owner = createTestUser(`task_${permissionLevel}_owner`)
		const collaborator = createTestUser(`task_${permissionLevel}_collaborator`)
		const task = await ctx.seedTask({
			name: `Stream ${permissionLevel} task`,
			resource_owner_user_id: owner.userId,
			organization_id: ctx.defaultOrganization.id,
			created_by: owner.userId,
		})
		const session = await ctx.seedSession({
			resource_owner_user_id: owner.userId,
			organization_id: ctx.defaultOrganization.id,
			task_id: task.id,
			working_directory: tmpdir(),
			status: 'ready_for_input',
			host_id: randomUUID(),
			created_by: owner.userId,
		})
		await ctx.seedTaskUserAcl({
			task_id: task.id,
			subject_user_id: collaborator.userId,
			organization_id: ctx.defaultOrganization.id,
			resource_owner_user_id: owner.userId,
			permission_level: permissionLevel,
			granted_by: owner.userId,
		})

		await expect(canReadSession(ctx.db, session.id, collaborator.userId, ctx.defaultOrganization.id)).resolves.toBe(
			true,
		)
	})

	test('allows the task owner', async () => {
		const owner = createTestUser('task_owner')
		const task = await ctx.seedTask({
			name: 'Owner stream task',
			resource_owner_user_id: owner.userId,
			organization_id: ctx.defaultOrganization.id,
			created_by: owner.userId,
		})
		const session = await ctx.seedSession({
			resource_owner_user_id: owner.userId,
			organization_id: ctx.defaultOrganization.id,
			task_id: task.id,
			working_directory: tmpdir(),
			status: 'ready_for_input',
			host_id: randomUUID(),
			created_by: owner.userId,
		})

		await expect(canReadSession(ctx.db, session.id, owner.userId, ctx.defaultOrganization.id)).resolves.toBe(true)
	})

	test('allows a task user through the organization ACL', async () => {
		const owner = createTestUser('task_org_owner')
		const collaborator = createTestUser('task_org_collaborator')
		const task = await ctx.seedTask({
			name: 'Organization-shared stream task',
			resource_owner_user_id: owner.userId,
			organization_id: ctx.defaultOrganization.id,
			created_by: owner.userId,
		})
		const session = await ctx.seedSession({
			resource_owner_user_id: owner.userId,
			organization_id: ctx.defaultOrganization.id,
			task_id: task.id,
			working_directory: tmpdir(),
			status: 'ready_for_input',
			host_id: randomUUID(),
			created_by: owner.userId,
		})
		await ctx.seedTaskOrganizationAcl({
			task_id: task.id,
			organization_id: ctx.defaultOrganization.id,
			resource_owner_user_id: owner.userId,
			permission_level: 'read',
			granted_by: owner.userId,
		})

		await expect(canReadSession(ctx.db, session.id, collaborator.userId, ctx.defaultOrganization.id)).resolves.toBe(
			true,
		)
	})

	test('allows an active standalone multiplayer collaborator', async () => {
		const owner = createTestUser('active_grant_owner')
		const collaborator = createTestUser('active_grant_collaborator')
		const now = Date.now()
		const session = await seedStandaloneSession({
			ownerUserId: owner.userId,
			multiplayerUserIds: [collaborator.userId],
			startedAt: BigInt(now - 1_000),
			expiresAt: BigInt(now + 60_000),
		})
		await ctx.db
			.insert(organizationSettings)
			.values({ organization_id: ctx.defaultOrganization.id, multiplayer_prompting_enabled: true })
			.onConflictDoUpdate({
				target: organizationSettings.organization_id,
				set: { multiplayer_prompting_enabled: true },
			})

		await expect(canReadSession(ctx.db, session.id, collaborator.userId, ctx.defaultOrganization.id)).resolves.toBe(
			true,
		)
	})

	test.each([
		{ name: 'expired', enabled: true, onRoster: true, expiresOffset: -1 },
		{ name: 'disabled', enabled: false, onRoster: true, expiresOffset: 60_000 },
		{ name: 'removed', enabled: true, onRoster: false, expiresOffset: 60_000 },
	] as const)('denies a $name standalone multiplayer grant', async ({ enabled, onRoster, expiresOffset }) => {
		const owner = createTestUser(`denied_grant_owner_${randomUUID()}`)
		const collaborator = createTestUser(`denied_grant_collaborator_${randomUUID()}`)
		const now = Date.now()
		const session = await seedStandaloneSession({
			ownerUserId: owner.userId,
			multiplayerUserIds: onRoster ? [collaborator.userId] : [],
			startedAt: BigInt(now - 1_000),
			expiresAt: BigInt(now + expiresOffset),
		})
		await ctx.db
			.update(organizationSettings)
			.set({ multiplayer_prompting_enabled: enabled })
			.where(eq(organizationSettings.organization_id, ctx.defaultOrganization.id))

		await expect(canReadSession(ctx.db, session.id, collaborator.userId, ctx.defaultOrganization.id)).resolves.toBe(
			false,
		)
	})

	test('denies access across organizations', async () => {
		const owner = createTestUser('cross_org_owner')
		const collaborator = createTestUser('cross_org_collaborator')
		const otherOrganization = await ctx.seedOrganization({ name: 'Other stream organization' })
		const now = Date.now()
		const session = await seedStandaloneSession({
			ownerUserId: owner.userId,
			multiplayerUserIds: [collaborator.userId],
			startedAt: BigInt(now - 1_000),
			expiresAt: BigInt(now + 60_000),
		})

		await expect(canReadSession(ctx.db, session.id, collaborator.userId, otherOrganization.id)).resolves.toBe(false)
	})
})
