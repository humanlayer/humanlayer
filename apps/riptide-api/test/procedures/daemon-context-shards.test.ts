import { randomUUID } from 'node:crypto'

import { type ContextShardEvidence, contextShards } from '@humanlayer/db/tables/context-shards'
import { organizations } from '@humanlayer/db/tables/organizations'
import { userShardPreferences } from '@humanlayer/db/tables/user-shard-preferences'
import { call } from '@orpc/server'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { daemonListEnabledContextShardsProcedure as liveDaemonListEnabledContextShardsProcedure } from '../../src/orpc/daemon/context-shards/list-enabled.effect'
import { createMockDaemonAuth, createMockDaemonContext } from '../mocks'
import { bindProcedureToRuntime, createRuntimeWithTestPostgresLayer } from '../utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

function makeEvidence(sourceUserId: string): ContextShardEvidence[] {
	return [
		{
			citation: 'Always update contract tests when a response shape changes.',
			conversationEventId: randomUUID(),
			sessionId: randomUUID(),
			taskId: null,
			sourceUserId,
			role: 'user',
		},
	]
}

/** Deterministic, ascending UUIDs so ORDER BY id assertions are stable. */
function sequentialUuid(n: number): string {
	return `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
}

/**
 * Daemon-facing Context Shards procedure.
 *
 * Covers identity binding from the daemon token, the enabled-preference inner
 * join, the release/admin-dismissal gate, stable shard-id order, and the
 * 100-row limit.
 */
describe('Context Shards - daemon listEnabled', { concurrent: false }, async () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let effectRuntime: ReturnType<typeof createRuntimeWithTestPostgresLayer> | undefined
	let listEnabledProcedure: typeof liveDaemonListEnabledContextShardsProcedure

	let organizationId: string
	let otherOrganizationId: string

	const userA = 'daemon_shards_user_a'
	const userB = 'daemon_shards_user_b'

	const contextFor = (userId: string, orgId?: string) =>
		createMockDaemonContext({
			auth: createMockDaemonAuth({ userId, organizationId: orgId ?? organizationId }),
			services: { db, dbReadReplica: db },
		})

	const insertShard = async (
		orgId: string,
		overrides?: Partial<typeof contextShards.$inferInsert>,
	): Promise<string> => {
		const [shard] = await db
			.insert(contextShards)
			.values({
				organization_id: orgId,
				shard_text: 'Update contract tests when a response shape changes.',
				reasoning_text: 'Multiple users repeated this steering.',
				evidence_json: makeEvidence(userA),
				released_to_org: true,
				dismissed: false,
				...overrides,
			})
			.returning()
		if (!shard) throw new Error('Failed to insert context shard')
		return shard.id
	}

	const setPreference = async (shardId: string, userId: string, shardState: 'enabled' | 'disabled' | 'dismissed') => {
		await db.insert(userShardPreferences).values({
			organization_id: organizationId,
			user_id: userId,
			shard_id: shardId,
			shard_state: shardState,
		})
	}

	beforeAll(async () => {
		const testDb = await createTestDb('context_shards_daemon_procedures')
		cleanupTestDb = testDb.cleanup
		db = testDb.db
		effectRuntime = createRuntimeWithTestPostgresLayer(db)
		listEnabledProcedure = bindProcedureToRuntime(liveDaemonListEnabledContextShardsProcedure, effectRuntime)

		const [org] = await db
			.insert(organizations)
			.values({ name: 'daemon shards org', workos_organization_id: 'org_daemon_ctx_shards' })
			.returning()
		if (!org) throw new Error('Unable to insert organization for setup')
		organizationId = org.id

		const [otherOrg] = await db
			.insert(organizations)
			.values({ name: 'other daemon shards org', workos_organization_id: 'org_daemon_ctx_shards_other' })
			.returning()
		if (!otherOrg) throw new Error('Unable to insert second organization for setup')
		otherOrganizationId = otherOrg.id
	}, 30000)

	afterAll(async () => {
		await effectRuntime?.dispose()
		await cleanupTestDb?.()
	})

	test('returns only shards the authenticated daemon user enabled', async () => {
		const enabledId = await insertShard(organizationId, { shard_text: 'Enabled shard text.' })
		const disabledId = await insertShard(organizationId)
		const dismissedId = await insertShard(organizationId)
		const noPreferenceId = await insertShard(organizationId)

		await setPreference(enabledId, userA, 'enabled')
		await setPreference(disabledId, userA, 'disabled')
		await setPreference(dismissedId, userA, 'dismissed')

		const result = await call(listEnabledProcedure, {}, { context: contextFor(userA) })

		const ids = result.data.map((r) => r.id)
		expect(ids).toContain(enabledId)
		expect(ids).not.toContain(disabledId)
		expect(ids).not.toContain(dismissedId)
		expect(ids).not.toContain(noPreferenceId)
		expect(result.data.find((r) => r.id === enabledId)).toEqual({
			id: enabledId,
			shardText: 'Enabled shard text.',
		})

		// Identity is bound from the daemon token: another user sees nothing
		const resultB = await call(listEnabledProcedure, {}, { context: contextFor(userB) })
		expect(resultB.data.map((r) => r.id)).not.toContain(enabledId)
	})

	test('unreleased and admin-dismissed shards never appear even when enabled', async () => {
		const unreleasedId = await insertShard(organizationId, { released_to_org: false })
		const adminDismissedId = await insertShard(organizationId, {
			dismissed: true,
			dismissed_at: BigInt(Date.now()),
		})

		await setPreference(unreleasedId, userA, 'enabled')
		await setPreference(adminDismissedId, userA, 'enabled')

		const result = await call(listEnabledProcedure, {}, { context: contextFor(userA) })

		const ids = result.data.map((r) => r.id)
		expect(ids).not.toContain(unreleasedId)
		expect(ids).not.toContain(adminDismissedId)
	})

	test('shards enabled in another organization never appear', async () => {
		const foreignShardId = await insertShard(otherOrganizationId)
		await db.insert(userShardPreferences).values({
			organization_id: otherOrganizationId,
			user_id: userA,
			shard_id: foreignShardId,
			shard_state: 'enabled',
		})

		const result = await call(listEnabledProcedure, {}, { context: contextFor(userA) })

		expect(result.data.map((r) => r.id)).not.toContain(foreignShardId)
	})

	test('orders by shard id ascending and limits the result to 100', async () => {
		const limitUser = 'daemon_shards_limit_user'
		const count = 101

		// Insert in reverse id order to prove ordering comes from the query
		const shardIds = Array.from({ length: count }, (_, i) => sequentialUuid(i + 1))
		await db.insert(contextShards).values(
			[...shardIds].reverse().map((id) => ({
				id,
				organization_id: organizationId,
				shard_text: `Shard ${id}`,
				reasoning_text: 'Limit coverage.',
				evidence_json: makeEvidence(limitUser),
				released_to_org: true,
				dismissed: false,
			})),
		)
		await db.insert(userShardPreferences).values(
			shardIds.map((id) => ({
				organization_id: organizationId,
				user_id: limitUser,
				shard_id: id,
				shard_state: 'enabled' as const,
			})),
		)

		const result = await call(listEnabledProcedure, {}, { context: contextFor(limitUser) })

		expect(result.data).toHaveLength(100)
		expect(result.data.map((r) => r.id)).toEqual(shardIds.slice(0, 100))
	})
})
