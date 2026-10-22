import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { createElectricTestContext, createTestUser, type ElectricTestContext, waitForItem } from './fixtures'

const CI = !!process.env.CI

/**
 * Sync v2 Online Hosts Tests
 *
 * These tests verify that the /v2/hosts endpoint exposes
 * org-wide read visibility: any member of the same organization can see all
 * online host entries, without user-scoping.
 *
 * v2 uses buildWhereFragmentForOrgScopedRows which filters only by organization_id,
 * in contrast to v1 which filters by organization_id AND user_id (user can only
 * see their own hosts).
 */
describe.skipIf(CI)('/v2/hosts sync tests', () => {
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
		test('A1: Online host syncs to owning user via v2', async () => {
			const testId = randomUUID().slice(0, 8)
			const owner = createTestUser(`v2_hosts_a1_owner_${testId}`)

			const server = ctx.createProxyServer({
				user: owner,
				organization: ctx.defaultOrganization,
				key: `v2_hosts_a1_${testId}`,
			})

			const hostsCollection = await ctx.createHostsV2Collection({ server })

			const host = await ctx.seedOnlineHost({
				host_id: randomUUID(),
				user_id: owner.userId,
				organization_id: ctx.defaultOrganization.id,
				host_name: `host-a1-${testId}`,
				last_seen: BigInt(Date.now()),
			})

			await waitForItem(hostsCollection, host.host_id, { timeout: 10_000 })
			expect(hostsCollection.has(host.host_id)).toBe(true)
		})

		test('A2: Org member sees another member online host in v2 without user-scoping', async () => {
			const testId = randomUUID().slice(0, 8)
			const owner = createTestUser(`v2_hosts_a2_owner_${testId}`)
			const member = createTestUser(`v2_hosts_a2_member_${testId}`)

			// Member's v2 proxy server — same org, different user
			const memberServer = ctx.createProxyServer({
				user: member,
				organization: ctx.defaultOrganization,
				key: `v2_hosts_a2_member_${testId}`,
			})

			const memberHostsCollection = await ctx.createHostsV2Collection({ server: memberServer })

			const host = await ctx.seedOnlineHost({
				host_id: randomUUID(),
				user_id: owner.userId,
				organization_id: ctx.defaultOrganization.id,
				host_name: `host-a2-${testId}`,
				last_seen: BigInt(Date.now()),
			})

			// v2: member should see owner's host
			await waitForItem(memberHostsCollection, host.host_id, { timeout: 10_000 })
			expect(memberHostsCollection.has(host.host_id)).toBe(true)
		})

		test('A3: Cross-org user does NOT see online host via v2 (org boundary is preserved)', async () => {
			const testId = randomUUID().slice(0, 8)
			const owner = createTestUser(`v2_hosts_a3_owner_${testId}`)
			const crossOrgUser = createTestUser(`v2_hosts_a3_crossorg_${testId}`)

			// Create a second organization
			const otherOrg = await ctx.seedOrganization({ name: `V2 Hosts A3 Other Org ${testId}` })

			const crossOrgServer = ctx.createProxyServer({
				user: crossOrgUser,
				organization: otherOrg,
				key: `v2_hosts_a3_crossorg_${testId}`,
			})

			const crossOrgCollection = await ctx.createHostsV2Collection({ server: crossOrgServer })

			const host = await ctx.withElectricSentinel(crossOrgCollection, async (tx) => {
				const [denied] = await tx
					.insert(ctx.tables.onlineHosts)
					.values({
						host_id: randomUUID(),
						user_id: owner.userId,
						organization_id: ctx.defaultOrganization.id,
						host_name: `host-a3-${testId}`,
						last_seen: BigInt(Date.now()),
					})
					.returning()
				const [sentinel] = await tx
					.insert(ctx.tables.onlineHosts)
					.values({
						host_id: randomUUID(),
						user_id: crossOrgUser.userId,
						organization_id: otherOrg.id,
						host_name: `host-a3-sentinel-${testId}`,
						last_seen: BigInt(Date.now()),
					})
					.returning()
				if (!denied || !sentinel) throw new Error('Failed to seed online host barrier')
				return { result: denied, sentinelId: sentinel.host_id }
			})

			// Cross-org user must NOT see the host
			expect(crossOrgCollection.has(host.host_id)).toBe(false)
		})

		test('A4: All online hosts in org are visible to any org member via v2', async () => {
			const testId = randomUUID().slice(0, 8)
			const userA = createTestUser(`v2_hosts_a4_userA_${testId}`)
			const userB = createTestUser(`v2_hosts_a4_userB_${testId}`)

			const serverA = ctx.createProxyServer({
				user: userA,
				organization: ctx.defaultOrganization,
				key: `v2_hosts_a4_userA_${testId}`,
			})
			const serverB = ctx.createProxyServer({
				user: userB,
				organization: ctx.defaultOrganization,
				key: `v2_hosts_a4_userB_${testId}`,
			})

			const [collectionA, collectionB] = await Promise.all([
				ctx.createHostsV2Collection({ server: serverA }),
				ctx.createHostsV2Collection({ server: serverB }),
			])

			const hostA = await ctx.seedOnlineHost({
				host_id: randomUUID(),
				user_id: userA.userId,
				organization_id: ctx.defaultOrganization.id,
				host_name: `host-a4-A-${testId}`,
				last_seen: BigInt(Date.now()),
			})
			const hostB = await ctx.seedOnlineHost({
				host_id: randomUUID(),
				user_id: userB.userId,
				organization_id: ctx.defaultOrganization.id,
				host_name: `host-a4-B-${testId}`,
				last_seen: BigInt(Date.now()),
			})

			// Both collections should see both hosts
			await waitForItem(collectionA, hostA.host_id, { timeout: 10_000 })
			await waitForItem(collectionA, hostB.host_id, { timeout: 10_000 })
			await waitForItem(collectionB, hostA.host_id, { timeout: 10_000 })
			await waitForItem(collectionB, hostB.host_id, { timeout: 10_000 })

			expect(collectionA.has(hostA.host_id)).toBe(true)
			expect(collectionA.has(hostB.host_id)).toBe(true)
			expect(collectionB.has(hostA.host_id)).toBe(true)
			expect(collectionB.has(hostB.host_id)).toBe(true)
		})
	})
})
