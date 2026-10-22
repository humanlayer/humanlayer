import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'

import { approvals } from '@humanlayer/db/tables/approvals'
import { hostAliases } from '@humanlayer/db/tables/host-aliases'
import { onlineHosts } from '@humanlayer/db/tables/online-hosts'
import { organizations } from '@humanlayer/db/tables/organizations'
import { sessions } from '@humanlayer/db/tables/sessions'
import { call } from '@orpc/server'
import { and, eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { heartbeatEffectProcedure as liveHeartbeatProcedure } from '../../src/orpc/daemon/hosts/heartbeat.effect'
import { createMockDaemonAuth, createMockDaemonContext } from '../mocks'
import { bindProcedureToRuntime, createRuntimeWithTestPostgresLayer } from '../utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('daemon/hosts/heartbeat', async () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let effectRuntime: ReturnType<typeof createRuntimeWithTestPostgresLayer> | undefined
	let heartbeatProcedure: typeof liveHeartbeatProcedure
	let organizationId: string
	let otherOrganizationId: string

	const userId = 'user_daemon_123'

	beforeAll(async () => {
		const testDb = await createTestDb('daemon_heartbeat')
		cleanupTestDb = testDb.cleanup
		db = testDb.db
		effectRuntime = createRuntimeWithTestPostgresLayer(db)
		heartbeatProcedure = bindProcedureToRuntime(liveHeartbeatProcedure, effectRuntime)

		const [organization, otherOrganization] = await db
			.insert(organizations)
			.values([
				{ name: 'Heartbeat Org', workos_organization_id: `org_${randomUUID()}` },
				{ name: 'Other Heartbeat Org', workos_organization_id: `org_${randomUUID()}` },
			])
			.returning()

		organizationId = organization!.id
		otherOrganizationId = otherOrganization!.id
	})

	afterAll(async () => {
		await effectRuntime?.dispose()
		await cleanupTestDb?.()
	}, 30000)

	const createDaemonContext = (input: { hostId: string; organizationId?: string; userId?: string }) => ({
		context: createMockDaemonContext({
			auth: createMockDaemonAuth({
				hostId: input.hostId,
				organizationId: input.organizationId ?? organizationId,
				userId: input.userId ?? userId,
			}),
			services: { db, dbReadReplica: db },
		}),
	})

	const selectHost = async (hostId: string, hostOrganizationId: string, hostUserId: string) => {
		const [host] = await db
			.select()
			.from(onlineHosts)
			.where(
				and(
					eq(onlineHosts.host_id, hostId),
					eq(onlineHosts.organization_id, hostOrganizationId),
					eq(onlineHosts.user_id, hostUserId),
				),
			)
		return host
	}

	test('returns FORBIDDEN when request hostId does not match daemon token hostId', async () => {
		const authHostId = randomUUID()
		const spoofedHostId = randomUUID()

		await expect(
			call(
				heartbeatProcedure,
				{ hostId: spoofedHostId, hostName: 'spoofed-host' },
				createDaemonContext({ hostId: authHostId }),
			),
		).rejects.toMatchObject({ code: 'FORBIDDEN' })

		expect(await selectHost(spoofedHostId, organizationId, userId)).toBeUndefined()
	})

	test('inserts a host registration with online status', async () => {
		const hostId = randomUUID()

		await call(heartbeatProcedure, { hostId, hostName: 'new-host' }, createDaemonContext({ hostId }))

		expect(await selectHost(hostId, organizationId, userId)).toMatchObject({
			host_id: hostId,
			host_name: 'new-host',
			organization_id: organizationId,
			status: 'online',
			user_id: userId,
			ephemeral: false,
		})
	})

	for (const ephemeral of [true, false]) {
		test(`inserts ephemeral=${ephemeral} and updates it in both directions`, async () => {
			const hostId = randomUUID()
			for (const reported of [ephemeral, !ephemeral, ephemeral]) {
				const result = await call(
					heartbeatProcedure,
					{ hostId, hostName: 'host', ephemeral: reported },
					createDaemonContext({ hostId }),
				)
				expect(result).toEqual({ updateRequest: null })
				expect(await selectHost(hostId, organizationId, userId)).toMatchObject({
					ephemeral: reported,
					status: 'online',
				})
			}
		})
	}

	test('resets an ephemeral registration when an older daemon omits the field', async () => {
		const hostId = randomUUID()
		await call(heartbeatProcedure, { hostId, hostName: 'host', ephemeral: true }, createDaemonContext({ hostId }))
		expect(await selectHost(hostId, organizationId, userId)).toMatchObject({ ephemeral: true })

		const result = await call(heartbeatProcedure, { hostId, hostName: 'host' }, createDaemonContext({ hostId }))
		expect(result).toEqual({ updateRequest: null })
		expect(await selectHost(hostId, organizationId, userId)).toMatchObject({ ephemeral: false })
	})

	test('recreates a removed ephemeral registration without restoring its removed alias', async () => {
		const hostId = randomUUID()
		const registration = and(
			eq(onlineHosts.host_id, hostId),
			eq(onlineHosts.organization_id, organizationId),
			eq(onlineHosts.user_id, userId),
		)
		const alias = and(
			eq(hostAliases.host_id, hostId),
			eq(hostAliases.organization_id, organizationId),
			eq(hostAliases.user_id, userId),
		)
		await call(heartbeatProcedure, { hostId, hostName: 'host', ephemeral: true }, createDaemonContext({ hostId }))
		await db.insert(hostAliases).values({
			host_id: hostId,
			organization_id: organizationId,
			user_id: userId,
			display_name: 'Removed custom name',
		})
		await db.transaction(async (tx) => {
			await tx.delete(onlineHosts).where(registration)
			await tx.delete(hostAliases).where(alias)
		})
		expect(await selectHost(hostId, organizationId, userId)).toBeUndefined()

		const result = await call(
			heartbeatProcedure,
			{ hostId, hostName: 'returning-host', ephemeral: true },
			createDaemonContext({ hostId }),
		)
		expect(result).toEqual({ updateRequest: null })
		expect(await selectHost(hostId, organizationId, userId)).toMatchObject({
			ephemeral: true,
			status: 'online',
			host_name: 'returning-host',
			update_requested_version: null,
			update_state: null,
		})
		expect(await db.select().from(hostAliases).where(alias)).toEqual([])
	})

	test('records the daemon version and its capabilities', async () => {
		const hostId = randomUUID()

		await call(
			heartbeatProcedure,
			{
				hostId,
				hostName: 'current-host',
				daemonVersion: '0.174.30',
				capabilities: ['reportsRepositories', 'providerLogin'],
			},
			createDaemonContext({ hostId }),
		)

		expect(await selectHost(hostId, organizationId, userId)).toMatchObject({
			daemon_version: '0.174.30',
			capabilities: ['reportsRepositories', 'providerLogin'],
			reports_repositories: true,
		})
	})

	test('keeps reports_repositories for a daemon that predates the capability list', async () => {
		const hostId = randomUUID()

		await call(
			heartbeatProcedure,
			{ hostId, hostName: 'host', daemonVersion: '0.31.170', reportsRepositories: true },
			createDaemonContext({ hostId }),
		)

		expect(await selectHost(hostId, organizationId, userId)).toMatchObject({
			capabilities: null,
			reports_repositories: true,
		})
	})

	test('leaves them null for a daemon too old to send them', async () => {
		const hostId = randomUUID()

		await call(heartbeatProcedure, { hostId, hostName: 'old-host' }, createDaemonContext({ hostId }))

		expect(await selectHost(hostId, organizationId, userId)).toMatchObject({
			daemon_version: null,
			capabilities: null,
			reports_repositories: null,
		})
	})

	test('clears the capabilities when a host downgrades to a daemon that cannot send them', async () => {
		const hostId = randomUUID()

		await call(
			heartbeatProcedure,
			{ hostId, hostName: 'host', daemonVersion: '0.174.30', capabilities: ['reportsRepositories'] },
			createDaemonContext({ hostId }),
		)
		await call(heartbeatProcedure, { hostId, hostName: 'host' }, createDaemonContext({ hostId }))

		expect(await selectHost(hostId, organizationId, userId)).toMatchObject({
			daemon_version: null,
			capabilities: null,
			reports_repositories: null,
		})
	})

	test('accepts a capability name the API does not know', async () => {
		const hostId = randomUUID()

		await call(
			heartbeatProcedure,
			{ hostId, hostName: 'host', capabilities: ['somethingNewer'] },
			createDaemonContext({ hostId }),
		)

		expect(await selectHost(hostId, organizationId, userId)).toMatchObject({
			capabilities: ['somethingNewer'],
			reports_repositories: null,
		})
	})

	test('records the distribution and the self-update capability', async () => {
		const hostId = randomUUID()

		await call(
			heartbeatProcedure,
			{ hostId, hostName: 'cli-host', distribution: 'cli', canSelfUpdate: true },
			createDaemonContext({ hostId }),
		)

		expect(await selectHost(hostId, organizationId, userId)).toMatchObject({
			distribution: 'cli',
			can_self_update: true,
		})
	})

	test('returns a pending update request while the daemon has not started it', async () => {
		const hostId = randomUUID()

		await call(heartbeatProcedure, { hostId, hostName: 'cli-host' }, createDaemonContext({ hostId }))
		await db
			.update(onlineHosts)
			.set({ update_requested_version: '0.31.4', update_state: 'requested' })
			.where(
				and(
					eq(onlineHosts.host_id, hostId),
					eq(onlineHosts.organization_id, organizationId),
					eq(onlineHosts.user_id, userId),
				),
			)

		const result = await call(
			heartbeatProcedure,
			{ hostId, hostName: 'cli-host', daemonVersion: '0.31.0' },
			createDaemonContext({ hostId }),
		)

		expect(result).toEqual({ updateRequest: { version: '0.31.4' } })
	})

	test('stops returning the request once the daemon reports it is installing', async () => {
		const hostId = randomUUID()

		await call(heartbeatProcedure, { hostId, hostName: 'cli-host' }, createDaemonContext({ hostId }))
		await db
			.update(onlineHosts)
			.set({ update_requested_version: '0.31.4', update_state: 'requested' })
			.where(
				and(
					eq(onlineHosts.host_id, hostId),
					eq(onlineHosts.organization_id, organizationId),
					eq(onlineHosts.user_id, userId),
				),
			)

		const result = await call(
			heartbeatProcedure,
			{
				hostId,
				hostName: 'cli-host',
				daemonVersion: '0.31.0',
				update: { version: '0.31.4', state: 'installing' },
			},
			createDaemonContext({ hostId }),
		)

		expect(result).toEqual({ updateRequest: null })
		expect(await selectHost(hostId, organizationId, userId)).toMatchObject({
			update_requested_version: '0.31.4',
			update_state: 'installing',
			update_error: null,
		})
	})

	test('records a failed update with its error and keeps the request pending', async () => {
		const hostId = randomUUID()

		await call(heartbeatProcedure, { hostId, hostName: 'cli-host' }, createDaemonContext({ hostId }))
		await db
			.update(onlineHosts)
			.set({ update_requested_version: '0.31.4', update_state: 'requested' })
			.where(
				and(
					eq(onlineHosts.host_id, hostId),
					eq(onlineHosts.organization_id, organizationId),
					eq(onlineHosts.user_id, userId),
				),
			)

		await call(
			heartbeatProcedure,
			{
				hostId,
				hostName: 'cli-host',
				daemonVersion: '0.31.0',
				update: { version: '0.31.4', state: 'failed', error: 'npm exited with code 1' },
			},
			createDaemonContext({ hostId }),
		)

		expect(await selectHost(hostId, organizationId, userId)).toMatchObject({
			update_requested_version: '0.31.4',
			update_state: 'failed',
			update_error: 'npm exited with code 1',
		})
	})

	test('leaves the recorded update untouched when a beat carries no update', async () => {
		const hostId = randomUUID()

		await call(heartbeatProcedure, { hostId, hostName: 'cli-host' }, createDaemonContext({ hostId }))
		await db
			.update(onlineHosts)
			.set({ update_requested_version: '0.31.4', update_state: 'failed', update_error: 'install failed' })
			.where(
				and(
					eq(onlineHosts.host_id, hostId),
					eq(onlineHosts.organization_id, organizationId),
					eq(onlineHosts.user_id, userId),
				),
			)

		await call(
			heartbeatProcedure,
			{ hostId, hostName: 'cli-host', daemonVersion: '0.31.0' },
			createDaemonContext({ hostId }),
		)

		expect(await selectHost(hostId, organizationId, userId)).toMatchObject({
			update_requested_version: '0.31.4',
			update_state: 'failed',
			update_error: 'install failed',
		})
	})

	test('clears the update once the daemon reports the requested version', async () => {
		const hostId = randomUUID()

		await call(heartbeatProcedure, { hostId, hostName: 'cli-host' }, createDaemonContext({ hostId }))
		await db
			.update(onlineHosts)
			.set({ update_requested_version: '0.31.4', update_state: 'failed', update_error: 'install failed' })
			.where(
				and(
					eq(onlineHosts.host_id, hostId),
					eq(onlineHosts.organization_id, organizationId),
					eq(onlineHosts.user_id, userId),
				),
			)

		const result = await call(
			heartbeatProcedure,
			{ hostId, hostName: 'cli-host', daemonVersion: '0.31.4' },
			createDaemonContext({ hostId }),
		)

		expect(result).toEqual({ updateRequest: null })
		expect(await selectHost(hostId, organizationId, userId)).toMatchObject({
			update_requested_version: null,
			update_state: null,
			update_error: null,
		})
	})

	test('records the machine and its newest load sample', async () => {
		const hostId = randomUUID()
		const machine = {
			os: 'linux 7.0.0',
			arch: 'x64',
			cpuModel: 'AMD EPYC 7763',
			cpuCores: 8,
			memTotalBytes: 34_359_738_368,
			uptimeSec: 967_320,
		}
		const stats = {
			capturedAt: Date.now(),
			cpuPct: 72.5,
			memUsedBytes: 31_000_000_000,
			memTotalBytes: 34_359_738_368,
			memDaemonTreeBytes: 8_400_000_000,
			load1: 14.2,
			load5: 11.8,
			load15: 9.4,
			diskFreeBytes: 408_000_000_000,
			diskTotalBytes: 1_000_000_000_000,
			sessionCount: 6,
		}

		await call(
			heartbeatProcedure,
			{ hostId, hostName: 'busy-host', machine, stats },
			createDaemonContext({ hostId }),
		)

		expect(await selectHost(hostId, organizationId, userId)).toMatchObject({ machine, stats })
	})

	test('leaves the machine and load sample null for a daemon too old to send them', async () => {
		const hostId = randomUUID()

		await call(heartbeatProcedure, { hostId, hostName: 'old-host' }, createDaemonContext({ hostId }))

		expect(await selectHost(hostId, organizationId, userId)).toMatchObject({ machine: null, stats: null })
	})

	test('replaces the load sample on every beat rather than accumulating history', async () => {
		const hostId = randomUUID()
		const baseStats = {
			memUsedBytes: 1_000_000_000,
			memTotalBytes: 34_359_738_368,
			sessionCount: 1,
		}

		await call(
			heartbeatProcedure,
			{ hostId, hostName: 'host', stats: { ...baseStats, capturedAt: 1_000, cpuPct: 10 } },
			createDaemonContext({ hostId }),
		)
		await call(
			heartbeatProcedure,
			{ hostId, hostName: 'host', stats: { ...baseStats, capturedAt: 2_000, cpuPct: 90 } },
			createDaemonContext({ hostId }),
		)

		expect(await selectHost(hostId, organizationId, userId)).toMatchObject({
			stats: { capturedAt: 2_000, cpuPct: 90 },
		})
	})

	test('updates host name and last seen and restores an offline registration to online', async () => {
		const hostId = randomUUID()
		const oldLastSeen = BigInt(Date.now() - 300_000)

		await db.insert(onlineHosts).values({
			host_id: hostId,
			host_name: 'old-host-name',
			last_seen: oldLastSeen,
			organization_id: organizationId,
			status: 'offline',
			user_id: userId,
		})

		await call(heartbeatProcedure, { hostId, hostName: 'new-host-name' }, createDaemonContext({ hostId }))

		const host = await selectHost(hostId, organizationId, userId)
		expect(host).toMatchObject({ host_name: 'new-host-name', status: 'online' })
		expect(host?.last_seen).toBeGreaterThan(oldLastSeen)
	})

	test('does not reap old registrations or change their sessions and approvals', async () => {
		const hostId = randomUUID()
		const otherUserId = 'user_daemon_other'
		const oldLastSeen = BigInt(Date.now() - 300_000)

		await db.insert(onlineHosts).values([
			{
				host_id: hostId,
				host_name: 'calling-host',
				last_seen: oldLastSeen,
				organization_id: organizationId,
				status: 'offline',
				user_id: userId,
			},
			{
				host_id: hostId,
				host_name: 'same-host-other-user',
				last_seen: oldLastSeen,
				organization_id: organizationId,
				user_id: otherUserId,
			},
			{
				host_id: hostId,
				host_name: 'same-host-other-org',
				last_seen: oldLastSeen,
				organization_id: otherOrganizationId,
				user_id: userId,
			},
		])

		const [otherUserSession, otherOrganizationSession] = await db
			.insert(sessions)
			.values([
				{
					coding_agent: 'claude',
					created_by: otherUserId,
					host_id: hostId,
					model: 'claude-sonnet-4-5',
					organization_id: organizationId,
					permissions_mode: 'default',
					provider: 'anthropic',
					resource_owner_user_id: otherUserId,
					status: 'needs_approval',
					title: 'other user session',
					working_directory: tmpdir(),
				},
				{
					coding_agent: 'claude',
					created_by: userId,
					host_id: hostId,
					model: 'claude-sonnet-4-5',
					organization_id: otherOrganizationId,
					permissions_mode: 'default',
					provider: 'anthropic',
					resource_owner_user_id: userId,
					status: 'needs_approval',
					title: 'other organization session',
					working_directory: tmpdir(),
				},
			])
			.returning()

		const [otherUserApproval, otherOrganizationApproval] = await db
			.insert(approvals)
			.values([
				{
					host_id: hostId,
					organization_id: organizationId,
					resource_owner_user_id: otherUserId,
					session_id: otherUserSession!.id,
					status: 'pending',
					tool_input: { command: 'ls' },
					tool_name: 'Bash',
					user_id: otherUserId,
				},
				{
					host_id: hostId,
					organization_id: otherOrganizationId,
					resource_owner_user_id: userId,
					session_id: otherOrganizationSession!.id,
					status: 'pending',
					tool_input: { command: 'ls' },
					tool_name: 'Bash',
					user_id: userId,
				},
			])
			.returning()

		await call(heartbeatProcedure, { hostId, hostName: 'calling-host-updated' }, createDaemonContext({ hostId }))

		const callingHost = await selectHost(hostId, organizationId, userId)
		const otherUserHost = await selectHost(hostId, organizationId, otherUserId)
		const otherOrganizationHost = await selectHost(hostId, otherOrganizationId, userId)
		expect(callingHost).toMatchObject({ host_name: 'calling-host-updated', status: 'online' })
		expect(otherUserHost).toMatchObject({ last_seen: oldLastSeen, status: 'online' })
		expect(otherOrganizationHost).toMatchObject({ last_seen: oldLastSeen, status: 'online' })

		const [otherUserSessionAfter] = await db.select().from(sessions).where(eq(sessions.id, otherUserSession!.id))
		const [otherOrganizationSessionAfter] = await db
			.select()
			.from(sessions)
			.where(eq(sessions.id, otherOrganizationSession!.id))
		const [otherUserApprovalAfter] = await db
			.select()
			.from(approvals)
			.where(eq(approvals.id, otherUserApproval!.id))
		const [otherOrganizationApprovalAfter] = await db
			.select()
			.from(approvals)
			.where(eq(approvals.id, otherOrganizationApproval!.id))

		expect(otherUserSessionAfter?.status).toBe('needs_approval')
		expect(otherOrganizationSessionAfter?.status).toBe('needs_approval')
		expect(otherUserApprovalAfter?.status).toBe('pending')
		expect(otherOrganizationApprovalAfter?.status).toBe('pending')
	})
})
