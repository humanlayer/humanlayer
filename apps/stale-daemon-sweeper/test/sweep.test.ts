import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'

import { approvals } from '@humanlayer/db/tables/approvals'
import { onlineHosts } from '@humanlayer/db/tables/online-hosts'
import { organizations } from '@humanlayer/db/tables/organizations'
import { DAEMON_ACTIVE_SESSION_STATUSES, sessions, type SessionStatus } from '@humanlayer/db/tables/sessions'
import { and, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { runStaleDaemonSweep, sweepStaleDaemonBatch, type Database } from '../index'
import { reconcileStaleDaemons, type StaleDaemonBatchResult } from '../stale-daemons'
import { createTestDb } from './test-db'

const emptyBatch = (): StaleDaemonBatchResult => ({
	registrationsMarkedOffline: 0,
	sessionsFailed: 0,
	approvalsRejected: 0,
})

function orchestrationDependencies(overrides: Parameters<typeof runStaleDaemonSweep>[0] = {}) {
	return {
		loadDatabaseUrl: async () => 'postgres://test',
		createDatabaseConnection: async () => ({ db: {} as Database, close: async () => {} }),
		reconcileStaleDaemons: async () => ({ ...emptyBatch(), batchesCompleted: 0 }),
		reconcileLostSessions: async () => ({
			batchesCompleted: 0,
			sessionsMarkedLost: 0,
			sessionsExemptedByOpenTools: 0,
		}),
		flushSentry: async () => true,
		reconcileExpiredEphemeralHosts: async () => ({ registrationsDeleted: 0, batchesCompleted: 0 }),
		reconcileExpiredOfflineHosts: async () => ({ registrationsDeleted: 0, batchesCompleted: 0 }),
		logSummary: () => {},
		...overrides,
	}
}

describe('runStaleDaemonSweep', () => {
	test.each([false, true])('flushes and closes after success (flush fails: %s)', async (flushFails) => {
		const events: string[] = []
		const error = new Error('flush failed')
		const sweep = runStaleDaemonSweep(
			orchestrationDependencies({
				createDatabaseConnection: async () => ({
					db: {} as Database,
					close: async () => {
						events.push('close')
					},
				}),
				logSummary: () => {
					events.push('summary')
				},
				flushSentry: async () => {
					events.push('flush')
					if (flushFails) throw error
				},
			}),
		)
		if (flushFails) await expect(sweep).rejects.toBe(error)
		else expect((await sweep).success).toBe(true)
		expect(events).toEqual(['summary', 'flush', 'close'])
	})

	test.each(['daemons', 'lost', 'ephemeral', 'offline'] as const)(
		'stops at a failing %s pass and finalizes the connection',
		async (failingPass) => {
			const calls: string[] = []
			const error = new Error(`${failingPass} failed`)
			function record(pass: string) {
				calls.push(pass)
				if (pass === failingPass) throw error
			}
			await expect(
				runStaleDaemonSweep(
					orchestrationDependencies({
						createDatabaseConnection: async () => ({
							db: {} as Database,
							close: async () => {
								calls.push('close')
							},
						}),
						reconcileStaleDaemons: async () => {
							record('daemons')
							return { ...emptyBatch(), batchesCompleted: 0 }
						},
						reconcileLostSessions: async () => {
							record('lost')
							return { batchesCompleted: 0, sessionsMarkedLost: 0, sessionsExemptedByOpenTools: 0 }
						},
						reconcileExpiredEphemeralHosts: async () => {
							record('ephemeral')
							return { registrationsDeleted: 0, batchesCompleted: 0 }
						},
						reconcileExpiredOfflineHosts: async () => {
							record('offline')
							return { registrationsDeleted: 0, batchesCompleted: 0 }
						},
						captureException: (captured) => {
							expect(captured).toBe(error)
							calls.push('capture')
						},
						flushSentry: async () => {
							calls.push('flush')
						},
						logSummary: () => {
							calls.push('summary')
						},
					}),
				),
			).rejects.toBe(error)
			const passes = ['daemons', 'lost', 'ephemeral', 'offline']
			expect(calls).toEqual([...passes.slice(0, passes.indexOf(failingPass) + 1), 'capture', 'flush', 'close'])
		},
	)

	test('runs daemon cleanup before lost cleanup with one fixed invocation time', async () => {
		const calls: string[] = []
		const cutoffs: bigint[] = []
		const result = await runStaleDaemonSweep(
			orchestrationDependencies({
				now: () => 1_000_000,
				reconcileStaleDaemons: async (_db, cutoff) => {
					calls.push('daemons')
					cutoffs.push(cutoff)
					return {
						batchesCompleted: 2,
						registrationsMarkedOffline: 125,
						sessionsFailed: 90,
						approvalsRejected: 25,
					}
				},
				reconcileLostSessions: async (_db, now) => {
					calls.push('lost')
					cutoffs.push(now)
					return { batchesCompleted: 1, sessionsMarkedLost: 4, sessionsExemptedByOpenTools: 2 }
				},
				reconcileExpiredEphemeralHosts: async (_db, cutoff) => {
					calls.push('ephemeral')
					cutoffs.push(cutoff)
					return { batchesCompleted: 2, registrationsDeleted: 101 }
				},
				reconcileExpiredOfflineHosts: async (_db, cutoff) => {
					calls.push('offline')
					cutoffs.push(cutoff)
					return { batchesCompleted: 1, registrationsDeleted: 3 }
				},
			}),
		)

		expect(calls).toEqual(['daemons', 'lost', 'ephemeral', 'offline'])
		expect(cutoffs).toEqual([880_000n, 1_000_000n, 400_000n, -7_775_000_000n])
		expect(result).toMatchObject({
			invocationTime: 1_000_000n,
			staleDaemons: { batchesCompleted: 2, registrationsMarkedOffline: 125 },
			lostSessions: { batchesCompleted: 1, sessionsMarkedLost: 4, sessionsExemptedByOpenTools: 2 },
			ephemeralHostCutoff: 400_000n,
			offlineHostCutoff: -7_775_000_000n,
			expiredEphemeralHosts: { batchesCompleted: 2, registrationsDeleted: 101 },
			expiredOfflineHosts: { batchesCompleted: 1, registrationsDeleted: 3 },
		})
	})

	test('runs daemon batches until no eligible rows remain without a work deadline', async () => {
		const batches = [
			{ registrationsMarkedOffline: 100, sessionsFailed: 80, approvalsRejected: 20 },
			{ registrationsMarkedOffline: 25, sessionsFailed: 10, approvalsRejected: 5 },
			emptyBatch(),
		]
		const result = await reconcileStaleDaemons(
			{} as Database,
			880_000n,
			async () => batches.shift() ?? emptyBatch(),
		)
		expect(result).toEqual({
			batchesCompleted: 2,
			registrationsMarkedOffline: 125,
			sessionsFailed: 90,
			approvalsRejected: 25,
		})
	})

	test('captures and rethrows batch failures, then flushes and closes', async () => {
		const error = new Error('batch failed')
		const events: string[] = []
		await expect(
			runStaleDaemonSweep(
				orchestrationDependencies({
					now: () => 1_000,
					createDatabaseConnection: async () => ({
						db: {} as Database,
						close: async () => {
							events.push('close')
						},
					}),
					reconcileStaleDaemons: async () => {
						throw error
					},
					captureException: (captured) => {
						expect(captured).toBe(error)
						events.push('capture')
					},
					flushSentry: async () => {
						events.push('flush')
					},
				}),
			),
		).rejects.toBe(error)
		expect(events).toEqual(['capture', 'flush', 'close'])
	})
})

describe('sweepStaleDaemonBatch with Postgres', () => {
	let testDb: Awaited<ReturnType<typeof createTestDb>>
	let organizationId: string
	let otherOrganizationId: string

	beforeAll(async () => {
		testDb = await createTestDb()
		const inserted = await testDb.db
			.insert(organizations)
			.values([
				{ name: 'Sweeper Org', workos_organization_id: `org_${randomUUID()}` },
				{ name: 'Other Sweeper Org', workos_organization_id: `org_${randomUUID()}` },
			])
			.returning()
		organizationId = inserted[0]!.id
		otherOrganizationId = inserted[1]!.id
	}, 60_000)

	beforeEach(async () => {
		await testDb.db.delete(approvals)
		await testDb.db.delete(sessions)
		await testDb.db.delete(onlineHosts)
	})

	afterAll(async () => {
		await testDb?.cleanup()
	}, 60_000)

	test('honors the strict cutoff, status, last_seen, and full composite identity', async () => {
		const cutoff = 1_000_000n
		const hostId = randomUUID()
		const staleUser = `user_${randomUUID()}`
		const boundaryUser = `user_${randomUUID()}`
		const taskOwnerUser = `user_${randomUUID()}`
		const freshUser = `user_${randomUUID()}`
		const offlineUser = `user_${randomUUID()}`

		await testDb.db.insert(onlineHosts).values([
			{ host_id: hostId, organization_id: organizationId, user_id: staleUser, last_seen: cutoff - 1n },
			{ host_id: hostId, organization_id: organizationId, user_id: boundaryUser, last_seen: cutoff },
			{ host_id: hostId, organization_id: otherOrganizationId, user_id: staleUser, last_seen: cutoff - 1n },
			{ host_id: hostId, organization_id: organizationId, user_id: freshUser, last_seen: cutoff + 1n },
			{
				host_id: hostId,
				organization_id: organizationId,
				user_id: offlineUser,
				last_seen: cutoff - 1n,
				status: 'offline',
			},
		])

		const [staleSession, boundarySession] = await testDb.db
			.insert(sessions)
			.values([
				{
					coding_agent: 'claude',
					created_by: staleUser,
					host_id: hostId,
					model: 'claude-sonnet-4-5',
					organization_id: organizationId,
					permissions_mode: 'default',
					provider: 'anthropic',
					resource_owner_user_id: taskOwnerUser,
					status: 'needs_approval',
					title: 'stale session',
					working_directory: tmpdir(),
				},
				{
					coding_agent: 'claude',
					created_by: boundaryUser,
					host_id: hostId,
					model: 'claude-sonnet-4-5',
					organization_id: organizationId,
					permissions_mode: 'default',
					provider: 'anthropic',
					resource_owner_user_id: staleUser,
					status: 'needs_approval',
					title: 'boundary session',
					working_directory: tmpdir(),
				},
			])
			.returning()

		const [staleApproval, boundaryApproval] = await testDb.db
			.insert(approvals)
			.values([
				{
					host_id: hostId,
					organization_id: organizationId,
					resource_owner_user_id: taskOwnerUser,
					session_id: staleSession!.id,
					status: 'pending',
					tool_input: {},
					tool_name: 'Bash',
					user_id: staleUser,
				},
				{
					host_id: hostId,
					organization_id: organizationId,
					resource_owner_user_id: staleUser,
					session_id: boundarySession!.id,
					status: 'pending',
					tool_input: {},
					tool_name: 'Bash',
					user_id: boundaryUser,
				},
			])
			.returning()

		const result = await sweepStaleDaemonBatch(testDb.db, cutoff)
		expect(result).toEqual({ registrationsMarkedOffline: 2, sessionsFailed: 1, approvalsRejected: 1 })

		const rows = await testDb.db.select().from(onlineHosts).where(eq(onlineHosts.host_id, hostId))
		expect(rows.find((row) => row.user_id === staleUser && row.organization_id === organizationId)).toMatchObject({
			status: 'offline',
			last_seen: cutoff - 1n,
		})
		expect(rows.find((row) => row.user_id === boundaryUser)).toMatchObject({ status: 'online' })
		expect(rows.find((row) => row.user_id === freshUser)).toMatchObject({ status: 'online' })
		expect(rows.find((row) => row.user_id === offlineUser)).toMatchObject({ status: 'offline' })

		const [staleSessionAfter] = await testDb.db.select().from(sessions).where(eq(sessions.id, staleSession!.id))
		const [boundarySessionAfter] = await testDb.db
			.select()
			.from(sessions)
			.where(eq(sessions.id, boundarySession!.id))
		const [staleApprovalAfter] = await testDb.db.select().from(approvals).where(eq(approvals.id, staleApproval!.id))
		const [boundaryApprovalAfter] = await testDb.db
			.select()
			.from(approvals)
			.where(eq(approvals.id, boundaryApproval!.id))
		expect(staleSessionAfter?.status).toBe('failed')
		expect(boundarySessionAfter?.status).toBe('needs_approval')
		expect(staleApprovalAfter?.status).toBe('denied')
		expect(boundaryApprovalAfter?.status).toBe('pending')
	})

	test('fails only daemon-active session statuses', async () => {
		const cutoff = 1_500_000n
		const hostId = randomUUID()
		const userId = `user_${randomUUID()}`
		const preservedStatuses: SessionStatus[] = [
			'ready_for_launch',
			'waiting_for_workspace',
			'draft',
			'failed',
			'ready_for_input',
			'interrupt_requested',
			'interrupted',
		]

		await testDb.db.insert(onlineHosts).values({
			host_id: hostId,
			organization_id: organizationId,
			user_id: userId,
			last_seen: cutoff - 1n,
		})
		const insertedSessions = await testDb.db
			.insert(sessions)
			.values(
				[...DAEMON_ACTIVE_SESSION_STATUSES, ...preservedStatuses].map((status) => ({
					coding_agent: 'claude' as const,
					created_by: userId,
					host_id: hostId,
					model: 'claude-sonnet-4-5',
					organization_id: organizationId,
					permissions_mode: 'default' as const,
					provider: 'anthropic',
					resource_owner_user_id: userId,
					status,
					title: `session-${status}`,
					working_directory: tmpdir(),
				})),
			)
			.returning()
		const interruptRequestedSession = insertedSessions.find((session) => session.status === 'interrupt_requested')
		if (!interruptRequestedSession) throw new Error('Expected an interrupt_requested session fixture')
		const [interruptApproval] = await testDb.db
			.insert(approvals)
			.values({
				host_id: hostId,
				organization_id: organizationId,
				resource_owner_user_id: userId,
				session_id: interruptRequestedSession.id,
				status: 'pending',
				tool_input: {},
				tool_name: 'Bash',
				user_id: userId,
			})
			.returning()
		if (!interruptApproval) throw new Error('Expected a pending approval fixture')

		const result = await sweepStaleDaemonBatch(testDb.db, cutoff)
		expect(result.sessionsFailed).toBe(DAEMON_ACTIVE_SESSION_STATUSES.length)
		expect(result.approvalsRejected).toBe(1)

		const sessionsAfter = await testDb.db.select().from(sessions)
		const activeStatuses = new Set<SessionStatus>(DAEMON_ACTIVE_SESSION_STATUSES)
		for (const sessionBefore of insertedSessions) {
			const sessionAfter = sessionsAfter.find((session) => session.id === sessionBefore.id)
			const expectedStatus = activeStatuses.has(sessionBefore.status)
				? 'failed'
				: sessionBefore.status === 'interrupt_requested'
					? 'interrupted'
					: sessionBefore.status
			expect(sessionAfter?.status).toBe(expectedStatus)
		}
		const [interruptApprovalAfter] = await testDb.db
			.select()
			.from(approvals)
			.where(eq(approvals.id, interruptApproval.id))
		expect(interruptApprovalAfter).toMatchObject({ status: 'denied', comment: 'Daemon timed out' })
	})

	test('processes at most 100 registrations per transaction', async () => {
		const cutoff = 2_000_000n
		const userId = `user_${randomUUID()}`
		const hosts = Array.from({ length: 101 }, () => ({
			host_id: randomUUID(),
			organization_id: organizationId,
			user_id: userId,
			last_seen: cutoff - 1n,
		}))
		await testDb.db.insert(onlineHosts).values(hosts)

		expect((await sweepStaleDaemonBatch(testDb.db, cutoff)).registrationsMarkedOffline).toBe(100)
		expect((await sweepStaleDaemonBatch(testDb.db, cutoff)).registrationsMarkedOffline).toBe(1)
	})

	test('skips rows locked by another invocation and processes them later', async () => {
		const cutoff = 3_000_000n
		const hostId = randomUUID()
		const userId = `user_${randomUUID()}`
		await testDb.db.insert(onlineHosts).values({
			host_id: hostId,
			organization_id: organizationId,
			user_id: userId,
			last_seen: cutoff - 1n,
		})

		const locker = postgres(testDb.databaseUrl, { max: 1 })
		let announceLocked = () => {}
		const locked = new Promise<void>((resolve) => {
			announceLocked = resolve
		})
		let releaseLock = () => {}
		const release = new Promise<void>((resolve) => {
			releaseLock = resolve
		})
		const lock = locker.begin(async (tx) => {
			await tx`SELECT 1 FROM online_hosts WHERE host_id = ${hostId} AND organization_id = ${organizationId} AND user_id = ${userId} FOR UPDATE`
			announceLocked()
			await release
		})

		try {
			await locked
			expect((await sweepStaleDaemonBatch(testDb.db, cutoff)).registrationsMarkedOffline).toBe(0)
		} finally {
			releaseLock()
			await lock
			await locker.end({ timeout: 5 })
		}

		expect((await sweepStaleDaemonBatch(testDb.db, cutoff)).registrationsMarkedOffline).toBe(1)
	})

	test('rolls back registration, session, and approval changes when the transaction fails', async () => {
		const cutoff = 4_000_000n
		const hostId = randomUUID()
		const userId = `user_${randomUUID()}`
		await testDb.db.insert(onlineHosts).values({
			host_id: hostId,
			organization_id: organizationId,
			user_id: userId,
			last_seen: cutoff - 1n,
		})
		const [session] = await testDb.db
			.insert(sessions)
			.values({
				coding_agent: 'claude',
				created_by: userId,
				host_id: hostId,
				model: 'claude-sonnet-4-5',
				organization_id: organizationId,
				permissions_mode: 'default',
				provider: 'anthropic',
				resource_owner_user_id: userId,
				status: 'needs_approval',
				title: 'rollback session',
				working_directory: tmpdir(),
			})
			.returning()
		const [approval] = await testDb.db
			.insert(approvals)
			.values({
				host_id: hostId,
				organization_id: organizationId,
				resource_owner_user_id: userId,
				session_id: session!.id,
				status: 'pending',
				tool_input: {},
				tool_name: 'Bash',
				user_id: userId,
			})
			.returning()

		await testDb.client.unsafe(`
			CREATE FUNCTION reject_sweeper_approval_update() RETURNS trigger AS $$
			BEGIN RAISE EXCEPTION 'forced approval failure'; END;
			$$ LANGUAGE plpgsql;
			CREATE TRIGGER reject_sweeper_approval_update
			BEFORE UPDATE ON approvals FOR EACH ROW EXECUTE FUNCTION reject_sweeper_approval_update();
		`)
		await expect(sweepStaleDaemonBatch(testDb.db, cutoff)).rejects.toThrow('Failed query')
		await testDb.client.unsafe(`DROP TRIGGER reject_sweeper_approval_update ON approvals`)
		await testDb.client.unsafe(`DROP FUNCTION reject_sweeper_approval_update()`)

		const [hostAfter] = await testDb.db
			.select()
			.from(onlineHosts)
			.where(
				and(
					eq(onlineHosts.host_id, hostId),
					eq(onlineHosts.organization_id, organizationId),
					eq(onlineHosts.user_id, userId),
				),
			)
		const [sessionAfter] = await testDb.db.select().from(sessions).where(eq(sessions.id, session!.id))
		const [approvalAfter] = await testDb.db.select().from(approvals).where(eq(approvals.id, approval!.id))
		expect(hostAfter?.status).toBe('online')
		expect(sessionAfter?.status).toBe('needs_approval')
		expect(approvalAfter?.status).toBe('pending')
	})

	test('allows concurrent invocations without transitioning a row twice', async () => {
		const cutoff = 5_000_000n
		const hostId = randomUUID()
		const userId = `user_${randomUUID()}`
		await testDb.db.insert(onlineHosts).values({
			host_id: hostId,
			organization_id: organizationId,
			user_id: userId,
			last_seen: cutoff - 1n,
		})
		const secondClient = postgres(testDb.databaseUrl, { max: 1 })
		const secondDb = drizzle(secondClient)
		const results = await Promise.all([
			sweepStaleDaemonBatch(testDb.db, cutoff),
			sweepStaleDaemonBatch(secondDb, cutoff),
		])
		expect(results.reduce((total, result) => total + result.registrationsMarkedOffline, 0)).toBe(1)
		await secondClient.end({ timeout: 5 })
	})
})
