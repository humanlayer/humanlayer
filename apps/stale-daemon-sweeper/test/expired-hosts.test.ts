import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { agentSlashCommands } from '@humanlayer/db/tables/agent-slash-commands'
import { hostAliases } from '@humanlayer/db/tables/host-aliases'
import { onlineHosts } from '@humanlayer/db/tables/online-hosts'
import { organizations } from '@humanlayer/db/tables/organizations'
import { providerLoginRequests } from '@humanlayer/db/tables/provider-login-requests'
import { sessions } from '@humanlayer/db/tables/sessions'
import { and, asc, eq, inArray, lt, sql, type SQLWrapper } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import z from 'zod/v4'

import {
	deleteHostRegistrations,
	expiredHostCandidates,
	hostRegistrationDeletes,
	reconcileExpiredEphemeralHosts,
	reconcileExpiredOfflineHosts,
	sweepExpiredHostBatch,
} from '../expired-hosts'
import { createDatabaseConnection, runStaleDaemonSweep } from '../index'
import { createTestDb } from './test-db'

const cutoff = 10_000_000_000n
const planNodeSchema = z.object({
	'Node Type': z.string(),
	'Index Cond': z.string().optional(),
	Filter: z.string().optional(),
	'Recheck Cond': z.string().optional(),
	'Actual Rows': z.number(),
	'Actual Loops': z.number(),
	'Rows Removed by Filter': z.number().optional(),
	'Rows Removed by Index Recheck': z.number().optional(),
	'Relation Name': z.string().optional(),
	Plans: z.array(z.unknown()).optional(),
})
function planNodes(value: unknown): z.infer<typeof planNodeSchema>[] {
	const node = planNodeSchema.parse(value)
	return [node, ...(node.Plans ?? []).flatMap(planNodes)]
}

function scanWork(nodes: z.infer<typeof planNodeSchema>[]) {
	return nodes
		.filter((node) => node['Node Type'].includes('Scan'))
		.reduce(
			(sum, node) =>
				sum +
				(node['Actual Rows'] +
					(node['Rows Removed by Filter'] ?? 0) +
					(node['Rows Removed by Index Recheck'] ?? 0)) *
					node['Actual Loops'],
			0,
		)
}

describe('expired host cleanup with Postgres', () => {
	let testDb: Awaited<ReturnType<typeof createTestDb>>
	let organizationId: string
	let otherOrganizationId: string

	beforeAll(async () => {
		testDb = await createTestDb('expired_hosts')
		const orgs = await testDb.db
			.insert(organizations)
			.values([
				{ name: 'Cleanup', workos_organization_id: `org_${randomUUID()}` },
				{ name: 'Other cleanup', workos_organization_id: `org_${randomUUID()}` },
			])
			.returning()
		const [first, second] = orgs
		if (!first || !second) throw new Error('Missing organization fixtures')
		organizationId = first.id
		otherOrganizationId = second.id
	}, 60_000)

	beforeEach(async () => {
		await testDb.db.delete(agentSlashCommands)
		await testDb.db.delete(hostAliases)
		await testDb.db.delete(providerLoginRequests)
		await testDb.db.delete(sessions)
		await testDb.db.delete(onlineHosts)
	})
	afterAll(async () => {
		await testDb?.cleanup()
	}, 60_000)

	function registration(overrides: Partial<typeof onlineHosts.$inferInsert> = {}) {
		return {
			host_id: randomUUID(),
			organization_id: organizationId,
			user_id: `user_${randomUUID()}`,
			last_seen: cutoff - 1n,
			ephemeral: true,
			...overrides,
		}
	}
	async function seedCaches(rows: ReturnType<typeof registration>[]) {
		await testDb.db.insert(onlineHosts).values(rows)
		await testDb.db.insert(hostAliases).values(
			rows.map((row) => ({
				host_id: row.host_id,
				organization_id: row.organization_id,
				user_id: row.user_id,
				display_name: 'Custom name',
			})),
		)
		await testDb.db.insert(agentSlashCommands).values(
			rows.flatMap((row) =>
				['claude', 'codex'].flatMap((agent) =>
					['', '/workspace'].map((workspace_path) => ({
						host_id: row.host_id,
						organization_id: row.organization_id,
						user_id: row.user_id,
						agent,
						workspace_path,
						commands: [],
						skills: [],
					})),
				),
			),
		)
	}
	async function assertCachesPresent() {
		expect(await testDb.db.select().from(onlineHosts)).toHaveLength(1)
		expect(await testDb.db.select().from(hostAliases)).toHaveLength(1)
		expect(await testDb.db.select().from(agentSlashCommands)).toHaveLength(4)
	}

	test('strict ephemeral boundary, both statuses, full identity scoping and history preservation', async () => {
		const target = registration()
		const controls = [
			registration({ last_seen: cutoff }),
			registration({ last_seen: cutoff + 1n }),
			registration({ ephemeral: false }),
			registration({
				host_id: target.host_id,
				user_id: target.user_id,
				organization_id: otherOrganizationId,
				last_seen: cutoff,
			}),
			registration({ host_id: target.host_id, last_seen: cutoff }),
		]
		await seedCaches([target, registration({ status: 'offline' }), ...controls])
		await testDb.db.insert(sessions).values({
			host_id: target.host_id,
			organization_id: organizationId,
			created_by: target.user_id,
			resource_owner_user_id: target.user_id,
			coding_agent: 'claude',
			model: 'claude-sonnet-4-5',
			permissions_mode: 'default',
			provider: 'anthropic',
			status: 'ready_for_input',
			title: 'Historical session',
			working_directory: tmpdir(),
		})
		await testDb.db.insert(providerLoginRequests).values({
			host_id: target.host_id,
			organization_id: organizationId,
			user_id: target.user_id,
			provider: 'claude',
			expires_at: cutoff,
		})
		const history = await testDb.db.select().from(sessions)
		const logins = await testDb.db.select().from(providerLoginRequests)
		expect(await reconcileExpiredEphemeralHosts(testDb.db, cutoff)).toEqual({
			registrationsDeleted: 2,
			batchesCompleted: 1,
		})
		const survivors = await testDb.db.select().from(onlineHosts)
		expect(survivors.map((row) => [row.host_id, row.organization_id, row.user_id]).sort()).toEqual(
			controls.map((row) => [row.host_id, row.organization_id, row.user_id]).sort(),
		)
		const aliases = await testDb.db.select().from(hostAliases)
		expect(aliases.map((row) => [row.host_id, row.organization_id, row.user_id]).sort()).toEqual(
			controls.map((row) => [row.host_id, row.organization_id, row.user_id]).sort(),
		)
		const commands = await testDb.db.select().from(agentSlashCommands)
		expect(
			commands
				.map((row) => [row.host_id, row.organization_id, row.user_id, row.agent, row.workspace_path])
				.sort(),
		).toEqual(
			controls
				.flatMap((row) =>
					['claude', 'codex'].flatMap((agent) =>
						['', '/workspace'].map((path) => [row.host_id, row.organization_id, row.user_id, agent, path]),
					),
				)
				.sort(),
		)
		expect(await testDb.db.select().from(sessions)).toEqual(history)
		expect(await testDb.db.select().from(providerLoginRequests)).toEqual(logins)
	})

	test('offline retention uses a strict cutoff and never deletes online rows', async () => {
		await seedCaches([
			registration({ ephemeral: false, status: 'offline' }),
			registration({ status: 'offline', last_seen: cutoff }),
			registration({ status: 'offline', last_seen: cutoff + 1n }),
			registration({ ephemeral: false, status: 'online' }),
		])
		expect(await reconcileExpiredOfflineHosts(testDb.db, cutoff)).toEqual({
			registrationsDeleted: 1,
			batchesCompleted: 1,
		})
		expect(await testDb.db.select().from(onlineHosts)).toHaveLength(3)
		expect(await testDb.db.select().from(hostAliases)).toHaveLength(3)
		expect(await testDb.db.select().from(agentSlashCommands)).toHaveLength(12)
	})

	test('drains more than 100 registrations in bounded batches and reruns as a no-op', async () => {
		await seedCaches(Array.from({ length: 205 }, () => registration()))
		expect(await sweepExpiredHostBatch(testDb.db, cutoff, 'ephemeral')).toEqual({ registrationsDeleted: 100 })
		expect(await reconcileExpiredEphemeralHosts(testDb.db, cutoff)).toEqual({
			registrationsDeleted: 105,
			batchesCompleted: 2,
		})
		expect(await reconcileExpiredEphemeralHosts(testDb.db, cutoff)).toEqual({
			registrationsDeleted: 0,
			batchesCompleted: 0,
		})
		expect(await testDb.db.select().from(hostAliases)).toEqual([])
		expect(await testDb.db.select().from(agentSlashCommands)).toEqual([])
	})

	test('holds candidate locks through all deletes; a later heartbeat upsert recreates only the registration', async () => {
		const target = registration()
		await seedCaches([target])
		const deleted = Promise.withResolvers<void>()
		const release = Promise.withResolvers<void>()
		const transaction = testDb.db.transaction(async (tx) => {
			const keys = await expiredHostCandidates(tx, cutoff, 'ephemeral')
			await deleteHostRegistrations(tx, keys)
			deleted.resolve()
			await release.promise
		})
		void transaction.catch(deleted.reject)
		const heartbeatClient = postgres(testDb.databaseUrl, { max: 1 })
		let heartbeat: Promise<unknown> | undefined
		try {
			await deleted.promise
			expect(await sweepExpiredHostBatch(testDb.db, cutoff, 'ephemeral')).toEqual({ registrationsDeleted: 0 })
			heartbeat = drizzle(heartbeatClient)
				.insert(onlineHosts)
				.values({ ...target, last_seen: cutoff + 1n })
				.onConflictDoUpdate({
					target: [onlineHosts.host_id, onlineHosts.organization_id, onlineHosts.user_id],
					set: { last_seen: cutoff + 1n, status: 'online' },
				})
				.execute()
			release.resolve()
			await transaction
			await heartbeat
			expect((await testDb.db.select().from(onlineHosts))[0]).toMatchObject({
				last_seen: cutoff + 1n,
				status: 'online',
			})
			expect(await testDb.db.select().from(hostAliases)).toEqual([])
			expect(await testDb.db.select().from(agentSlashCommands)).toEqual([])
		} finally {
			release.resolve()
			try {
				await transaction
				await heartbeat
			} finally {
				await heartbeatClient.end({ timeout: 5 })
			}
		}
	})

	test('a full invocation reconciles stale online registrations before applying either retention rule', async () => {
		const now = cutoff
		const ephemeral = registration({ last_seen: now - 600_001n })
		const ancient = registration({ ephemeral: false, last_seen: now - 7_776_000_001n })
		const fresh = registration({ last_seen: now })
		await seedCaches([ephemeral, ancient, fresh])
		const result = await runStaleDaemonSweep({
			now: () => Number(now),
			loadDatabaseUrl: async () => testDb.databaseUrl,
			flushSentry: async () => true,
			captureException: () => {},
			logSummary: () => {},
		})
		expect(result.staleDaemons.registrationsMarkedOffline).toBe(2)
		expect(result.expiredEphemeralHosts.registrationsDeleted).toBe(1)
		expect(result.expiredOfflineHosts.registrationsDeleted).toBe(1)
		expect((await testDb.db.select().from(onlineHosts)).map((row) => row.host_id)).toEqual([fresh.host_id])
		expect(await testDb.db.select().from(hostAliases)).toHaveLength(1)
		expect(await testDb.db.select().from(agentSlashCommands)).toHaveLength(4)
	})

	test('skips an explicitly locked candidate; a winning heartbeat refresh prevents deletion', async () => {
		const target = registration()
		await seedCaches([target])
		const locker = postgres(testDb.databaseUrl, { max: 1 })
		const locked = Promise.withResolvers<void>()
		const release = Promise.withResolvers<void>()
		const transaction = locker.begin(async (tx) => {
			await tx`SELECT 1 FROM online_hosts WHERE host_id = ${target.host_id} FOR UPDATE`
			locked.resolve()
			await release.promise
			await tx`UPDATE online_hosts SET last_seen = ${cutoff.toString()}, status = 'online' WHERE host_id = ${target.host_id}`
		})
		// Propagate lock acquisition errors rather than hanging on the readiness gate.
		void transaction.catch(locked.reject)
		try {
			await locked.promise
			expect(await reconcileExpiredEphemeralHosts(testDb.db, cutoff)).toEqual({
				registrationsDeleted: 0,
				batchesCompleted: 0,
			})
			await assertCachesPresent()
		} finally {
			release.resolve()
			try {
				await transaction
			} finally {
				await locker.end({ timeout: 5 })
			}
		}
		expect((await reconcileExpiredEphemeralHosts(testDb.db, cutoff)).registrationsDeleted).toBe(0)
		await assertCachesPresent()
		await testDb.db.update(onlineHosts).set({ last_seen: cutoff - 1n })
		expect((await reconcileExpiredEphemeralHosts(testDb.db, cutoff)).registrationsDeleted).toBe(1)
	})

	test('last-delete failure rolls back all three tables and leaves earlier batches committed', async () => {
		await seedCaches(
			Array.from({ length: 101 }, (_, index) => registration({ last_seen: cutoff - 101n + BigInt(index) })),
		)
		const [last] = await testDb.db
			.select()
			.from(onlineHosts)
			.orderBy(sql`${onlineHosts.last_seen} DESC`)
			.limit(1)
		if (!last) throw new Error('Missing last registration')
		await testDb.client.unsafe(
			`CREATE FUNCTION reject_cleanup() RETURNS trigger AS $$ BEGIN IF OLD.host_id = '${last.host_id}' THEN RAISE EXCEPTION 'forced cleanup failure'; END IF; RETURN OLD; END; $$ LANGUAGE plpgsql; CREATE TRIGGER reject_cleanup BEFORE DELETE ON agent_slash_commands FOR EACH ROW EXECUTE FUNCTION reject_cleanup();`,
		)
		try {
			await expect(reconcileExpiredEphemeralHosts(testDb.db, cutoff)).rejects.toThrow('Failed query')
			await assertCachesPresent()
			expect((await testDb.db.select().from(onlineHosts))[0]?.host_id).toBe(last.host_id)
		} finally {
			await testDb.client.unsafe(
				'DROP TRIGGER reject_cleanup ON agent_slash_commands; DROP FUNCTION reject_cleanup();',
			)
		}
	})

	test('production connection has PostgreSQL-enforced statement and lock limits', async () => {
		const connection = await createDatabaseConnection(testDb.databaseUrl)
		try {
			expect((await connection.db.execute(sql`SHOW statement_timeout`))[0]).toMatchObject({
				statement_timeout: '10s',
			})
			expect((await connection.db.execute(sql`SHOW lock_timeout`))[0]).toMatchObject({ lock_timeout: '1s' })
		} finally {
			await connection.close()
		}
	})

	test.each(['statement', 'lock'] as const)(
		'%s timeout rolls back the batch, captures failure and closes the connection',
		async (kind) => {
			const target = registration()
			await seedCaches([target])
			const client = postgres(testDb.databaseUrl, {
				max: 1,
				connection: { statement_timeout: 2_000, lock_timeout: 50 },
			})
			const locker = postgres(testDb.databaseUrl, { max: 1 })
			const locked = Promise.withResolvers<void>()
			const release = Promise.withResolvers<void>()
			let lock: Promise<unknown> | undefined
			let triggerCreated = false
			const events: string[] = []
			let captured: unknown
			try {
				if (kind === 'statement') {
					await client`SET statement_timeout = '50ms'`
					// Deliberately slow server SQL tests cancellation, not synchronization.
					await testDb.client.unsafe(
						'CREATE FUNCTION slow_cleanup() RETURNS trigger AS $$ BEGIN PERFORM pg_sleep(1); RETURN OLD; END; $$ LANGUAGE plpgsql; CREATE TRIGGER slow_cleanup BEFORE DELETE ON agent_slash_commands FOR EACH ROW EXECUTE FUNCTION slow_cleanup();',
					)
					triggerCreated = true
				} else {
					lock = locker.begin(async (tx) => {
						await tx`SELECT 1 FROM agent_slash_commands WHERE host_id = ${target.host_id} FOR UPDATE`
						locked.resolve()
						await release.promise
					})
					void lock.catch(locked.reject)
					await locked.promise
				}
				await expect(
					runStaleDaemonSweep({
						now: () => Number(cutoff + 600_000n),
						loadDatabaseUrl: async () => testDb.databaseUrl,
						createDatabaseConnection: async () => ({
							db: drizzle(client),
							close: async () => {
								events.push('close')
								await client.end({ timeout: 5 })
							},
						}),
						reconcileStaleDaemons: async () => ({
							registrationsMarkedOffline: 0,
							sessionsFailed: 0,
							approvalsRejected: 0,
							batchesCompleted: 0,
						}),
						reconcileLostSessions: async () => ({
							batchesCompleted: 0,
							sessionsMarkedLost: 0,
							sessionsExemptedByOpenTools: 0,
						}),
						reconcileExpiredOfflineHosts: async () => {
							events.push('offline')
							return { registrationsDeleted: 0, batchesCompleted: 0 }
						},
						captureException: (error) => {
							captured = error
							events.push('capture')
						},
						flushSentry: async () => {
							events.push('flush')
						},
						logSummary: () => {
							events.push('summary')
						},
					}),
				).rejects.toThrow('Failed query')
				expect(captured).toBeDefined()
				expect(z.object({ cause: z.object({ code: z.string() }) }).parse(captured).cause.code).toBe(
					kind === 'statement' ? '57014' : '55P03',
				)
				expect(events).toEqual(['capture', 'flush', 'close'])
				await assertCachesPresent()
			} finally {
				release.resolve()
				try {
					await lock
				} finally {
					await locker.end({ timeout: 5 })
					await client.end({ timeout: 5 })
					if (triggerCreated)
						await testDb.client.unsafe(
							'DROP TRIGGER slow_cleanup ON agent_slash_commands; DROP FUNCTION slow_cleanup();',
						)
				}
			}
		},
	)

	test('sparse-candidate plans bound candidate work and scope all bulk deletes without planner overrides', async () => {
		// Many registrations per user, not one user per host: otherwise the planner
		// can legitimately use (organization_id, user_id) and filter host_id later.
		const userIds = Array.from({ length: 10 }, () => `user_${randomUUID()}`)
		const recent = Array.from({ length: 10_000 }, (_, index) =>
			registration({
				organization_id: index % 2 === 0 ? organizationId : otherOrganizationId,
				user_id: userIds[index % userIds.length],
				ephemeral: index % 2 === 0,
				last_seen: cutoff + BigInt(index),
				status: index % 3 === 0 ? ('offline' as const) : ('online' as const),
			}),
		)
		const expired = [
			registration({ user_id: userIds[0] }),
			registration({
				user_id: userIds[1],
				organization_id: otherOrganizationId,
				ephemeral: false,
				status: 'offline',
			}),
			registration({ user_id: userIds[2], ephemeral: false }),
		]
		const identityControls = expired.flatMap((row) => [
			registration({
				host_id: row.host_id,
				organization_id: row.organization_id,
				last_seen: cutoff,
				ephemeral: false,
			}),
			registration({
				host_id: row.host_id,
				user_id: row.user_id,
				organization_id: row.organization_id === organizationId ? otherOrganizationId : organizationId,
				last_seen: cutoff,
				ephemeral: false,
			}),
		])
		// Stay below PostgreSQL's bind parameter limit.
		for (let offset = 0; offset < recent.length; offset += 1_000)
			await seedCaches(recent.slice(offset, offset + 1_000))
		await seedCaches(expired)
		await seedCaches(identityControls)
		await testDb.db.execute(sql`ANALYZE online_hosts`)
		await testDb.db.execute(sql`ANALYZE host_aliases`)
		await testDb.db.execute(sql`ANALYZE agent_slash_commands`)
		const evidence: Record<string, unknown> = {}
		const plans: Record<string, z.infer<typeof planNodeSchema>[]> = {}
		const rollback = new Error('rollback query-plan mutations')
		const path = join(tmpdir(), `host-cleanup-query-plans-${randomUUID()}.json`)
		try {
			await testDb.db.transaction(async (tx) => {
				async function explain(name: string, query: SQLWrapper) {
					const rows = await tx.execute(sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query.getSQL()}`)
					const parsed = z
						.object({ 'QUERY PLAN': z.array(z.object({ Plan: z.unknown() })).min(1) })
						.parse(rows[0])
					evidence[name] = parsed['QUERY PLAN']
					plans[name] = planNodes(parsed['QUERY PLAN'][0]?.Plan)
				}
				const staleQuery = tx
					.select({
						hostId: onlineHosts.host_id,
						organizationId: onlineHosts.organization_id,
						userId: onlineHosts.user_id,
					})
					.from(onlineHosts)
					.where(and(eq(onlineHosts.status, 'online'), lt(onlineHosts.last_seen, cutoff)))
					.orderBy(
						asc(onlineHosts.last_seen),
						asc(onlineHosts.host_id),
						asc(onlineHosts.organization_id),
						asc(onlineHosts.user_id),
					)
					.limit(100)
					.for('update', { skipLocked: true })
				for (const [name, query] of [
					['ephemeral', expiredHostCandidates(tx, cutoff, 'ephemeral')],
					['offline', expiredHostCandidates(tx, cutoff, 'offline')],
					['stale', staleQuery],
				] as const) {
					await explain(name, query)
				}
				const keys = expired.map((row) => ({
					hostId: row.host_id,
					organizationId: row.organization_id,
					userId: row.user_id,
				}))
				for (const [index, deletion] of hostRegistrationDeletes(tx, keys).entries()) {
					await explain(`delete-${index}`, deletion)
				}
				// Inspect every plan only after collecting all six. No assertion can
				// prevent the remaining evidence from being generated.
				for (const [name, expectedRows] of [
					['ephemeral', 1],
					['offline', 1],
					['stale', 2],
				] as const) {
					const nodes = plans[name] ?? []
					expect(
						nodes.some((node) => /last_seen\s*</.test(node['Index Cond'] ?? '')),
						`${name}: indexed strict cutoff; evidence ${path}`,
					).toBe(true)
					expect(nodes[0]?.['Actual Rows'], `${name}: candidate count`).toBe(expectedRows)
					expect(scanWork(nodes), `${name}: bounded sparse-candidate scan work`).toBeLessThan(500)
				}
				for (const name of ['delete-0', 'delete-1', 'delete-2']) {
					const nodes = plans[name] ?? []
					const predicates = nodes
						.flatMap((node) => [node['Index Cond'] ?? '', node.Filter ?? '', node['Recheck Cond'] ?? ''])
						.join(' ')
					// PostgreSQL may split identity predicates across an index scan,
					// bitmap recheck and heap filter. Require selective indexed work
					// and the full identity, not one particular predicate placement.
					expect(
						nodes.some((node) => /(?:host_id|user_id|organization_id)\s*=/.test(node['Index Cond'] ?? '')),
						`${name}: indexed registration lookup`,
					).toBe(true)
					for (const column of ['host_id', 'user_id', 'organization_id'])
						expect(predicates, `${name}: ${column} scope`).toMatch(new RegExp(`${column}\\s*=`))
					expect(scanWork(nodes), `${name}: bounded registration-delete scan work`).toBeLessThan(500)
				}
				const hostIds = expired.map((row) => row.host_id)
				const expectedIdentities = identityControls
					.map((row) => [row.host_id, row.organization_id, row.user_id])
					.sort()
				for (const table of [onlineHosts, hostAliases] as const) {
					const survivors = await tx
						.select({ hostId: table.host_id, organizationId: table.organization_id, userId: table.user_id })
						.from(table)
						.where(inArray(table.host_id, hostIds))
					expect(
						survivors.map((row) => [row.hostId, row.organizationId, row.userId]).sort(),
						`${table === onlineHosts ? 'online_hosts' : 'host_aliases'}: exact deletion scope`,
					).toEqual(expectedIdentities)
				}
				const commands = await tx
					.select()
					.from(agentSlashCommands)
					.where(inArray(agentSlashCommands.host_id, hostIds))
				const expectedCommands = identityControls
					.flatMap((row) =>
						['claude', 'codex'].flatMap((agent) =>
							['', '/workspace'].map((workspace) => [
								row.host_id,
								row.organization_id,
								row.user_id,
								agent,
								workspace,
							]),
						),
					)
					.sort()
				expect(
					commands
						.map((row) => [row.host_id, row.organization_id, row.user_id, row.agent, row.workspace_path])
						.sort(),
					'agent_slash_commands: exact deletion scope',
				).toEqual(expectedCommands)
				for (const table of [onlineHosts, hostAliases, agentSlashCommands] as const) {
					const [remaining] = await tx.select({ count: sql<number>`count(*)::int` }).from(table)
					const rowsPerRegistration = table === agentSlashCommands ? 4 : 1
					expect(remaining?.count, 'delete preserves recent registrations and caches').toBe(
						(recent.length + identityControls.length) * rowsPerRegistration,
					)
				}
				throw rollback
			})
		} catch (error) {
			// Suppress only the deliberate rollback, never replace the original
			// assertion/SQL failure with a comparison against the rollback sentinel.
			if (error !== rollback) {
				console.error(JSON.stringify({ event: 'host_cleanup_query_plan_failure', path, evidence }))
				throw error
			}
		} finally {
			await writeFile(path, JSON.stringify(evidence, null, 2))
			console.log({ event: 'host_cleanup_query_plan_evidence', path })
		}
		const registrations = recent.length + expired.length + identityControls.length
		expect(await testDb.db.select().from(onlineHosts)).toHaveLength(registrations)
		expect(await testDb.db.select().from(hostAliases)).toHaveLength(registrations)
		expect(await testDb.db.select().from(agentSlashCommands)).toHaveLength(registrations * 4)
	}, 60_000)
})
