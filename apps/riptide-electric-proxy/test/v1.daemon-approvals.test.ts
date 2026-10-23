import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { setTimeout as sleep } from 'node:timers/promises'

import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { createElectricTestContext, createTestUser, type ElectricTestContext, waitForItem } from './fixtures'
import { createDaemonApprovalsCollection } from './fixtures/collection-factories'

const CI = !!process.env.CI

/**
 * Daemon Approvals Sync Tests
 *
 * Tests for the /v1/daemon/approvals endpoint which filters approvals by:
 * 1. organization_id (from auth)
 * 2. host_id (from daemon auth token) - CRITICAL for daemon isolation
 * 3. ACL (via task_id if set, or resource_owner_user_id if task_id is NULL)
 *
 * Key differences from /v1/approvals:
 * - Requires hostId in auth token (daemon-specific)
 * - Filters by host_id column to show only approvals for this daemon's host
 * - Same ACL rules apply (ownership + task ACL)
 */
describe.skipIf(CI)('/v1/daemon/approvals sync tests', () => {
	let ctx: ElectricTestContext

	beforeAll(async () => {
		ctx = await createElectricTestContext()
	})

	afterAll(async () => {
		await ctx.shutdown()
	})

	// =========================================================================
	// Section A: Golden Path
	// =========================================================================
	describe('Section A: Golden Path', () => {
		test('DA1: Approval syncs to daemon when host_id matches daemon token hostId', async () => {
			const testId = randomUUID().slice(0, 8)
			const owner = createTestUser(`da1_owner_${testId}`)
			const hostId = randomUUID()

			const server = ctx.createProxyServer({
				user: owner,
				organization: ctx.defaultOrganization,
				hostId,
				key: `da1_${testId}`,
			})

			const approvalsCollection = await ctx.createDaemonApprovalsCollection({ server })

			// Create task + session for approval
			const task = await ctx.seedTask({
				name: `DA1 Task ${testId}`,
				resource_owner_user_id: owner.userId,
				organization_id: ctx.defaultOrganization.id,
				created_by: owner.userId,
			})

			const session = await ctx.seedSession({
				resource_owner_user_id: owner.userId,
				organization_id: ctx.defaultOrganization.id,
				task_id: task.id,
				working_directory: tmpdir(),
				status: 'draft',
				host_id: hostId,
				created_by: owner.userId,
			})

			// Create approval with matching host_id
			const approval = await ctx.seedApproval({
				session_id: session.id,
				organization_id: ctx.defaultOrganization.id,
				user_id: owner.userId,
				host_id: hostId, // Matches daemon's hostId
				resource_owner_user_id: owner.userId,
				task_id: task.id,
				tool_use_id: 'test_tool_use',
				tool_name: 'test_tool',
			})

			await waitForItem(approvalsCollection, approval.id, { timeout: 10_000 })
			expect(approvalsCollection.has(approval.id)).toBe(true)
		})
	})

	// =========================================================================
	// Section B: Adversarial/Isolation (CRITICAL)
	// =========================================================================
	describe('Section B: Adversarial/Isolation', () => {
		test('DA2: Approval does NOT sync to daemon with different hostId', async () => {
			const testId = randomUUID().slice(0, 8)
			const owner = createTestUser(`da2_owner_${testId}`)
			const hostIdA = randomUUID()
			const hostIdB = randomUUID()

			// Create daemon proxy with hostIdB
			const daemonServerB = ctx.createProxyServer({
				user: owner,
				organization: ctx.defaultOrganization,
				hostId: hostIdB,
				key: `da2_daemonB_${testId}`,
			})

			const daemonApprovalsCollection = await ctx.createDaemonApprovalsCollection({ server: daemonServerB })

			// Create task + session
			const task = await ctx.seedTask({
				name: `DA2 Task ${testId}`,
				resource_owner_user_id: owner.userId,
				organization_id: ctx.defaultOrganization.id,
				created_by: owner.userId,
			})

			const session = await ctx.seedSession({
				resource_owner_user_id: owner.userId,
				organization_id: ctx.defaultOrganization.id,
				task_id: task.id,
				working_directory: tmpdir(),
				status: 'draft',
				host_id: hostIdA,
				created_by: owner.userId,
			})

			// Create approval with hostIdA (different from daemon's hostIdB)
			const approval = await ctx.seedApproval({
				session_id: session.id,
				organization_id: ctx.defaultOrganization.id,
				user_id: owner.userId,
				host_id: hostIdA, // Does NOT match daemon's hostIdB
				resource_owner_user_id: owner.userId,
				task_id: task.id,
				tool_use_id: 'test_tool_use',
				tool_name: 'test_tool',
			})

			await ctx.withElectricSentinel(daemonApprovalsCollection, async (tx) => {
				await tx
					.update(ctx.tables.approvals)
					.set({ status: 'pending' })
					.where(eq(ctx.tables.approvals.id, approval.id))
				const [sentinel] = await tx
					.insert(ctx.tables.approvals)
					.values({
						session_id: session.id,
						organization_id: ctx.defaultOrganization.id,
						user_id: owner.userId,
						host_id: hostIdB,
						resource_owner_user_id: owner.userId,
						task_id: null,
						tool_use_id: `da2_sentinel_${testId}`,
						tool_name: 'test_tool',
					})
					.returning()
				if (!sentinel) throw new Error('Failed to seed approval barrier')
				return { result: undefined, sentinelId: sentinel.id }
			})

			// Daemon B should NOT see the approval (different host_id)
			expect(daemonApprovalsCollection.has(approval.id)).toBe(false)
		})

		test('DA3: Approval does NOT sync to daemon in different organization', async () => {
			const testId = randomUUID().slice(0, 8)
			const ownerA = createTestUser(`da3_ownerA_${testId}`)
			const ownerB = createTestUser(`da3_ownerB_${testId}`)
			const hostId = randomUUID()

			// Create a different organization
			const orgB = await ctx.seedOrganization({ name: `DA3 Org B ${testId}` })

			// Create daemon proxy in orgB
			const daemonServerB = ctx.createProxyServer({
				user: ownerB,
				organization: orgB,
				hostId,
				key: `da3_daemonB_${testId}`,
			})

			const daemonApprovalsCollection = await ctx.createDaemonApprovalsCollection({ server: daemonServerB })

			// Create task + session in default org
			const task = await ctx.seedTask({
				name: `DA3 Task ${testId}`,
				resource_owner_user_id: ownerA.userId,
				organization_id: ctx.defaultOrganization.id,
				created_by: ownerA.userId,
			})

			const session = await ctx.seedSession({
				resource_owner_user_id: ownerA.userId,
				organization_id: ctx.defaultOrganization.id,
				task_id: task.id,
				working_directory: tmpdir(),
				status: 'draft',
				host_id: hostId,
				created_by: ownerA.userId,
			})

			// Create approval in default org (same host_id but different org)
			const approval = await ctx.seedApproval({
				session_id: session.id,
				organization_id: ctx.defaultOrganization.id,
				user_id: ownerA.userId,
				host_id: hostId,
				resource_owner_user_id: ownerA.userId,
				task_id: task.id,
				tool_use_id: 'test_tool_use',
				tool_name: 'test_tool',
			})

			await ctx.withElectricSentinel(daemonApprovalsCollection, async (tx) => {
				await tx
					.update(ctx.tables.approvals)
					.set({ status: 'pending' })
					.where(eq(ctx.tables.approvals.id, approval.id))
				const [sentinel] = await tx
					.insert(ctx.tables.approvals)
					.values({
						session_id: session.id,
						organization_id: orgB.id,
						user_id: ownerB.userId,
						host_id: hostId,
						resource_owner_user_id: ownerB.userId,
						task_id: null,
						tool_use_id: `da3_sentinel_${testId}`,
						tool_name: 'test_tool',
					})
					.returning()
				if (!sentinel) throw new Error('Failed to seed approval barrier')
				return { result: undefined, sentinelId: sentinel.id }
			})

			// Daemon in orgB should NOT see the approval (different org)
			expect(daemonApprovalsCollection.has(approval.id)).toBe(false)
		})

		test('DA4: Daemon on hostA does NOT see approvals on hostB (same user, same org)', async () => {
			const testId = randomUUID().slice(0, 8)
			const owner = createTestUser(`da4_owner_${testId}`)
			const hostIdA = randomUUID()
			const hostIdB = randomUUID()

			// Create two daemon proxies with different hostIds
			const daemonServerA = ctx.createProxyServer({
				user: owner,
				organization: ctx.defaultOrganization,
				hostId: hostIdA,
				key: `da4_daemonA_${testId}`,
			})

			const daemonServerB = ctx.createProxyServer({
				user: owner,
				organization: ctx.defaultOrganization,
				hostId: hostIdB,
				key: `da4_daemonB_${testId}`,
			})

			const daemonApprovalsCollectionA = await ctx.createDaemonApprovalsCollection({ server: daemonServerA })
			const daemonApprovalsCollectionB = await ctx.createDaemonApprovalsCollection({ server: daemonServerB })

			// Create task + session on hostA
			const task = await ctx.seedTask({
				name: `DA4 Task ${testId}`,
				resource_owner_user_id: owner.userId,
				organization_id: ctx.defaultOrganization.id,
				created_by: owner.userId,
			})

			const session = await ctx.seedSession({
				resource_owner_user_id: owner.userId,
				organization_id: ctx.defaultOrganization.id,
				task_id: task.id,
				working_directory: tmpdir(),
				status: 'draft',
				host_id: hostIdA,
				created_by: owner.userId,
			})

			// Create approval on hostA
			const approval = await ctx.seedApproval({
				session_id: session.id,
				organization_id: ctx.defaultOrganization.id,
				user_id: owner.userId,
				host_id: hostIdA,
				resource_owner_user_id: owner.userId,
				task_id: task.id,
				tool_use_id: 'test_tool_use',
				tool_name: 'test_tool',
			})

			// Wait for daemon A to see it
			await waitForItem(daemonApprovalsCollectionA, approval.id, { timeout: 10_000 })

			await ctx.withElectricSentinel(daemonApprovalsCollectionB, async (tx) => {
				await tx
					.update(ctx.tables.approvals)
					.set({ status: 'pending' })
					.where(eq(ctx.tables.approvals.id, approval.id))
				const [sentinel] = await tx
					.insert(ctx.tables.approvals)
					.values({
						session_id: session.id,
						organization_id: ctx.defaultOrganization.id,
						user_id: owner.userId,
						host_id: hostIdB,
						resource_owner_user_id: owner.userId,
						task_id: null,
						tool_use_id: `da4_sentinel_${testId}`,
						tool_name: 'test_tool',
					})
					.returning()
				if (!sentinel) throw new Error('Failed to seed approval barrier')
				return { result: undefined, sentinelId: sentinel.id }
			})

			// Daemon A sees it
			expect(daemonApprovalsCollectionA.has(approval.id)).toBe(true)

			// Daemon B does NOT see it (different host_id)
			expect(daemonApprovalsCollectionB.has(approval.id)).toBe(false)
		})
	})

	// =========================================================================
	// Section C: ACL Edge Cases
	// =========================================================================
	describe('Section C: ACL Edge Cases', () => {
		test('DA5: Approval with task_id = NULL syncs via resource_owner_user_id match only', async () => {
			const testId = randomUUID().slice(0, 8)
			const userA = createTestUser(`da5_userA_${testId}`)
			const userB = createTestUser(`da5_userB_${testId}`)
			const hostId = randomUUID()

			// Create daemon proxies for both users (same org, same host)
			const daemonServerA = ctx.createProxyServer({
				user: userA,
				organization: ctx.defaultOrganization,
				hostId,
				key: `da5_daemonA_${testId}`,
			})

			const daemonServerB = ctx.createProxyServer({
				user: userB,
				organization: ctx.defaultOrganization,
				hostId,
				key: `da5_daemonB_${testId}`,
			})

			const daemonApprovalsCollectionA = await ctx.createDaemonApprovalsCollection({ server: daemonServerA })
			const daemonApprovalsCollectionB = await ctx.createDaemonApprovalsCollection({ server: daemonServerB })

			// Create session for userA (without task_id linkage)
			const session = await ctx.seedSession({
				resource_owner_user_id: userA.userId,
				organization_id: ctx.defaultOrganization.id,
				task_id: null,
				working_directory: tmpdir(),
				status: 'draft',
				host_id: hostId,
				created_by: userA.userId,
			})

			// Create approval with task_id = NULL owned by userA
			const approval = await ctx.seedApproval({
				session_id: session.id,
				organization_id: ctx.defaultOrganization.id,
				user_id: userA.userId,
				host_id: hostId,
				resource_owner_user_id: userA.userId,
				task_id: null, // No task linkage
				tool_use_id: 'test_tool_use',
				tool_name: 'test_tool',
			})

			// Wait for userA's daemon to see it
			await waitForItem(daemonApprovalsCollectionA, approval.id, { timeout: 10_000 })

			await ctx.withElectricSentinel(daemonApprovalsCollectionB, async (tx) => {
				await tx
					.update(ctx.tables.approvals)
					.set({ status: 'pending' })
					.where(eq(ctx.tables.approvals.id, approval.id))
				const [sentinel] = await tx
					.insert(ctx.tables.approvals)
					.values({
						session_id: session.id,
						organization_id: ctx.defaultOrganization.id,
						user_id: userB.userId,
						host_id: hostId,
						resource_owner_user_id: userB.userId,
						task_id: null,
						tool_use_id: `da5_sentinel_${testId}`,
						tool_name: 'test_tool',
					})
					.returning()
				if (!sentinel) throw new Error('Failed to seed approval barrier')
				return { result: undefined, sentinelId: sentinel.id }
			})

			// UserA's daemon sees it (owner)
			expect(daemonApprovalsCollectionA.has(approval.id)).toBe(true)

			// UserB's daemon does NOT see it (no ACL path when task_id is NULL)
			expect(daemonApprovalsCollectionB.has(approval.id)).toBe(false)
		})

		test('DA6: Approval becomes visible after task_user_acl is granted', async () => {
			const testId = randomUUID().slice(0, 8)
			const owner = createTestUser(`da6_owner_${testId}`)
			const grantee = createTestUser(`da6_grantee_${testId}`)
			const hostId = randomUUID()

			// Create daemon proxy for grantee
			const granteeServer = ctx.createProxyServer({
				user: grantee,
				organization: ctx.defaultOrganization,
				hostId,
				key: `da6_grantee_${testId}`,
			})

			const granteeApprovalsCollection = await ctx.createDaemonApprovalsCollection({ server: granteeServer })

			// Create task owned by owner
			const task = await ctx.seedTask({
				name: `DA6 Task ${testId}`,
				resource_owner_user_id: owner.userId,
				organization_id: ctx.defaultOrganization.id,
				created_by: owner.userId,
			})

			// Create session + approval
			const session = await ctx.seedSession({
				resource_owner_user_id: owner.userId,
				organization_id: ctx.defaultOrganization.id,
				task_id: task.id,
				working_directory: tmpdir(),
				status: 'draft',
				host_id: hostId,
				created_by: owner.userId,
			})

			const approval = await ctx.seedApproval({
				session_id: session.id,
				organization_id: ctx.defaultOrganization.id,
				user_id: owner.userId,
				host_id: hostId,
				resource_owner_user_id: owner.userId,
				task_id: task.id,
				tool_use_id: 'test_tool_use',
				tool_name: 'test_tool',
			})

			await ctx.withElectricSentinel(granteeApprovalsCollection, async (tx) => {
				await tx
					.update(ctx.tables.approvals)
					.set({ status: 'pending' })
					.where(eq(ctx.tables.approvals.id, approval.id))
				const [sentinel] = await tx
					.insert(ctx.tables.approvals)
					.values({
						session_id: session.id,
						organization_id: ctx.defaultOrganization.id,
						user_id: grantee.userId,
						host_id: hostId,
						resource_owner_user_id: grantee.userId,
						task_id: null,
						tool_use_id: `da6_sentinel_${testId}`,
						tool_name: 'test_tool',
					})
					.returning()
				if (!sentinel) throw new Error('Failed to seed approval barrier')
				return { result: undefined, sentinelId: sentinel.id }
			})
			expect(granteeApprovalsCollection.has(approval.id)).toBe(false)

			// Grant task ACL to grantee
			await ctx.seedTaskUserAcl({
				granted_by: owner.userId,
				task_id: task.id,
				subject_user_id: grantee.userId,
				organization_id: ctx.defaultOrganization.id,
				resource_owner_user_id: owner.userId,
				permission_level: 'read',
			})

			// Now grantee's daemon should see the approval
			await waitForItem(granteeApprovalsCollection, approval.id, { timeout: 10_000 })
			expect(granteeApprovalsCollection.has(approval.id)).toBe(true)
		})

		test('DA7: Approval disappears after task_user_acl is revoked', async () => {
			const testId = randomUUID().slice(0, 8)
			const owner = createTestUser(`da7_owner_${testId}`)
			const grantee = createTestUser(`da7_grantee_${testId}`)
			const hostId = randomUUID()

			// Create daemon proxy for grantee
			const granteeServer = ctx.createProxyServer({
				user: grantee,
				organization: ctx.defaultOrganization,
				hostId,
				key: `da7_grantee_${testId}`,
			})

			const granteeApprovalsCollection = await ctx.createDaemonApprovalsCollection({ server: granteeServer })

			// Create task owned by owner
			const task = await ctx.seedTask({
				name: `DA7 Task ${testId}`,
				resource_owner_user_id: owner.userId,
				organization_id: ctx.defaultOrganization.id,
				created_by: owner.userId,
			})

			// Grant task ACL to grantee first
			const acl = await ctx.seedTaskUserAcl({
				granted_by: owner.userId,
				task_id: task.id,
				subject_user_id: grantee.userId,
				organization_id: ctx.defaultOrganization.id,
				resource_owner_user_id: owner.userId,
				permission_level: 'read',
			})

			// Create session + approval
			const session = await ctx.seedSession({
				resource_owner_user_id: owner.userId,
				organization_id: ctx.defaultOrganization.id,
				task_id: task.id,
				working_directory: tmpdir(),
				status: 'draft',
				host_id: hostId,
				created_by: owner.userId,
			})

			const approval = await ctx.seedApproval({
				session_id: session.id,
				organization_id: ctx.defaultOrganization.id,
				user_id: owner.userId,
				host_id: hostId,
				resource_owner_user_id: owner.userId,
				task_id: task.id,
				tool_use_id: 'test_tool_use',
				tool_name: 'test_tool',
			})

			// Grantee should see the approval (via ACL)
			await waitForItem(granteeApprovalsCollection, approval.id, { timeout: 10_000 })
			expect(granteeApprovalsCollection.has(approval.id)).toBe(true)

			await ctx.withElectricSentinel(granteeApprovalsCollection, async (tx) => {
				await tx.delete(ctx.tables.taskUserAcl).where(eq(ctx.tables.taskUserAcl.id, acl.id))
				const [sentinel] = await tx
					.insert(ctx.tables.approvals)
					.values({
						session_id: session.id,
						organization_id: ctx.defaultOrganization.id,
						user_id: grantee.userId,
						host_id: hostId,
						resource_owner_user_id: grantee.userId,
						task_id: null,
						tool_use_id: `da8_sentinel_${testId}`,
						tool_name: 'test_tool',
					})
					.returning()
				if (!sentinel) throw new Error('Failed to seed approval barrier')
				return { result: undefined, sentinelId: sentinel.id }
			})

			expect(granteeApprovalsCollection.has(approval.id)).toBe(false)
		})

		test('DA9: Changing approval task_id to unshared task removes it from grantee view', async () => {
			const testId = randomUUID().slice(0, 8)
			const owner = createTestUser(`da9_owner_${testId}`)
			const grantee = createTestUser(`da9_grantee_${testId}`)
			const hostId = randomUUID()

			// Create daemon proxy for grantee
			const granteeServer = ctx.createProxyServer({
				user: grantee,
				organization: ctx.defaultOrganization,
				hostId,
				key: `da9_grantee_${testId}`,
			})

			const granteeApprovalsCollection = await ctx.createDaemonApprovalsCollection({ server: granteeServer })

			// Create taskA (shared with grantee) and taskB (not shared)
			const taskA = await ctx.seedTask({
				name: `DA9 Task A ${testId}`,
				resource_owner_user_id: owner.userId,
				organization_id: ctx.defaultOrganization.id,
				created_by: owner.userId,
			})

			const taskB = await ctx.seedTask({
				name: `DA9 Task B ${testId}`,
				resource_owner_user_id: owner.userId,
				organization_id: ctx.defaultOrganization.id,
				created_by: owner.userId,
			})

			// Grant ACL for taskA only
			await ctx.seedTaskUserAcl({
				granted_by: owner.userId,
				task_id: taskA.id,
				subject_user_id: grantee.userId,
				organization_id: ctx.defaultOrganization.id,
				resource_owner_user_id: owner.userId,
				permission_level: 'read',
			})

			// Create session + approval linked to taskA
			const session = await ctx.seedSession({
				resource_owner_user_id: owner.userId,
				organization_id: ctx.defaultOrganization.id,
				task_id: taskA.id,
				working_directory: tmpdir(),
				status: 'draft',
				host_id: hostId,
				created_by: owner.userId,
			})

			const approval = await ctx.seedApproval({
				session_id: session.id,
				organization_id: ctx.defaultOrganization.id,
				user_id: owner.userId,
				host_id: hostId,
				resource_owner_user_id: owner.userId,
				task_id: taskA.id,
				tool_use_id: 'test_tool_use',
				tool_name: 'test_tool',
			})

			// Grantee should see the approval (via taskA ACL)
			await waitForItem(granteeApprovalsCollection, approval.id, { timeout: 10_000 })
			expect(granteeApprovalsCollection.has(approval.id)).toBe(true)

			await ctx.withElectricSentinel(granteeApprovalsCollection, async (tx) => {
				await tx
					.update(ctx.tables.approvals)
					.set({ task_id: taskB.id })
					.where(eq(ctx.tables.approvals.id, approval.id))
				const [sentinel] = await tx
					.insert(ctx.tables.approvals)
					.values({
						session_id: session.id,
						organization_id: ctx.defaultOrganization.id,
						user_id: grantee.userId,
						host_id: hostId,
						resource_owner_user_id: grantee.userId,
						task_id: null,
						tool_use_id: `da9_sentinel_${testId}`,
						tool_name: 'test_tool',
					})
					.returning()
				if (!sentinel) throw new Error('Failed to seed approval barrier')
				return { result: undefined, sentinelId: sentinel.id }
			})

			expect(granteeApprovalsCollection.has(approval.id)).toBe(false)
		})
	})

	// =========================================================================
	// Section D: Error Handling
	// =========================================================================
	describe('Section D: Error Handling', () => {
		test('DA8: Request returns 400 when daemon token missing hostId', async () => {
			const testId = randomUUID().slice(0, 8)
			const owner = createTestUser(`da8_owner_${testId}`)

			// Track errors
			const errors: unknown[] = []

			// Create daemon proxy WITHOUT hostId
			const daemonServer = ctx.createProxyServer({
				user: owner,
				organization: ctx.defaultOrganization,
				// hostId: undefined, // Missing hostId
				key: `da8_daemon_${testId}`,
			})

			// Create collection directly (skip setupLiveQuery/waitForReady since this
			// collection is intentionally misconfigured and will never reach 'ready')
			const _daemonApprovalsCollection = createDaemonApprovalsCollection({
				server: daemonServer,
				onError: (err) => {
					errors.push(err)
				},
			})

			// Wait for error to be caught
			await sleep(2000)

			// Should have received an error
			expect(errors.length).toBeGreaterThan(0)

			// The error should be about missing hostId (400 Bad Request)
			const error = errors[0] as any
			expect(error?.message).toContain('400')
		})
	})
})
