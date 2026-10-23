import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { setTimeout as sleep } from 'node:timers/promises'

import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { createElectricTestContext, createTestUser, type ElectricTestContext, waitForItem } from './fixtures'
import { createSessionsByHostCollection } from './fixtures/collection-factories'

const CI = !!process.env.CI

/**
 * Sessions by Host Sync Tests
 *
 * Tests for /v1/sessions/:hostId endpoint
 * This endpoint filters sessions by hostId (path parameter) while applying ACL rules.
 *
 * Key difference from /v1/sessions:
 * - /v1/sessions: All sessions user has access to
 * - /v1/sessions/:hostId: Only sessions on specific host that user has access to
 *
 * All tests within each describe.concurrent block are concurrency-safe:
 * - Each test creates its own unique users
 * - Each test creates its own data
 * - Tests do not share mutable state
 */
describe.skipIf(CI)('/v1/sessions/:hostId sync tests', () => {
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
		test('SH1: User sees their sessions filtered by specific hostId', async () => {
			const testId = randomUUID().slice(0, 8)
			const owner = createTestUser(`sh1_owner_${testId}`)

			// Create two unique host IDs
			const hostA = randomUUID()
			const hostB = randomUUID()

			// Create proxy server for owner with hostA
			const serverHostA = ctx.createProxyServer({
				user: owner,
				organization: ctx.defaultOrganization,
				key: `sh1_hostA_${testId}`,
			})

			const sessionsHostACollection = await ctx.createSessionsByHostCollection({
				server: serverHostA,
				hostId: hostA,
			})

			// Create sessions on both hosts
			const sessionOnHostA = await ctx.seedSession({
				resource_owner_user_id: owner.userId,
				organization_id: ctx.defaultOrganization.id,
				working_directory: tmpdir(),
				status: 'draft',
				host_id: hostA,
				created_by: owner.userId,
			})

			const sessionOnHostB = await ctx.seedSession({
				resource_owner_user_id: owner.userId,
				organization_id: ctx.defaultOrganization.id,
				working_directory: tmpdir(),
				status: 'draft',
				host_id: hostB,
				created_by: owner.userId,
			})

			// Wait for session on hostA to sync
			await waitForItem(sessionsHostACollection, sessionOnHostA.id, { timeout: 10_000 })

			// Verify: Only sees session on hostA, NOT hostB
			expect(sessionsHostACollection.has(sessionOnHostA.id)).toBe(true)
			expect(sessionsHostACollection.has(sessionOnHostB.id)).toBe(false)
		})
	})

	// =========================================================================
	// Section B: Adversarial/Isolation (CRITICAL)
	// =========================================================================
	describe('Section B: Adversarial/Isolation', () => {
		test('SH2: User does NOT see sessions on different hostId via this endpoint', async () => {
			const testId = randomUUID().slice(0, 8)
			const owner = createTestUser(`sh2_owner_${testId}`)

			const hostA = randomUUID()
			const hostB = randomUUID()

			// Create proxy for hostA endpoint
			const serverHostA = ctx.createProxyServer({
				user: owner,
				organization: ctx.defaultOrganization,
				key: `sh2_hostA_${testId}`,
			})

			const sessionsHostACollection = await ctx.createSessionsByHostCollection({
				server: serverHostA,
				hostId: hostA,
			})

			// Create session on hostB
			const sessionOnHostB = await ctx.withElectricSentinel(sessionsHostACollection, async (tx) => {
				const [denied, sentinel] = await tx
					.insert(ctx.tables.sessions)
					.values([
						{
							resource_owner_user_id: owner.userId,
							organization_id: ctx.defaultOrganization.id,
							working_directory: tmpdir(),
							status: 'draft',
							host_id: hostB,
							created_by: owner.userId,
						},
						{
							resource_owner_user_id: owner.userId,
							organization_id: ctx.defaultOrganization.id,
							working_directory: tmpdir(),
							status: 'draft',
							host_id: hostA,
							created_by: owner.userId,
						},
					])
					.returning()
				if (!denied || !sentinel) throw new Error('Failed to seed session barrier')
				return { result: denied, sentinelId: sentinel.id }
			})

			// Verify: Querying /v1/sessions/hostA should NOT see hostB session
			expect(sessionsHostACollection.has(sessionOnHostB.id)).toBe(false)
		})

		test("SH3: User does NOT see other user's sessions on same host (no ACL)", async () => {
			const testId = randomUUID().slice(0, 8)
			const userA = createTestUser(`sh3_userA_${testId}`)
			const userB = createTestUser(`sh3_userB_${testId}`)

			const hostX = randomUUID()

			// UserB queries /v1/sessions/hostX
			const serverUserB = ctx.createProxyServer({
				user: userB,
				organization: ctx.defaultOrganization,
				key: `sh3_userB_${testId}`,
			})

			const sessionsHostXCollection = await ctx.createSessionsByHostCollection({
				server: serverUserB,
				hostId: hostX,
			})

			const sessionByUserA = await ctx.withElectricSentinel(sessionsHostXCollection, async (tx) => {
				const [denied, sentinel] = await tx
					.insert(ctx.tables.sessions)
					.values([
						{
							resource_owner_user_id: userA.userId,
							organization_id: ctx.defaultOrganization.id,
							working_directory: tmpdir(),
							status: 'draft',
							host_id: hostX,
							created_by: userA.userId,
						},
						{
							resource_owner_user_id: userB.userId,
							organization_id: ctx.defaultOrganization.id,
							working_directory: tmpdir(),
							status: 'draft',
							host_id: hostX,
							created_by: userB.userId,
						},
					])
					.returning()
				if (!denied || !sentinel) throw new Error('Failed to seed session barrier')
				return { result: denied, sentinelId: sentinel.id }
			})

			// UserB should NOT see userA's session
			expect(sessionsHostXCollection.has(sessionByUserA.id)).toBe(false)
		})

		test('SH4: User does NOT see sessions on host in different org', async () => {
			const testId = randomUUID().slice(0, 8)
			const userInOrgA = createTestUser(`sh4_orgA_${testId}`)
			const userInOrgB = createTestUser(`sh4_orgB_${testId}`)

			const hostX = randomUUID()

			// Create a different organization
			const orgB = await ctx.seedOrganization({ name: `SH4 Org B ${testId}` })

			// User in orgB queries /v1/sessions/hostX
			const serverOrgB = ctx.createProxyServer({
				user: userInOrgB,
				organization: orgB,
				key: `sh4_orgB_${testId}`,
			})

			const sessionsHostXCollection = await ctx.createSessionsByHostCollection({
				server: serverOrgB,
				hostId: hostX,
			})

			const sessionInOrgA = await ctx.withElectricSentinel(sessionsHostXCollection, async (tx) => {
				const [denied, sentinel] = await tx
					.insert(ctx.tables.sessions)
					.values([
						{
							resource_owner_user_id: userInOrgA.userId,
							organization_id: ctx.defaultOrganization.id,
							working_directory: tmpdir(),
							status: 'draft',
							host_id: hostX,
							created_by: userInOrgA.userId,
						},
						{
							resource_owner_user_id: userInOrgB.userId,
							organization_id: orgB.id,
							working_directory: tmpdir(),
							status: 'draft',
							host_id: hostX,
							created_by: userInOrgB.userId,
						},
					])
					.returning()
				if (!denied || !sentinel) throw new Error('Failed to seed session barrier')
				return { result: denied, sentinelId: sentinel.id }
			})

			// User in orgB should NOT see session from orgA
			expect(sessionsHostXCollection.has(sessionInOrgA.id)).toBe(false)
		})
	})

	// =========================================================================
	// Section C: ACL with Host Filtering
	// =========================================================================
	describe('Section C: ACL with Host Filtering', () => {
		test('SH5: User sees sessions via task_user_acl filtered by host', async () => {
			const testId = randomUUID().slice(0, 8)
			const owner = createTestUser(`sh5_owner_${testId}`)
			const grantee = createTestUser(`sh5_grantee_${testId}`)

			const hostA = randomUUID()
			const hostB = randomUUID()

			// Create task
			const task = await ctx.seedTask({
				name: `SH5 Task ${testId}`,
				resource_owner_user_id: owner.userId,
				organization_id: ctx.defaultOrganization.id,
				created_by: owner.userId,
			})

			// Owner creates sessions on both hostA and hostB, linked to same task
			const sessionOnHostA = await ctx.seedSession({
				resource_owner_user_id: owner.userId,
				organization_id: ctx.defaultOrganization.id,
				task_id: task.id,
				working_directory: tmpdir(),
				status: 'draft',
				host_id: hostA,
				created_by: owner.userId,
			})

			const sessionOnHostB = await ctx.seedSession({
				resource_owner_user_id: owner.userId,
				organization_id: ctx.defaultOrganization.id,
				task_id: task.id,
				working_directory: tmpdir(),
				status: 'draft',
				host_id: hostB,
				created_by: owner.userId,
			})

			// Grant task ACL to grantee
			await ctx.seedTaskUserAcl({
				granted_by: owner.userId,
				task_id: task.id,
				subject_user_id: grantee.userId,
				organization_id: ctx.defaultOrganization.id,
				resource_owner_user_id: owner.userId,
				permission_level: 'read',
			})

			// Grantee queries /v1/sessions/hostA
			const granteeServer = ctx.createProxyServer({
				user: grantee,
				organization: ctx.defaultOrganization,
				key: `sh5_grantee_${testId}`,
			})

			const sessionsHostACollection = await ctx.createSessionsByHostCollection({
				server: granteeServer,
				hostId: hostA,
			})

			// Grantee should see ONLY hostA session via ACL, NOT hostB
			await waitForItem(sessionsHostACollection, sessionOnHostA.id, { timeout: 10_000 })
			expect(sessionsHostACollection.has(sessionOnHostA.id)).toBe(true)
			expect(sessionsHostACollection.has(sessionOnHostB.id)).toBe(false)
		})

		test("SH6: Changing session's task_id to unshared task removes it from host-filtered view", async () => {
			const testId = randomUUID().slice(0, 8)
			const owner = createTestUser(`sh6_owner_${testId}`)
			const grantee = createTestUser(`sh6_grantee_${testId}`)

			const hostX = randomUUID()

			// Create taskA (shared) and taskB (not shared)
			const taskA = await ctx.seedTask({
				name: `SH6 Task A ${testId}`,
				resource_owner_user_id: owner.userId,
				organization_id: ctx.defaultOrganization.id,
				created_by: owner.userId,
			})

			const taskB = await ctx.seedTask({
				name: `SH6 Task B ${testId}`,
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

			// Create session on hostX linked to taskA
			const session = await ctx.seedSession({
				resource_owner_user_id: owner.userId,
				organization_id: ctx.defaultOrganization.id,
				task_id: taskA.id,
				working_directory: tmpdir(),
				status: 'draft',
				host_id: hostX,
				created_by: owner.userId,
			})

			// Grantee queries /v1/sessions/hostX
			const granteeServer = ctx.createProxyServer({
				user: grantee,
				organization: ctx.defaultOrganization,
				key: `sh6_grantee_${testId}`,
			})

			const sessionsHostXCollection = await ctx.createSessionsByHostCollection({
				server: granteeServer,
				hostId: hostX,
			})

			// Grantee should initially see session (via taskA ACL)
			await waitForItem(sessionsHostXCollection, session.id, { timeout: 10_000 })
			expect(sessionsHostXCollection.has(session.id)).toBe(true)

			await ctx.withElectricSentinel(sessionsHostXCollection, async (tx) => {
				await tx
					.update(ctx.tables.sessions)
					.set({ task_id: taskB.id })
					.where(eq(ctx.tables.sessions.id, session.id))
				const [sentinel] = await tx
					.insert(ctx.tables.sessions)
					.values({
						resource_owner_user_id: grantee.userId,
						organization_id: ctx.defaultOrganization.id,
						working_directory: tmpdir(),
						status: 'draft',
						host_id: hostX,
						created_by: grantee.userId,
					})
					.returning()
				if (!sentinel) throw new Error('Failed to seed session barrier')
				return { result: undefined, sentinelId: sentinel.id }
			})

			// Session should disappear from grantee's host-filtered view
			expect(sessionsHostXCollection.has(session.id)).toBe(false)
		})
	})

	// =========================================================================
	// Section D: Daemon hostId validation
	// =========================================================================
	describe('Section D: Daemon hostId validation', () => {
		test('a daemon cannot receive another creator session even when its user owns the shared resource', async () => {
			const owner = createTestUser(`isolated_owner_${randomUUID()}`)
			const collaborator = createTestUser(`isolated_collaborator_${randomUUID()}`)
			const hostId = randomUUID()
			const server = ctx.createProxyServer({
				user: owner,
				organization: ctx.defaultOrganization,
				hostId,
				key: `isolated_daemon_${randomUUID()}`,
			})
			const collection = await ctx.createSessionsByHostCollection({ server, hostId })
			const foreignSession = await ctx.withElectricSentinel(collection, async (tx) => {
				const [foreign, own] = await tx
					.insert(ctx.tables.sessions)
					.values([
						{
							organization_id: ctx.defaultOrganization.id,
							resource_owner_user_id: owner.userId,
							created_by: collaborator.userId,
							host_id: hostId,
							working_directory: '/home/collaborator/workspace',
							status: 'ready_for_launch',
						},
						{
							organization_id: ctx.defaultOrganization.id,
							resource_owner_user_id: owner.userId,
							created_by: owner.userId,
							host_id: hostId,
							working_directory: tmpdir(),
							status: 'ready_for_launch',
						},
					])
					.returning()
				if (!foreign || !own) throw new Error('Missing session fixtures')
				return { result: foreign, sentinelId: own.id }
			})
			expect(collection.has(foreignSession.id)).toBe(false)
		})

		test('SH7: Daemon with matching hostId sees sessions on that host', async () => {
			const testId = randomUUID().slice(0, 8)
			const owner = createTestUser(`sh7_owner_${testId}`)

			const hostId = randomUUID()

			// Create proxy server WITH hostId in auth context (daemon token)
			const daemonServer = ctx.createProxyServer({
				user: owner,
				organization: ctx.defaultOrganization,
				hostId,
				key: `sh7_daemon_${testId}`,
			})

			// Create collection with matching hostId in URL path
			const sessionsCollection = await ctx.createSessionsByHostCollection({
				server: daemonServer,
				hostId,
			})

			// Seed a session on this host
			const session = await ctx.seedSession({
				resource_owner_user_id: owner.userId,
				organization_id: ctx.defaultOrganization.id,
				working_directory: tmpdir(),
				status: 'draft',
				host_id: hostId,
				created_by: owner.userId,
			})

			// Daemon with matching hostId should see the session
			await waitForItem(sessionsCollection, session.id, { timeout: 10_000 })
			expect(sessionsCollection.has(session.id)).toBe(true)
		})

		test('SH8: Daemon with mismatched hostId gets 403 (IDOR prevention)', async () => {
			const testId = randomUUID().slice(0, 8)
			const owner = createTestUser(`sh8_owner_${testId}`)

			const daemonHostId = randomUUID()
			const otherHostId = randomUUID()

			// Track errors
			const errors: unknown[] = []

			// Create proxy server with daemonHostId in auth context
			const daemonServer = ctx.createProxyServer({
				user: owner,
				organization: ctx.defaultOrganization,
				hostId: daemonHostId,
				key: `sh8_daemon_${testId}`,
			})

			// Create collection with DIFFERENT hostId in URL path (IDOR attempt)
			// Use raw factory to capture errors (ctx wrapper auto-waits for ready)
			const _collection = createSessionsByHostCollection({
				server: daemonServer,
				hostId: otherHostId,
				onError: (err) => {
					errors.push(err)
				},
			})

			// Wait for error to be caught
			await sleep(2000)

			// Should have received a 403 error
			expect(errors.length).toBeGreaterThan(0)
			const error = errors[0] as any
			expect(error?.message).toContain('403')
		})

		test('SH9: User JWT (no hostId in auth context) still works normally', async () => {
			const testId = randomUUID().slice(0, 8)
			const owner = createTestUser(`sh9_owner_${testId}`)

			const hostId = randomUUID()

			// Create proxy server WITHOUT hostId (user JWT auth)
			const userServer = ctx.createProxyServer({
				user: owner,
				organization: ctx.defaultOrganization,
				key: `sh9_user_${testId}`,
			})

			const sessionsCollection = await ctx.createSessionsByHostCollection({
				server: userServer,
				hostId,
			})

			// Seed a session on this host
			const session = await ctx.seedSession({
				resource_owner_user_id: owner.userId,
				organization_id: ctx.defaultOrganization.id,
				working_directory: tmpdir(),
				status: 'draft',
				host_id: hostId,
				created_by: owner.userId,
			})

			// User JWT caller should see sessions normally (no hostId validation)
			await waitForItem(sessionsCollection, session.id, { timeout: 10_000 })
			expect(sessionsCollection.has(session.id)).toBe(true)
		})
	})
})
