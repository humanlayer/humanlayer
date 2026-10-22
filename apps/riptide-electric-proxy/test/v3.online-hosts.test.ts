import { randomUUID } from 'node:crypto'

import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { createElectricTestContext, createTestUser, type ElectricTestContext, waitForItem } from './fixtures'

const CI = !!process.env.CI

/**
 * Sync v3 Online Hosts Tests
 *
 * /v3/hosts keeps the org-wide visibility of /v2/hosts and synchronizes the
 * complete durable registration, including heartbeat timestamps and status.
 */
describe.skipIf(CI)('/v3/hosts sync tests', () => {
	let ctx: ElectricTestContext

	beforeAll(async () => {
		ctx = await createElectricTestContext()
	})

	afterAll(async () => {
		await ctx.shutdown()
	})

	const getHostKey = (host: { host_id: string; organization_id: string; user_id: string }) =>
		JSON.stringify([host.host_id, host.organization_id, host.user_id])

	test('B1: shape snapshot rows include last_seen and status', async () => {
		const testId = randomUUID().slice(0, 8)
		const owner = createTestUser(`v3_hosts_b1_owner_${testId}`)

		const server = ctx.createProxyServer({
			user: owner,
			organization: ctx.defaultOrganization,
			key: `v3_hosts_b1_${testId}`,
		})

		const host = await ctx.seedOnlineHost({
			host_id: randomUUID(),
			user_id: owner.userId,
			organization_id: ctx.defaultOrganization.id,
			host_name: `host-b1-${testId}`,
			last_seen: BigInt(Date.now()),
		})

		const response = await fetch(`http://localhost:${server.port}/v3/hosts?offset=-1`)
		expect(response.status).toBe(200)

		const messages = (await response.json()) as Array<{ value?: Record<string, unknown> }>
		const row = messages.map((m) => m.value).find((v) => v?.host_id === host.host_id)
		expect(row).toBeDefined()
		expect(row?.host_name).toBe(host.host_name)
		expect(row?.last_seen).toBe(host.last_seen.toString())
		expect(row?.status).toBe('online')
	})

	test('B2: last_seen-only update reaches v3 clients', async () => {
		const testId = randomUUID().slice(0, 8)
		const owner = createTestUser(`v3_hosts_b2_owner_${testId}`)

		const server = ctx.createProxyServer({
			user: owner,
			organization: ctx.defaultOrganization,
			key: `v3_hosts_b2_${testId}`,
		})

		const hostsCollection = await ctx.createHostsV3Collection({ server })

		const host = await ctx.seedOnlineHost({
			host_id: randomUUID(),
			user_id: owner.userId,
			organization_id: ctx.defaultOrganization.id,
			host_name: `host-b2-${testId}`,
			last_seen: BigInt(Date.now()),
		})
		const hostKey = getHostKey(host)
		await waitForItem(hostsCollection, hostKey, { timeout: 10_000 })

		const hostChanges: unknown[] = []
		const subscription = hostsCollection.subscribeChanges(
			(changes: Array<{ key: string | number }>) => {
				for (const change of changes) {
					if (change.key === hostKey) hostChanges.push(change)
				}
			},
			{ includeInitialState: false },
		)

		const updatedLastSeen = BigInt(Date.now() + 1_000)
		await ctx.withElectricSentinel(hostsCollection, async (tx) => {
			await tx
				.update(ctx.tables.onlineHosts)
				.set({ last_seen: updatedLastSeen })
				.where(
					and(
						eq(ctx.tables.onlineHosts.host_id, host.host_id),
						eq(ctx.tables.onlineHosts.organization_id, ctx.defaultOrganization.id),
					),
				)
			const [sentinel] = await tx
				.insert(ctx.tables.onlineHosts)
				.values({
					host_id: randomUUID(),
					user_id: owner.userId,
					organization_id: ctx.defaultOrganization.id,
					host_name: `host-b2-sentinel-${testId}`,
					last_seen: BigInt(Date.now()),
				})
				.returning()
			if (!sentinel) throw new Error('Failed to seed sentinel host')
			return { result: sentinel, sentinelId: getHostKey(sentinel) }
		})

		subscription.unsubscribe()
		expect(hostChanges.length).toBeGreaterThan(0)
		expect(hostsCollection.get(hostKey)?.last_seen).toBe(updatedLastSeen)
	})

	test('B3: offline transition updates the v3 row without deleting it', async () => {
		const testId = randomUUID().slice(0, 8)
		const owner = createTestUser(`v3_hosts_b3_owner_${testId}`)

		const server = ctx.createProxyServer({
			user: owner,
			organization: ctx.defaultOrganization,
			key: `v3_hosts_b3_${testId}`,
		})

		const hostsCollection = await ctx.createHostsV3Collection({ server })

		const host = await ctx.seedOnlineHost({
			host_id: randomUUID(),
			user_id: owner.userId,
			organization_id: ctx.defaultOrganization.id,
			host_name: `host-b3-${testId}`,
			last_seen: BigInt(Date.now()),
		})
		const hostKey = getHostKey(host)
		await waitForItem(hostsCollection, hostKey, { timeout: 10_000 })

		await ctx.withElectricSentinel(hostsCollection, async (tx) => {
			await tx
				.update(ctx.tables.onlineHosts)
				.set({ status: 'offline' })
				.where(
					and(
						eq(ctx.tables.onlineHosts.host_id, host.host_id),
						eq(ctx.tables.onlineHosts.organization_id, ctx.defaultOrganization.id),
					),
				)
			const [sentinel] = await tx
				.insert(ctx.tables.onlineHosts)
				.values({
					host_id: randomUUID(),
					user_id: owner.userId,
					organization_id: ctx.defaultOrganization.id,
					host_name: `host-b3-sentinel-${testId}`,
					last_seen: BigInt(Date.now()),
				})
				.returning()
			if (!sentinel) throw new Error('Failed to seed sentinel host')
			return { result: sentinel, sentinelId: getHostKey(sentinel) }
		})

		expect(hostsCollection.has(hostKey)).toBe(true)
		expect(hostsCollection.get(hostKey)?.status).toBe('offline')
	})

	test('B4: cross-org user does NOT see online host via v3 (org boundary preserved)', async () => {
		const testId = randomUUID().slice(0, 8)
		const owner = createTestUser(`v3_hosts_b4_owner_${testId}`)
		const crossOrgUser = createTestUser(`v3_hosts_b4_crossorg_${testId}`)

		const otherOrg = await ctx.seedOrganization({ name: `V3 Hosts B4 Other Org ${testId}` })

		const crossOrgServer = ctx.createProxyServer({
			user: crossOrgUser,
			organization: otherOrg,
			key: `v3_hosts_b4_crossorg_${testId}`,
		})

		const crossOrgCollection = await ctx.createHostsV3Collection({ server: crossOrgServer })

		const host = await ctx.withElectricSentinel(crossOrgCollection, async (tx) => {
			const [denied] = await tx
				.insert(ctx.tables.onlineHosts)
				.values({
					host_id: randomUUID(),
					user_id: owner.userId,
					organization_id: ctx.defaultOrganization.id,
					host_name: `host-b4-${testId}`,
					last_seen: BigInt(Date.now()),
				})
				.returning()
			const [sentinel] = await tx
				.insert(ctx.tables.onlineHosts)
				.values({
					host_id: randomUUID(),
					user_id: crossOrgUser.userId,
					organization_id: otherOrg.id,
					host_name: `host-b4-sentinel-${testId}`,
					last_seen: BigInt(Date.now()),
				})
				.returning()
			if (!denied || !sentinel) throw new Error('Failed to seed online host barrier')
			return { result: denied, sentinelId: getHostKey(sentinel) }
		})

		expect(crossOrgCollection.has(getHostKey(host))).toBe(false)
	})
})
