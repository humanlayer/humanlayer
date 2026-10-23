import { randomUUID } from 'node:crypto'

import { describe, it } from '@effect/vitest'
import { agentSlashCommands } from '@humanlayer/db/tables/agent-slash-commands'
import { hostAliases } from '@humanlayer/db/tables/host-aliases'
import { onlineHosts } from '@humanlayer/db/tables/online-hosts'
import { organizations } from '@humanlayer/db/tables/organizations'
import { providerLoginRequests } from '@humanlayer/db/tables/provider-login-requests'
import { sessions } from '@humanlayer/db/tables/sessions'
import { HOST_DELETE_AFTER_MS } from '@humanlayer/riptide-api-contract/api/hosts/delete'
import { call } from '@orpc/server'
import { and, eq, sql } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { Deferred, Effect, Fiber, Layer, Logger } from 'effect'
import { TestClock } from 'effect/testing'
import { afterAll, beforeAll, expect } from 'vitest'

import { BillingAccess } from '../../src/effects/services/billing/billing-access.service'
import {
	makeEffectPostgresDbService,
	PostgresDb,
	PostgresDbLive,
} from '../../src/effects/services/postgres/postgres-db.service'
import { Sentry } from '../../src/instrument'
import { deleteHostEffectProcedure, deleteHostRegistration } from '../../src/orpc/api/hosts/delete.effect'
import { heartbeatEffectProcedure } from '../../src/orpc/daemon/hosts/heartbeat.effect'
import {
	createMockApiAuth,
	createMockApiContext,
	createMockApiContextNoOrg,
	createMockDaemonAuth,
	createMockDaemonContext,
} from '../mocks'
import { bindProcedureToRuntime, createRuntimeWithTestPostgresLayer } from '../utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('hosts.delete', () => {
	let db: PostgresJsDatabase
	let cleanup: (() => Promise<void>) | undefined
	let runtime: ReturnType<typeof createRuntimeWithTestPostgresLayer>
	let procedure: typeof deleteHostEffectProcedure
	let heartbeat: typeof heartbeatEffectProcedure
	let organizationId: string
	let otherOrganizationId: string
	const userId = 'host-delete-owner'
	const otherUserId = 'host-delete-other'
	const now = 2_000_000_000_000
	const cutoff = BigInt(now - HOST_DELETE_AFTER_MS)

	beforeAll(async () => {
		const testDb = await createTestDb('hosts_delete')
		db = testDb.db
		cleanup = testDb.cleanup
		runtime = createRuntimeWithTestPostgresLayer(db)
		procedure = bindProcedureToRuntime(deleteHostEffectProcedure, runtime)
		heartbeat = bindProcedureToRuntime(heartbeatEffectProcedure, runtime)
		const seeded = await db
			.insert(organizations)
			.values([
				{ name: 'Delete hosts', workos_organization_id: `org_${randomUUID()}` },
				{ name: 'Other delete hosts', workos_organization_id: `org_${randomUUID()}` },
			])
			.returning()
		const [owner, other] = seeded
		if (!owner || !other) throw new Error('Could not seed organizations')
		organizationId = owner.id
		otherOrganizationId = other.id
	}, 60_000)

	afterAll(async () => {
		try {
			await runtime?.dispose()
		} finally {
			await cleanup?.()
		}
	}, 30_000)

	const identity = (hostId: string) => ({ hostId, organizationId, userId })
	const apiContext = (auth = createMockApiAuth({ organizationId, userId })) => ({
		context: createMockApiContext({ auth, services: { db, dbReadReplica: db, effectRuntime: runtime } }),
	})
	const heartbeatCall = (hostId: string) =>
		call(
			heartbeat,
			{ hostId, hostName: 'Returned daemon' },
			{
				context: createMockDaemonContext({
					auth: createMockDaemonAuth(identity(hostId)),
					services: { db, dbReadReplica: db, effectRuntime: runtime },
				}),
			},
		)
	const hostPredicate = (hostId: string) =>
		and(
			eq(onlineHosts.host_id, hostId),
			eq(onlineHosts.organization_id, organizationId),
			eq(onlineHosts.user_id, userId),
		)
	const seed = async (overrides: Partial<typeof onlineHosts.$inferInsert> = {}) => {
		const hostId = randomUUID()
		await db.insert(onlineHosts).values({
			host_id: hostId,
			organization_id: organizationId,
			user_id: userId,
			host_name: 'Offline fixture',
			status: 'offline',
			last_seen: cutoff,
			...overrides,
		})
		return hostId
	}
	const seedCaches = async (hostId: string, orgId = organizationId, ownerId = userId) => {
		await db.insert(hostAliases).values({
			host_id: hostId,
			organization_id: orgId,
			user_id: ownerId,
			display_name: 'Custom name',
		})
		await db.insert(agentSlashCommands).values(
			['claude', 'codex'].flatMap((agent) =>
				['', '/workspace'].map((workspace_path) => ({
					host_id: hostId,
					organization_id: orgId,
					user_id: ownerId,
					agent,
					workspace_path,
					commands: [{ name: 'review' }],
					skills: [],
				})),
			),
		)
	}
	const rowsForHost = async (hostId: string) => ({
		hosts: await db.select().from(onlineHosts).where(eq(onlineHosts.host_id, hostId)),
		aliases: await db.select().from(hostAliases).where(eq(hostAliases.host_id, hostId)),
		commands: await db.select().from(agentSlashCommands).where(eq(agentSlashCommands.host_id, hostId)),
	})

	it.effect('deletes at the exact cutoff, scoped to the full identity, preserving history', () =>
		Effect.gen(function* () {
			yield* TestClock.setTime(now)
			const hostId = yield* Effect.promise(() => seed())
			yield* Effect.promise(async () => {
				await seedCaches(hostId)
				for (const [orgId, ownerId] of [
					[organizationId, otherUserId],
					[otherOrganizationId, userId],
				]) {
					if (!orgId || !ownerId) throw new Error('Missing fixture identity')
					await db.insert(onlineHosts).values({
						host_id: hostId,
						host_name: 'Unrelated',
						organization_id: orgId,
						user_id: ownerId,
						status: 'offline',
						last_seen: cutoff,
					})
					await seedCaches(hostId, orgId, ownerId)
				}
				await db.insert(sessions).values({
					host_id: hostId,
					organization_id: organizationId,
					created_by: userId,
					resource_owner_user_id: userId,
					working_directory: '/workspace',
					status: 'ready_for_input',
				})
				await db.insert(providerLoginRequests).values({
					host_id: hostId,
					organization_id: organizationId,
					user_id: userId,
					provider: 'claude',
					status: 'succeeded',
					expires_at: BigInt(now),
				})
			})
			const before = yield* Effect.promise(() => rowsForHost(hostId))
			const history = yield* Effect.promise(async () => ({
				sessions: await db.select().from(sessions).where(eq(sessions.host_id, hostId)),
				logins: await db.select().from(providerLoginRequests).where(eq(providerLoginRequests.host_id, hostId)),
			}))
			expect(yield* deleteHostRegistration(identity(hostId))).toEqual({ hostId })
			const after = yield* Effect.promise(() => rowsForHost(hostId))
			const unrelated = (row: { organization_id: string; user_id: string }) =>
				row.organization_id !== organizationId || row.user_id !== userId
			expect(after).toEqual({
				hosts: before.hosts.filter(unrelated),
				aliases: before.aliases.filter(unrelated),
				commands: before.commands.filter(unrelated),
			})
			expect(yield* Effect.promise(() => db.select().from(sessions).where(eq(sessions.host_id, hostId)))).toEqual(
				history.sessions,
			)
			expect(
				yield* Effect.promise(() =>
					db.select().from(providerLoginRequests).where(eq(providerLoginRequests.host_id, hostId)),
				),
			).toEqual(history.logins)
			expect(yield* deleteHostRegistration(identity(hostId)).pipe(Effect.flip)).toMatchObject({
				_tag: 'HostRegistrationNotFound',
			})
		}).pipe(Effect.provide(PostgresDbLive(db))),
	)

	for (const [label, status, lastSeen] of [
		['online with an old heartbeat', 'online', 0n],
		['one millisecond too recent', 'offline', cutoff + 1n],
		['future heartbeat', 'offline', BigInt(now + 1)],
	] as const) {
		it.effect(`rejects ${label} without deleting caches`, () =>
			Effect.gen(function* () {
				yield* TestClock.setTime(now)
				const hostId = yield* Effect.promise(() => seed({ status, last_seen: lastSeen }))
				yield* Effect.promise(() => seedCaches(hostId))
				const before = yield* Effect.promise(() => rowsForHost(hostId))
				expect(yield* deleteHostRegistration(identity(hostId)).pipe(Effect.flip)).toMatchObject({
					_tag: 'HostRegistrationNotEligible',
				})
				expect(yield* Effect.promise(() => rowsForHost(hostId))).toEqual(before)
			}).pipe(Effect.provide(PostgresDbLive(db))),
		)
	}

	it.effect('rolls back all deletes on a cache failure and logs the rich database error', () =>
		Effect.gen(function* () {
			yield* TestClock.setTime(now)
			const hostId = yield* Effect.promise(() => seed({ last_seen: 0n }))
			yield* Effect.promise(() => seedCaches(hostId))
			const before = yield* Effect.promise(() => rowsForHost(hostId))
			const logs: unknown[] = []
			const logger = Logger.make<unknown, void>((options) => {
				if (options.logLevel === 'Error') logs.push(options.message)
			})
			yield* Effect.acquireUseRelease(
				Effect.promise(async () => {
					await db.execute(sql`CREATE FUNCTION reject_host_delete_test() RETURNS trigger AS $$
						BEGIN RAISE EXCEPTION 'test cache deletion failure' USING ERRCODE = '23514'; END;
					$$ LANGUAGE plpgsql`)
					await db.execute(sql`CREATE TRIGGER reject_host_delete_test BEFORE DELETE ON agent_slash_commands
						FOR EACH ROW EXECUTE FUNCTION reject_host_delete_test()`)
				}),
				() =>
					Effect.gen(function* () {
						const error = yield* deleteHostRegistration(identity(hostId)).pipe(
							Effect.flip,
							Effect.provide(Logger.layer([logger])),
						)
						expect(error).toMatchObject({
							_tag: 'PostgresDbQueryError',
							code: '23514',
							kind: 'constraint_violation',
							retryable: false,
						})
						expect(logs).toContainEqual(['Host deletion query failed', error])
						expect(yield* Effect.promise(() => rowsForHost(hostId))).toEqual(before)
						const capturedErrors: unknown[] = []
						yield* Effect.acquireUseRelease(
							Effect.sync(
								() =>
									new Sentry.NodeClient({
										dsn: 'https://test@example.test/1',
										stackParser: Sentry.defaultStackParser,
										transport: () => ({
											send: () => Promise.reject(new Error('Unexpected Sentry delivery')),
											flush: () => Promise.resolve(true),
										}),
										integrations: [],
										beforeSend: (_event, hint) => {
											capturedErrors.push(hint.originalException)
											return null
										},
									}),
							),
							(client) =>
								Effect.promise(async () => {
									const result = await Sentry.withScope((scope) => {
										scope.setClient(client)
										return call(procedure, { hostId }, apiContext()).then(
											() => 'unexpected success',
											(failure: unknown) => failure,
										)
									})
									await client.flush(2000)
									expect(result).toMatchObject({ code: 'INTERNAL_SERVER_ERROR' })
									expect(capturedErrors).toContainEqual(
										expect.objectContaining({
											_tag: 'PostgresDbQueryError',
											code: '23514',
											kind: 'constraint_violation',
										}),
									)
								}),
							(client) => Effect.promise(() => client.close(2000)),
						)
					}),
				() =>
					Effect.promise(async () => {
						await db.execute(sql`DROP TRIGGER reject_host_delete_test ON agent_slash_commands`)
						await db.execute(sql`DROP FUNCTION reject_host_delete_test()`)
					}),
			)
			// The failing transaction and trigger finalizer both released resources; retry succeeds.
			expect(yield* deleteHostRegistration(identity(hostId))).toEqual({ hostId })
			expect(yield* Effect.promise(() => rowsForHost(hostId))).toEqual({ hosts: [], aliases: [], commands: [] })
		}).pipe(Effect.provide(PostgresDbLive(db))),
	)

	it.effect('a heartbeat holding the row lock refreshes eligibility before deletion can inspect it', () =>
		Effect.gen(function* () {
			yield* TestClock.setTime(now)
			const hostId = yield* Effect.promise(() => seed())
			yield* Effect.promise(() => seedCaches(hostId))
			const locked = yield* Deferred.make<void>()
			const release = yield* Deferred.make<void>()
			yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined))
			const deletionStarted = yield* Deferred.make<void>()
			const postgres = yield* PostgresDb
			// Real transaction models the heartbeat's update while retaining its row lock.
			const refreshing = yield* postgres
				.transaction((tx) =>
					Effect.gen(function* () {
						yield* tx.query(
							tx.client
								.update(onlineHosts)
								.set({ status: 'online', last_seen: BigInt(now) })
								.where(hostPredicate(hostId)),
						)
						yield* Deferred.succeed(locked, undefined)
						yield* Deferred.await(release)
					}),
				)
				.pipe(Effect.forkChild)
			yield* Deferred.await(locked)
			// NOWAIT proves the competing transaction owns the lock, without polling or sleeps.
			expect(
				yield* postgres
					.query(db.select().from(onlineHosts).where(hostPredicate(hostId)).for('update', { noWait: true }))
					.pipe(Effect.flip),
			).toMatchObject({ code: '55P03' })
			const deleting = yield* Deferred.succeed(deletionStarted, undefined).pipe(
				Effect.andThen(deleteHostRegistration(identity(hostId))),
				Effect.flip,
				Effect.forkChild,
			)
			yield* Deferred.await(deletionStarted)
			yield* Deferred.succeed(release, undefined)
			yield* Fiber.join(refreshing)
			expect(yield* Fiber.join(deleting)).toMatchObject({ _tag: 'HostRegistrationNotEligible' })
			const rows = yield* Effect.promise(() => rowsForHost(hostId))
			expect(rows.hosts).toMatchObject([{ status: 'online', last_seen: BigInt(now) }])
			expect(rows.aliases).toHaveLength(1)
			expect(rows.commands).toHaveLength(4)
		}).pipe(Effect.provide(PostgresDbLive(db))),
	)

	it.effect('a deletion holding the row lock commits before a returning heartbeat recreates registration', () =>
		Effect.gen(function* () {
			yield* TestClock.setTime(now)
			const hostId = yield* Effect.promise(() => seed())
			yield* Effect.promise(() => seedCaches(hostId))
			const deleted = yield* Deferred.make<void>()
			const release = yield* Deferred.make<void>()
			yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined))
			const heartbeatStarted = yield* Deferred.make<void>()
			const live = makeEffectPostgresDbService(db)
			// Delegate every SQL operation to real Postgres; pause only after the deletion program,
			// while its transaction still holds the registration lock and has not committed.
			const heldTransaction = Layer.succeed(PostgresDb, {
				...live,
				transaction: (program) =>
					live.transaction((tx) =>
						program(tx).pipe(
							Effect.tap(() => Deferred.succeed(deleted, undefined)),
							Effect.tap(() => Deferred.await(release)),
						),
					),
			})
			const deleting = yield* deleteHostRegistration(identity(hostId)).pipe(
				Effect.provide(heldTransaction),
				Effect.forkChild,
			)
			yield* Deferred.await(deleted)
			expect(
				yield* live
					.query(db.select().from(onlineHosts).where(hostPredicate(hostId)).for('update', { noWait: true }))
					.pipe(Effect.flip),
			).toMatchObject({ code: '55P03' })
			const returning = yield* Deferred.succeed(heartbeatStarted, undefined).pipe(
				Effect.andThen(Effect.promise(() => heartbeatCall(hostId))),
				Effect.forkChild,
			)
			yield* Deferred.await(heartbeatStarted)
			yield* Deferred.succeed(release, undefined)
			expect(yield* Fiber.join(deleting)).toEqual({ hostId })
			yield* Fiber.join(returning)
			const rows = yield* Effect.promise(() => rowsForHost(hostId))
			expect(rows.hosts).toMatchObject([{ status: 'online', host_name: 'Returned daemon' }])
			expect(rows.aliases).toEqual([])
			expect(rows.commands).toEqual([])
		}),
	)

	it('maps expected outcomes and uses authenticated organization and user identity', async () => {
		const hostId = await seed({ last_seen: 0n })
		await seedCaches(hostId)
		const before = await rowsForHost(hostId)
		for (const auth of [
			createMockApiAuth({ organizationId, userId: otherUserId }),
			createMockApiAuth({ organizationId: otherOrganizationId, userId }),
		]) {
			await expect(call(procedure, { hostId }, apiContext(auth))).rejects.toMatchObject({ code: 'NOT_FOUND' })
		}
		expect(await rowsForHost(hostId)).toEqual(before)
		await expect(call(procedure, { hostId: randomUUID() }, apiContext())).rejects.toMatchObject({
			code: 'NOT_FOUND',
		})
		const onlineId = await seed({ status: 'online', last_seen: 0n })
		await expect(call(procedure, { hostId: onlineId }, apiContext())).rejects.toMatchObject({ code: 'BAD_REQUEST' })
		expect(await call(procedure, { hostId }, apiContext())).toEqual({ hostId })
		expect(await rowsForHost(hostId)).toEqual({ hosts: [], aliases: [], commands: [] })
	})

	it('requires authentication and an organization before accessing a host', async () => {
		const hostId = await seed({ last_seen: 0n })
		const services = { db, dbReadReplica: db, effectRuntime: runtime }
		await expect(
			call(
				procedure,
				{ hostId },
				{
					context: createMockApiContext({ auth: null, services }),
				},
			),
		).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
		await expect(
			call(
				procedure,
				{ hostId },
				{
					context: createMockApiContextNoOrg({ services }),
				},
			),
		).rejects.toMatchObject({ code: 'ORGANIZATION_REQUIRED' })
		expect((await rowsForHost(hostId)).hosts).toHaveLength(1)
	})

	it('enforces billing before deleting an eligible registration', async () => {
		const hostId = await seed({ last_seen: 0n })
		const before = await rowsForHost(hostId)
		const blockedRuntime = createRuntimeWithTestPostgresLayer(db, {
			billingAccess: Layer.succeed(BillingAccess, {
				decideForOperation: () => Effect.succeed('blocked' as const),
				refreshStripeBillingCache: () => Effect.die('Unexpected billing refresh'),
			}),
		})
		const previous = process.env.IS_BILLING_ENFORCEMENT_ENABLED
		process.env.IS_BILLING_ENFORCEMENT_ENABLED = 'true'
		try {
			await expect(
				call(
					bindProcedureToRuntime(deleteHostEffectProcedure, blockedRuntime),
					{ hostId },
					{
						context: createMockApiContext({
							auth: createMockApiAuth({ organizationId, userId }),
							services: { db, dbReadReplica: db, effectRuntime: blockedRuntime },
						}),
					},
				),
			).rejects.toMatchObject({ code: 'BILLING_REQUIRED' })
			expect(await rowsForHost(hostId)).toEqual(before)
		} finally {
			if (previous === undefined) delete process.env.IS_BILLING_ENFORCEMENT_ENABLED
			else process.env.IS_BILLING_ENFORCEMENT_ENABLED = previous
			await blockedRuntime.dispose()
		}
	})
})
