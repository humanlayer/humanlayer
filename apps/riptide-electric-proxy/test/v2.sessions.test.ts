import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'

import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { createElectricTestContext, createTestUser, type ElectricTestContext, waitForItem } from './fixtures'

const CI = !!process.env.CI

/**
 * Sync v2 Session Tests
 *
 * These tests verify that the /v2/sessions endpoint exposes org-wide read
 * visibility: any member of the same organization can see all sessions,
 * regardless of ACL entries.
 *
 * v1 visibility is tested separately in v1.sessions.test.ts — these tests
 * explicitly assert the OPPOSITE behaviour so regressions are immediately
 * visible if v2 ever silently reverts to ACL-gated access.
 */
describe.skipIf(CI)('/v2/sessions sync tests', () => {
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
		test('A1: Owner session syncs to owner via v2', async () => {
			const testId = randomUUID().slice(0, 8)
			const owner = createTestUser(`v2_sess_a1_owner_${testId}`)

			const server = ctx.createProxyServer({
				user: owner,
				organization: ctx.defaultOrganization,
				key: `v2_sess_a1_${testId}`,
			})

			const sessionsCollection = await ctx.createSessionsCollection({ server })

			const session = await ctx.seedSession({
				resource_owner_user_id: owner.userId,
				organization_id: ctx.defaultOrganization.id,
				working_directory: tmpdir(),
				status: 'draft',
				host_id: randomUUID(),
				created_by: owner.userId,
			})

			await waitForItem(sessionsCollection, session.id, { timeout: 10_000 })
			expect(sessionsCollection.has(session.id)).toBe(true)
		})

		test('A2: Org member sees another member session in v2 without ACL', async () => {
			const testId = randomUUID().slice(0, 8)
			const owner = createTestUser(`v2_sess_a2_owner_${testId}`)
			const member = createTestUser(`v2_sess_a2_member_${testId}`)

			// Member's v2 proxy server — same org, no ACL
			const memberServer = ctx.createProxyServer({
				user: member,
				organization: ctx.defaultOrganization,
				key: `v2_sess_a2_member_${testId}`,
			})

			const memberSessionsCollection = await ctx.createSessionsV2Collection({ server: memberServer })

			// Seed session owned by owner — no ACL for member
			const session = await ctx.seedSession({
				resource_owner_user_id: owner.userId,
				organization_id: ctx.defaultOrganization.id,
				working_directory: tmpdir(),
				status: 'draft',
				host_id: randomUUID(),
				created_by: owner.userId,
			})

			// v2: member should see the session even without ACL
			await waitForItem(memberSessionsCollection, session.id, { timeout: 10_000 })
			expect(memberSessionsCollection.has(session.id)).toBe(true)
		})

		test('A3: Cross-org user does NOT see session via v2 (org boundary is preserved)', async () => {
			const testId = randomUUID().slice(0, 8)
			const owner = createTestUser(`v2_sess_a3_owner_${testId}`)
			const crossOrgUser = createTestUser(`v2_sess_a3_crossorg_${testId}`)

			// Create a second organization
			const otherOrg = await ctx.seedOrganization({ name: `V2 Sess A3 Other Org ${testId}` })

			const crossOrgServer = ctx.createProxyServer({
				user: crossOrgUser,
				organization: otherOrg,
				key: `v2_sess_a3_crossorg_${testId}`,
			})

			const crossOrgCollection = await ctx.createSessionsV2Collection({ server: crossOrgServer })

			// Seed session in default org
			const session = await ctx.withElectricSentinel(crossOrgCollection, async (tx) => {
				const [denied] = await tx
					.insert(ctx.tables.sessions)
					.values({
						resource_owner_user_id: owner.userId,
						organization_id: ctx.defaultOrganization.id,
						working_directory: tmpdir(),
						status: 'draft',
						host_id: randomUUID(),
						created_by: owner.userId,
					})
					.returning()
				const [sentinel] = await tx
					.insert(ctx.tables.sessions)
					.values({
						resource_owner_user_id: crossOrgUser.userId,
						organization_id: otherOrg.id,
						working_directory: tmpdir(),
						status: 'draft',
						host_id: randomUUID(),
						created_by: crossOrgUser.userId,
					})
					.returning()
				if (!denied || !sentinel) throw new Error('Failed to seed session barrier')
				return { result: denied, sentinelId: sentinel.id }
			})

			// Cross-org user must NOT see the session
			expect(crossOrgCollection.has(session.id)).toBe(false)
		})

		test('A4: All sessions in org are visible to any org member via v2', async () => {
			const testId = randomUUID().slice(0, 8)
			const userA = createTestUser(`v2_sess_a4_userA_${testId}`)
			const userB = createTestUser(`v2_sess_a4_userB_${testId}`)

			const serverA = ctx.createProxyServer({
				user: userA,
				organization: ctx.defaultOrganization,
				key: `v2_sess_a4_userA_${testId}`,
			})

			const serverB = ctx.createProxyServer({
				user: userB,
				organization: ctx.defaultOrganization,
				key: `v2_sess_a4_userB_${testId}`,
			})

			const [collectionA, collectionB] = await Promise.all([
				ctx.createSessionsV2Collection({ server: serverA }),
				ctx.createSessionsV2Collection({ server: serverB }),
			])

			const sessionA = await ctx.seedSession({
				resource_owner_user_id: userA.userId,
				organization_id: ctx.defaultOrganization.id,
				working_directory: tmpdir(),
				status: 'draft',
				host_id: randomUUID(),
				created_by: userA.userId,
			})

			const sessionB = await ctx.seedSession({
				resource_owner_user_id: userB.userId,
				organization_id: ctx.defaultOrganization.id,
				working_directory: tmpdir(),
				status: 'draft',
				host_id: randomUUID(),
				created_by: userB.userId,
			})

			// userA should see both sessions (including userB's)
			await waitForItem(collectionA, sessionA.id, { timeout: 10_000 })
			await waitForItem(collectionA, sessionB.id, { timeout: 10_000 })

			// userB should see both sessions (including userA's)
			await waitForItem(collectionB, sessionA.id, { timeout: 10_000 })
			await waitForItem(collectionB, sessionB.id, { timeout: 10_000 })

			expect(collectionA.has(sessionA.id)).toBe(true)
			expect(collectionA.has(sessionB.id)).toBe(true)
			expect(collectionB.has(sessionA.id)).toBe(true)
			expect(collectionB.has(sessionB.id)).toBe(true)
		})
	})
})
