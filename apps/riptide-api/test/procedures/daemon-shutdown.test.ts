import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'

import { approvals } from '@humanlayer/db/tables/approvals'
import { onlineHosts } from '@humanlayer/db/tables/online-hosts'
import { organizations } from '@humanlayer/db/tables/organizations'
import { DAEMON_ACTIVE_SESSION_STATUSES, sessions, type SessionStatus } from '@humanlayer/db/tables/sessions'
import { call } from '@orpc/server'
import { and, eq, inArray } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { shutdownEffectProcedure as liveShutdownProcedure } from '../../src/orpc/daemon/hosts/shutdown.effect'
import { createMockDaemonAuth, createMockDaemonContext } from '../mocks'
import { bindProcedureToRuntime, createRuntimeWithTestPostgresLayer } from '../utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('daemon/hosts/shutdown', async () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let effectRuntime: ReturnType<typeof createRuntimeWithTestPostgresLayer> | undefined
	let shutdownProcedure: typeof liveShutdownProcedure
	let organizationId: string
	let otherOrganizationId: string

	const userId = 'user_daemon_shutdown_123'

	beforeAll(async () => {
		const testDb = await createTestDb('daemon_shutdown')
		cleanupTestDb = testDb.cleanup
		db = testDb.db
		effectRuntime = createRuntimeWithTestPostgresLayer(db)
		shutdownProcedure = bindProcedureToRuntime(liveShutdownProcedure, effectRuntime)

		const [org, otherOrg] = await db
			.insert(organizations)
			.values([
				{ name: 'Daemon Shutdown Org', workos_organization_id: `org_${randomUUID()}` },
				{ name: 'Other Daemon Shutdown Org', workos_organization_id: `org_${randomUUID()}` },
			])
			.returning()

		organizationId = org!.id
		otherOrganizationId = otherOrg!.id
	})

	afterAll(async () => {
		await effectRuntime?.dispose()
		await cleanupTestDb?.()
	}, 30000)

	const createDaemonContext = (hostId: string, contextUserId = userId, contextOrganizationId = organizationId) => ({
		context: createMockDaemonContext({
			auth: createMockDaemonAuth({ userId: contextUserId, organizationId: contextOrganizationId, hostId }),
			services: { db, dbReadReplica: db },
		}),
	})

	const createSession = async (
		hostId: string,
		status: SessionStatus,
		daemonUserId = userId,
		sessionOrganizationId = organizationId,
		resourceOwnerUserId = daemonUserId,
	) => {
		const [session] = await db
			.insert(sessions)
			.values({
				organization_id: sessionOrganizationId,
				resource_owner_user_id: resourceOwnerUserId,
				created_by: daemonUserId,
				host_id: hostId,
				title: `session-${status}`,
				working_directory: tmpdir(),
				coding_agent: 'claude',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissions_mode: 'default',
				status,
			})
			.returning()

		return session!
	}

	describe('Security', () => {
		test('returns FORBIDDEN when request hostId does not match daemon token hostId', async () => {
			const authHostId = randomUUID()
			const spoofedHostId = randomUUID()

			await expect(
				call(
					shutdownProcedure,
					{ hostId: spoofedHostId, reason: 'spoof attempt' },
					createDaemonContext(authHostId),
				),
			).rejects.toMatchObject({ code: 'FORBIDDEN' })
		})

		test('spoofed shutdown does not update target host sessions', async () => {
			const authHostId = randomUUID()
			const victimHostId = randomUUID()
			const victimSession = await createSession(victimHostId, 'running')

			await expect(
				call(
					shutdownProcedure,
					{ hostId: victimHostId, reason: 'spoof attempt' },
					createDaemonContext(authHostId),
				),
			).rejects.toMatchObject({ code: 'FORBIDDEN' })

			const [sessionAfter] = await db.select().from(sessions).where(eq(sessions.id, victimSession.id))
			expect(sessionAfter?.status).toBe('running')
		})

		test('spoofed shutdown does not reject target approvals', async () => {
			const authHostId = randomUUID()
			const victimHostId = randomUUID()
			const victimSession = await createSession(victimHostId, 'needs_approval')

			const [approval] = await db
				.insert(approvals)
				.values({
					organization_id: organizationId,
					user_id: userId,
					host_id: victimHostId,
					session_id: victimSession.id,
					resource_owner_user_id: userId,
					tool_name: 'Bash',
					tool_input: { command: 'ls' },
					status: 'pending',
				})
				.returning()

			await expect(
				call(
					shutdownProcedure,
					{ hostId: victimHostId, reason: 'spoof attempt' },
					createDaemonContext(authHostId),
				),
			).rejects.toMatchObject({ code: 'FORBIDDEN' })

			const [approvalAfter] = await db.select().from(approvals).where(eq(approvals.id, approval!.id))
			expect(approvalAfter?.status).toBe('pending')
		})

		test('spoofed shutdown does not change target host status', async () => {
			const authHostId = randomUUID()
			const victimHostId = randomUUID()

			await db.insert(onlineHosts).values({
				host_id: victimHostId,
				host_name: 'victim-host',
				user_id: userId,
				organization_id: organizationId,
				last_seen: BigInt(Date.now()),
			})

			await expect(
				call(
					shutdownProcedure,
					{ hostId: victimHostId, reason: 'spoof attempt' },
					createDaemonContext(authHostId),
				),
			).rejects.toMatchObject({ code: 'FORBIDDEN' })

			const [hostAfter] = await db
				.select()
				.from(onlineHosts)
				.where(and(eq(onlineHosts.host_id, victimHostId), eq(onlineHosts.organization_id, organizationId)))

			expect(hostAfter).toBeDefined()
			expect(hostAfter?.status).toBe('online')
		})
	})

	describe('Happy path', () => {
		test('shuts down matching host and fails only daemon-active sessions', async () => {
			const hostId = randomUUID()
			const otherHostId = randomUUID()
			const lastSeen = BigInt(Date.now() - 10_000)
			const preservedStatuses: SessionStatus[] = [
				'ready_for_launch',
				'waiting_for_workspace',
				'draft',
				'failed',
				'ready_for_input',
				'interrupt_requested',
				'interrupted',
			]

			await db.insert(onlineHosts).values([
				{
					host_id: hostId,
					host_name: 'primary-host',
					user_id: userId,
					organization_id: organizationId,
					last_seen: lastSeen,
				},
				{
					host_id: otherHostId,
					host_name: 'other-host',
					user_id: userId,
					organization_id: organizationId,
					last_seen: BigInt(Date.now()),
				},
			])

			const activeSessions = await Promise.all(
				DAEMON_ACTIVE_SESSION_STATUSES.map((status) => createSession(hostId, status)),
			)
			const preservedSessions = await Promise.all(
				preservedStatuses.map((status) => createSession(hostId, status)),
			)
			const otherHostSession = await createSession(otherHostId, 'running')
			const needsApprovalSession = activeSessions.find((session) => session.status === 'needs_approval')
			if (!needsApprovalSession) throw new Error('Expected a needs_approval session fixture')
			const interruptRequestedSession = preservedSessions.find(
				(session) => session.status === 'interrupt_requested',
			)
			if (!interruptRequestedSession) throw new Error('Expected an interrupt_requested session fixture')

			await db.insert(approvals).values(
				[needsApprovalSession, interruptRequestedSession].map((session) => ({
					organization_id: organizationId,
					user_id: userId,
					host_id: hostId,
					session_id: session.id,
					resource_owner_user_id: userId,
					tool_name: 'Bash',
					tool_input: { command: 'ls' },
					status: 'pending' as const,
				})),
			)

			const result = await call(
				shutdownProcedure,
				{ hostId, reason: 'Daemon process exited' },
				createDaemonContext(hostId),
			)

			expect(result).toEqual({
				success: true,
				sessionsUpdated: DAEMON_ACTIVE_SESSION_STATUSES.length + 1,
			})

			const sessionsAfter = await db
				.select()
				.from(sessions)
				.where(
					inArray(
						sessions.id,
						[...activeSessions, ...preservedSessions].map((session) => session.id),
					),
				)
			const [otherHostAfter] = await db.select().from(sessions).where(eq(sessions.id, otherHostSession.id))

			for (const activeSession of activeSessions) {
				expect(sessionsAfter.find((session) => session.id === activeSession.id)).toMatchObject({
					status: 'failed',
					error_message: 'Daemon process exited',
				})
			}
			for (const preservedSession of preservedSessions) {
				const expectedStatus =
					preservedSession.status === 'interrupt_requested' ? 'interrupted' : preservedSession.status
				expect(sessionsAfter.find((session) => session.id === preservedSession.id)).toMatchObject({
					status: expectedStatus,
					error_message: preservedSession.error_message,
				})
			}
			expect(otherHostAfter?.status).toBe('running')

			const approvalsAfter = await db
				.select()
				.from(approvals)
				.where(inArray(approvals.session_id, [needsApprovalSession.id, interruptRequestedSession.id]))
			expect(approvalsAfter).toHaveLength(2)
			for (const approvalAfter of approvalsAfter) {
				expect(approvalAfter).toMatchObject({ status: 'denied', comment: 'Daemon shutdown' })
			}

			const [shutdownHost] = await db
				.select()
				.from(onlineHosts)
				.where(and(eq(onlineHosts.host_id, hostId), eq(onlineHosts.organization_id, organizationId)))
			const [otherHost] = await db
				.select()
				.from(onlineHosts)
				.where(and(eq(onlineHosts.host_id, otherHostId), eq(onlineHosts.organization_id, organizationId)))

			expect(shutdownHost).toMatchObject({ status: 'offline', last_seen: lastSeen })
			expect(otherHost).toMatchObject({ status: 'online' })
		})

		test('matches host rows, sessions, and approvals by host, organization, and user', async () => {
			const hostId = randomUUID()
			const otherUserId = 'user_daemon_shutdown_other'
			const taskOwnerUserId = 'user_daemon_shutdown_task_owner'

			await db.insert(onlineHosts).values([
				{ host_id: hostId, organization_id: organizationId, user_id: userId },
				{ host_id: hostId, organization_id: organizationId, user_id: otherUserId },
				{ host_id: hostId, organization_id: otherOrganizationId, user_id: userId },
			])

			const targetSession = await createSession(hostId, 'needs_approval', userId, organizationId, taskOwnerUserId)
			const otherUserSession = await createSession(hostId, 'needs_approval', otherUserId)
			const otherOrganizationSession = await createSession(hostId, 'needs_approval', userId, otherOrganizationId)

			const [targetApproval, otherUserApproval, otherOrganizationApproval] = await db
				.insert(approvals)
				.values([
					{
						host_id: hostId,
						organization_id: organizationId,
						resource_owner_user_id: taskOwnerUserId,
						session_id: targetSession.id,
						status: 'pending',
						tool_input: { command: 'ls' },
						tool_name: 'Bash',
						user_id: userId,
					},
					{
						host_id: hostId,
						organization_id: organizationId,
						resource_owner_user_id: otherUserId,
						session_id: otherUserSession.id,
						status: 'pending',
						tool_input: { command: 'ls' },
						tool_name: 'Bash',
						user_id: otherUserId,
					},
					{
						host_id: hostId,
						organization_id: otherOrganizationId,
						resource_owner_user_id: userId,
						session_id: otherOrganizationSession.id,
						status: 'pending',
						tool_input: { command: 'ls' },
						tool_name: 'Bash',
						user_id: userId,
					},
				])
				.returning()

			const result = await call(shutdownProcedure, { hostId }, createDaemonContext(hostId))

			expect(result.sessionsUpdated).toBe(1)

			const [targetSessionAfter] = await db.select().from(sessions).where(eq(sessions.id, targetSession.id))
			const [otherUserSessionAfter] = await db.select().from(sessions).where(eq(sessions.id, otherUserSession.id))
			const [otherOrganizationSessionAfter] = await db
				.select()
				.from(sessions)
				.where(eq(sessions.id, otherOrganizationSession.id))
			expect(targetSessionAfter?.status).toBe('failed')
			expect(otherUserSessionAfter?.status).toBe('needs_approval')
			expect(otherOrganizationSessionAfter?.status).toBe('needs_approval')

			const [targetApprovalAfter] = await db.select().from(approvals).where(eq(approvals.id, targetApproval!.id))
			const [otherUserApprovalAfter] = await db
				.select()
				.from(approvals)
				.where(eq(approvals.id, otherUserApproval!.id))
			const [otherOrganizationApprovalAfter] = await db
				.select()
				.from(approvals)
				.where(eq(approvals.id, otherOrganizationApproval!.id))
			expect(targetApprovalAfter?.status).toBe('denied')
			expect(otherUserApprovalAfter?.status).toBe('pending')
			expect(otherOrganizationApprovalAfter?.status).toBe('pending')

			const [targetHost] = await db
				.select()
				.from(onlineHosts)
				.where(
					and(
						eq(onlineHosts.host_id, hostId),
						eq(onlineHosts.organization_id, organizationId),
						eq(onlineHosts.user_id, userId),
					),
				)
			const [otherUserHost] = await db
				.select()
				.from(onlineHosts)
				.where(
					and(
						eq(onlineHosts.host_id, hostId),
						eq(onlineHosts.organization_id, organizationId),
						eq(onlineHosts.user_id, otherUserId),
					),
				)
			const [otherOrganizationHost] = await db
				.select()
				.from(onlineHosts)
				.where(
					and(
						eq(onlineHosts.host_id, hostId),
						eq(onlineHosts.organization_id, otherOrganizationId),
						eq(onlineHosts.user_id, userId),
					),
				)
			expect(targetHost?.status).toBe('offline')
			expect(otherUserHost?.status).toBe('online')
			expect(otherOrganizationHost?.status).toBe('online')
		})
	})
})
