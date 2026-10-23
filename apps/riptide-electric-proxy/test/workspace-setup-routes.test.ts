import { randomUUID } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'

import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { createElectricTestContext, createTestUser, type ElectricTestContext, waitForItem } from './fixtures'

const CI = Boolean(process.env.CI)

describe.skipIf(CI)('workspace setup Electric routes', () => {
	let ctx: ElectricTestContext

	beforeAll(async () => {
		ctx = await createElectricTestContext()
	})

	afterAll(async () => {
		await ctx.shutdown()
	})

	test('v2 user route exposes setup rows to members of the same organization', async () => {
		const owner = createTestUser(`workspace-owner-${randomUUID()}`)
		const viewer = createTestUser(`workspace-viewer-${randomUUID()}`)
		const server = ctx.createProxyServer({
			user: viewer,
			organization: ctx.defaultOrganization,
			key: `workspace-v2-${randomUUID()}`,
		})
		const collection = await ctx.createTaskWorkspaceSetupForHostV2Collection({ server })
		const task = await ctx.seedTask({
			organization_id: ctx.defaultOrganization.id,
			name: 'Workspace setup v2 visibility',
			created_by: owner.userId,
			resource_owner_user_id: owner.userId,
		})
		const row = await ctx.seedTaskWorkspaceSetupForHost({
			organization_id: ctx.defaultOrganization.id,
			task_id: task.id,
			host_id: randomUUID(),
			status: 'preflight',
			workspace_setup_state: { specVersion: 1, repos: [{ localPath: '.', status: 'preflight' }] },
		})

		await waitForItem(collection, row.id, { timeout: 10_000 })
		expect(collection.has(row.id)).toBe(true)
	})

	test('v2 user route preserves organization isolation', async () => {
		const owner = createTestUser(`workspace-owner-${randomUUID()}`)
		const viewer = createTestUser(`workspace-cross-org-${randomUUID()}`)
		const otherOrganization = await ctx.seedOrganization({ name: `Workspace Other Org ${randomUUID()}` })
		const server = ctx.createProxyServer({
			user: viewer,
			organization: otherOrganization,
			key: `workspace-cross-org-${randomUUID()}`,
		})
		const collection = await ctx.createTaskWorkspaceSetupForHostV2Collection({ server })
		const task = await ctx.seedTask({
			organization_id: ctx.defaultOrganization.id,
			name: 'Workspace setup cross-org isolation',
			created_by: owner.userId,
			resource_owner_user_id: owner.userId,
		})
		const row = await ctx.seedTaskWorkspaceSetupForHost({
			organization_id: ctx.defaultOrganization.id,
			task_id: task.id,
			host_id: randomUUID(),
			status: 'setup_requested',
			workspace_setup_state: { specVersion: 1, repos: [{ localPath: '.', status: 'setup_requested' }] },
		})

		await sleep(1_500)
		expect(collection.has(row.id)).toBe(false)
	})

	test('daemon route exposes only rows for the host in the daemon token', async () => {
		const owner = createTestUser(`workspace-daemon-${randomUUID()}`)
		const hostId = randomUUID()
		const otherHostId = randomUUID()
		const otherOrganization = await ctx.seedOrganization({ name: `Workspace Daemon Other Org ${randomUUID()}` })
		const server = ctx.createProxyServer({
			user: owner,
			organization: ctx.defaultOrganization,
			hostId,
			key: `workspace-daemon-${randomUUID()}`,
		})
		const collection = await ctx.createDaemonWorkspaceSetupCollection({ server })
		const task = await ctx.seedTask({
			organization_id: ctx.defaultOrganization.id,
			name: 'Workspace setup daemon host scope',
			created_by: owner.userId,
			resource_owner_user_id: owner.userId,
		})
		const matching = await ctx.seedTaskWorkspaceSetupForHost({
			organization_id: ctx.defaultOrganization.id,
			task_id: task.id,
			host_id: hostId,
			status: 'worktree',
			workspace_setup_state: { specVersion: 1, repos: [{ localPath: '.', status: 'worktree' }] },
		})
		const other = await ctx.seedTaskWorkspaceSetupForHost({
			organization_id: ctx.defaultOrganization.id,
			task_id: task.id,
			host_id: otherHostId,
			status: 'done',
			workspace_setup_state: { specVersion: 1, repos: [{ localPath: '.', status: 'done' }] },
		})
		const otherOrganizationTask = await ctx.seedTask({
			organization_id: otherOrganization.id,
			name: 'Workspace setup daemon organization scope',
			created_by: owner.userId,
			resource_owner_user_id: owner.userId,
		})
		const otherOrganizationRow = await ctx.seedTaskWorkspaceSetupForHost({
			organization_id: otherOrganization.id,
			task_id: otherOrganizationTask.id,
			host_id: hostId,
			status: 'setup_requested',
			workspace_setup_state: { specVersion: 1, repos: [{ localPath: '.', status: 'setup_requested' }] },
		})

		await waitForItem(collection, matching.id, { timeout: 10_000 })
		await sleep(1_000)
		expect(collection.has(matching.id)).toBe(true)
		expect(collection.has(other.id)).toBe(false)
		expect(collection.has(otherOrganizationRow.id)).toBe(false)
	})
})
