import { randomUUID } from 'node:crypto'

import {
	createDaemonWorkspaceSetupCollection,
	createTaskWorkspaceSetupForHostV2Collection,
	createTestUser,
	waitFor,
	waitForReady,
} from '@humanlayer/test-fixtures'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { createEquivalencyTestContext, type EquivalencyTestContext } from '../fixtures/equivalency-context'

const CI = Boolean(process.env.CI)

type WorkspaceSetupSyncRow = ReturnType<typeof createTaskWorkspaceSetupForHostV2Collection>['toArray'][number]
type WorkspaceSetupRows = { readonly toArray: readonly WorkspaceSetupSyncRow[] }

const ids = (collection: WorkspaceSetupRows) => collection.toArray.map((row) => row.id).sort()

const rowById = (collection: WorkspaceSetupRows, id: string): WorkspaceSetupSyncRow | undefined =>
	collection.toArray.find((row) => row.id === id)

describe.skipIf(CI)('workspace setup sync equivalency', () => {
	let ctx: EquivalencyTestContext
	const owner = createTestUser(`workspace-sync-owner-${randomUUID()}`)
	const hostId = randomUUID()
	const otherHostId = randomUUID()
	let matchingRowId: string
	let otherHostRowId: string
	let otherOrganizationRowId: string

	beforeAll(async () => {
		ctx = await createEquivalencyTestContext()
		const task = await ctx.seedTask({
			organization_id: ctx.defaultOrganization.id,
			name: 'Workspace setup sync equivalency task',
			created_by: owner.userId,
			resource_owner_user_id: owner.userId,
		})
		const matching = await ctx.seedTaskWorkspaceSetupForHost({
			organization_id: ctx.defaultOrganization.id,
			task_id: task.id,
			host_id: hostId,
			status: 'preflight',
			workspace_setup_state: { specVersion: 1, repos: [{ localPath: '.', status: 'preflight' }] },
		})
		const other = await ctx.seedTaskWorkspaceSetupForHost({
			organization_id: ctx.defaultOrganization.id,
			task_id: task.id,
			host_id: otherHostId,
			status: 'done',
			workspace_setup_state: { specVersion: 1, repos: [{ localPath: '.', status: 'done' }] },
		})
		const otherOrganization = await ctx.seedOrganization({ name: `Workspace Sync Other Org ${randomUUID()}` })
		const otherOrganizationTask = await ctx.seedTask({
			organization_id: otherOrganization.id,
			name: 'Workspace setup sync other organization task',
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
		matchingRowId = matching.id
		otherHostRowId = other.id
		otherOrganizationRowId = otherOrganizationRow.id
	})

	afterAll(async () => {
		await ctx?.shutdown()
	})

	test('user Electric and v2 query fallback expose the same organization-scoped rows', async () => {
		const proxyServer = ctx.createProxyServer({
			user: owner,
			organization: ctx.defaultOrganization,
			key: `workspace-user-electric-${randomUUID()}`,
		})
		const apiServer = ctx.createApiServer({
			userId: owner.userId,
			organizationId: ctx.defaultOrganization.id,
			workosOrganizationId: ctx.defaultOrganization.workosOrganizationId,
			role: '',
			roles: [],
			permissions: [],
			entitlements: [],
			sessionId: 'workspace-sync-user',
		})
		const apiClient = ctx.createApiClient(apiServer)
		const electric = createTaskWorkspaceSetupForHostV2Collection({ server: proxyServer })
		const query = ctx.createQueryTaskWorkspaceSetupForHostCollection({
			apiClient,
			id: `workspace-user-query-${randomUUID()}`,
			refetchInterval: 500,
		})
		const electricSubscription = electric.subscribeChanges(() => {}, { includeInitialState: true })
		const querySubscription = query.subscribeChanges(() => {}, { includeInitialState: true })

		try {
			await waitForReady(electric, { timeout: 30_000 })
			await waitForReady(query, { timeout: 15_000 })
			await waitFor(() => electric.has(matchingRowId) && electric.has(otherHostRowId), { timeout: 15_000 })
			await waitFor(() => query.has(matchingRowId) && query.has(otherHostRowId), { timeout: 15_000 })

			expect(ids(electric)).toEqual(ids(query))
			expect(ids(electric)).toEqual(expect.arrayContaining([matchingRowId, otherHostRowId]))
			expect(electric.has(otherOrganizationRowId)).toBe(false)
			expect(query.has(otherOrganizationRowId)).toBe(false)

			await ctx.updateTaskWorkspaceSetupForHost(matchingRowId, {
				status: 'setup_command',
				workspace_setup_state: {
					specVersion: 1,
					repos: [
						{
							localPath: '.',
							status: 'setup_command',
							setupCommand: { command: 'bun install', exitCode: 1 },
						},
					],
				},
				error: {
					localPath: '.',
					stage: 'setup_command',
					message: 'Dependency installation failed',
					command: 'bun install',
					exitCode: 1,
					stderr: 'install failed',
				},
			})

			await waitFor(() => rowById(electric, matchingRowId)?.status === 'setup_command', { timeout: 15_000 })
			await waitFor(() => rowById(query, matchingRowId)?.status === 'setup_command', { timeout: 15_000 })

			const electricUpdated = rowById(electric, matchingRowId)
			const queryUpdated = rowById(query, matchingRowId)
			expect(electricUpdated?.workspace_setup_state?.repos[0]?.setupCommand?.command).toBe('bun install')
			expect(queryUpdated?.workspace_setup_state?.repos[0]?.setupCommand?.command).toBe('bun install')
			expect(electricUpdated?.error?.stage).toBe('setup_command')
			expect(queryUpdated?.error?.stage).toBe('setup_command')
		} finally {
			electricSubscription.unsubscribe()
			querySubscription.unsubscribe()
			await electric.cleanup()
			await query.cleanup()
		}
	})

	test('daemon Electric and query fallback expose the same token-host-scoped rows', async () => {
		const proxyServer = ctx.createProxyServer({
			user: owner,
			organization: ctx.defaultOrganization,
			hostId,
			key: `workspace-daemon-electric-${randomUUID()}`,
		})
		const daemonServer = ctx.createDaemonApiServer({
			userId: owner.userId,
			organizationId: ctx.defaultOrganization.id,
			hostId,
		})
		const daemonApiClient = ctx.createDaemonApiClient(daemonServer)
		const electric = createDaemonWorkspaceSetupCollection({ server: proxyServer })
		const query = ctx.createQueryDaemonWorkspaceSetupCollection({
			daemonApiClient,
			id: `workspace-daemon-query-${randomUUID()}`,
			refetchInterval: 500,
		})
		const electricSubscription = electric.subscribeChanges(() => {}, { includeInitialState: true })
		const querySubscription = query.subscribeChanges(() => {}, { includeInitialState: true })

		try {
			await waitForReady(electric, { timeout: 30_000 })
			await waitForReady(query, { timeout: 15_000 })
			await waitFor(() => electric.has(matchingRowId), { timeout: 15_000 })
			await waitFor(() => query.has(matchingRowId), { timeout: 15_000 })

			expect(ids(electric)).toEqual(ids(query))
			expect(electric.has(otherHostRowId)).toBe(false)
			expect(query.has(otherHostRowId)).toBe(false)
			expect(electric.has(otherOrganizationRowId)).toBe(false)
			expect(query.has(otherOrganizationRowId)).toBe(false)
		} finally {
			electricSubscription.unsubscribe()
			querySubscription.unsubscribe()
			await electric.cleanup()
			await query.cleanup()
		}
	})
})
