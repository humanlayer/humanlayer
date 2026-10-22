import { randomUUID } from 'node:crypto'

import { type ContextShardEvidence, contextShards } from '@humanlayer/db/tables/context-shards'
import { organizations } from '@humanlayer/db/tables/organizations'
import { userShardPreferences } from '@humanlayer/db/tables/user-shard-preferences'
import { call } from '@orpc/server'
import { and, eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { listContextShardsProcedure as liveListContextShardsProcedure } from '../../src/orpc/api/context-shards/list.effect'
import { restoreContextShardProcedure as liveRestoreContextShardProcedure } from '../../src/orpc/api/context-shards/restore'
import { updateContextShardPreferenceProcedure as liveUpdateContextShardPreferenceProcedure } from '../../src/orpc/api/context-shards/update-preference'
import { createMockApiAuth, createMockApiContext } from '../mocks'
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

/**
 * User-facing Context Shards procedures.
 *
 * Covers sparse defaults, the enable/disable/dismiss/restore lifecycle, the
 * release + admin-dismissal gate, and organization/user isolation.
 */
describe('Context Shards - user procedures', { concurrent: false }, async () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let effectRuntime: ReturnType<typeof createRuntimeWithTestPostgresLayer> | undefined
	let listContextShardsProcedure!: typeof liveListContextShardsProcedure
	let restoreContextShardProcedure!: typeof liveRestoreContextShardProcedure
	let updateContextShardPreferenceProcedure!: typeof liveUpdateContextShardPreferenceProcedure

	let organizationId: string
	let otherOrganizationId: string
	const workosOrganizationId = 'org_ctx_shards'
	const otherWorkosOrganizationId = 'org_ctx_shards_other'

	const userA = 'user_shards_a'
	const userB = 'user_shards_b'

	const contextFor = (userId: string, orgId?: string, workosOrgId?: string) =>
		createMockApiContext({
			auth: createMockApiAuth({
				userId,
				organizationId: orgId ?? organizationId,
				workosOrganizationId: workosOrgId ?? workosOrganizationId,
			}),
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

	beforeAll(async () => {
		const testDb = await createTestDb('context_shards_user_procedures')
		cleanupTestDb = testDb.cleanup
		db = testDb.db
		effectRuntime = createRuntimeWithTestPostgresLayer(db)
		listContextShardsProcedure = bindProcedureToRuntime(liveListContextShardsProcedure, effectRuntime)
		restoreContextShardProcedure = bindProcedureToRuntime(liveRestoreContextShardProcedure, effectRuntime)
		updateContextShardPreferenceProcedure = bindProcedureToRuntime(
			liveUpdateContextShardPreferenceProcedure,
			effectRuntime,
		)

		const [org] = await db
			.insert(organizations)
			.values({ name: 'shards org', workos_organization_id: workosOrganizationId })
			.returning()
		if (!org) throw new Error('Unable to insert organization for setup')
		organizationId = org.id

		const [otherOrg] = await db
			.insert(organizations)
			.values({ name: 'other shards org', workos_organization_id: otherWorkosOrganizationId })
			.returning()
		if (!otherOrg) throw new Error('Unable to insert second organization for setup')
		otherOrganizationId = otherOrg.id
	}, 30000)

	afterAll(async () => {
		await effectRuntime?.dispose()
		await cleanupTestDb?.()
	})

	describe('contextShards.list', () => {
		test('released shard with no preference row lists with effective state disabled', async () => {
			const shardId = await insertShard(organizationId)

			const result = await call(listContextShardsProcedure, {}, { context: contextFor(userA) })

			const row = result.data.find((r) => r.id === shardId)
			expect(row).toBeDefined()
			expect(row!.state).toBe('disabled')
			expect(row!.shardText).toBe('Update contract tests when a response shape changes.')
			expect(row!.evidence).toHaveLength(1)

			// Sparse default: no preference row was created by listing
			const preferences = await db
				.select()
				.from(userShardPreferences)
				.where(eq(userShardPreferences.shard_id, shardId))
			expect(preferences).toHaveLength(0)
		})

		test('unreleased and admin-dismissed shards never appear', async () => {
			const unreleasedId = await insertShard(organizationId, { released_to_org: false })
			const adminDismissedId = await insertShard(organizationId, {
				dismissed: true,
				dismissed_at: BigInt(Date.now()),
			})

			const result = await call(listContextShardsProcedure, {}, { context: contextFor(userA) })

			const ids = result.data.map((r) => r.id)
			expect(ids).not.toContain(unreleasedId)
			expect(ids).not.toContain(adminDismissedId)
		})

		test('shards from another organization never appear', async () => {
			const foreignShardId = await insertShard(otherOrganizationId)

			const result = await call(listContextShardsProcedure, {}, { context: contextFor(userA) })

			expect(result.data.map((r) => r.id)).not.toContain(foreignShardId)
		})

		test('active rows come first by created_at DESC; user-dismissed rows always last', async () => {
			const olderActiveId = await insertShard(organizationId, { created_at: 1_000n, updated_at: 1_000n })
			const newerActiveId = await insertShard(organizationId, { created_at: 2_000n, updated_at: 2_000n })
			const newestDismissedId = await insertShard(organizationId, { created_at: 3_000n, updated_at: 3_000n })

			await call(
				updateContextShardPreferenceProcedure,
				{ shardId: newestDismissedId, shardState: 'dismissed' },
				{ context: contextFor(userA) },
			)

			const result = await call(listContextShardsProcedure, {}, { context: contextFor(userA) })

			const ids = result.data.map((r) => r.id)
			const activeIds = result.data.filter((r) => r.state !== 'dismissed').map((r) => r.id)
			const dismissedIds = result.data.filter((r) => r.state === 'dismissed').map((r) => r.id)

			// Newest dismissed row sorts after every active row despite being newest
			expect(ids.indexOf(newestDismissedId)).toBeGreaterThan(ids.indexOf(olderActiveId))
			expect(dismissedIds).toContain(newestDismissedId)
			// created_at DESC among active rows
			expect(activeIds.indexOf(newerActiveId)).toBeLessThan(activeIds.indexOf(olderActiveId))
			// dismissed rows are contiguous at the bottom
			expect(ids.slice(ids.length - dismissedIds.length)).toEqual(dismissedIds)
		})
	})

	describe('contextShards.updatePreference lifecycle', () => {
		test('enable, disable, dismiss, and restore round-trip through one sparse row', async () => {
			const shardId = await insertShard(organizationId)

			// Enable
			const enabled = await call(
				updateContextShardPreferenceProcedure,
				{ shardId, shardState: 'enabled' },
				{ context: contextFor(userA) },
			)
			expect(enabled).toEqual({ shardId, shardState: 'enabled' })

			let result = await call(listContextShardsProcedure, {}, { context: contextFor(userA) })
			expect(result.data.find((r) => r.id === shardId)?.state).toBe('enabled')

			// Disable retains the row instead of deleting it
			await call(
				updateContextShardPreferenceProcedure,
				{ shardId, shardState: 'disabled' },
				{ context: contextFor(userA) },
			)
			result = await call(listContextShardsProcedure, {}, { context: contextFor(userA) })
			expect(result.data.find((r) => r.id === shardId)?.state).toBe('disabled')

			// Dismiss keeps the shard in the list with dismissed state
			await call(
				updateContextShardPreferenceProcedure,
				{ shardId, shardState: 'dismissed' },
				{ context: contextFor(userA) },
			)
			result = await call(listContextShardsProcedure, {}, { context: contextFor(userA) })
			expect(result.data.find((r) => r.id === shardId)?.state).toBe('dismissed')

			// Restore returns the shard with Always-on off
			const restored = await call(restoreContextShardProcedure, { shardId }, { context: contextFor(userA) })
			expect(restored).toEqual({ shardId, shardState: 'disabled' })
			result = await call(listContextShardsProcedure, {}, { context: contextFor(userA) })
			expect(result.data.find((r) => r.id === shardId)?.state).toBe('disabled')

			// One sparse row across the whole lifecycle
			const preferences = await db
				.select()
				.from(userShardPreferences)
				.where(and(eq(userShardPreferences.shard_id, shardId), eq(userShardPreferences.user_id, userA)))
			expect(preferences).toHaveLength(1)
			expect(preferences[0]!.shard_state).toBe('disabled')
			expect(preferences[0]!.organization_id).toBe(organizationId)
		})

		test('one user preference never affects another user', async () => {
			const shardId = await insertShard(organizationId)

			await call(
				updateContextShardPreferenceProcedure,
				{ shardId, shardState: 'enabled' },
				{ context: contextFor(userA) },
			)

			const resultB = await call(listContextShardsProcedure, {}, { context: contextFor(userB) })
			expect(resultB.data.find((r) => r.id === shardId)?.state).toBe('disabled')

			await call(
				updateContextShardPreferenceProcedure,
				{ shardId, shardState: 'dismissed' },
				{ context: contextFor(userB) },
			)

			const resultA = await call(listContextShardsProcedure, {}, { context: contextFor(userA) })
			expect(resultA.data.find((r) => r.id === shardId)?.state).toBe('enabled')
		})
	})

	describe('release gate', () => {
		test('updatePreference rejects unreleased and admin-dismissed shards without writing', async () => {
			const unreleasedId = await insertShard(organizationId, { released_to_org: false })
			const adminDismissedId = await insertShard(organizationId, {
				dismissed: true,
				dismissed_at: BigInt(Date.now()),
			})

			for (const shardId of [unreleasedId, adminDismissedId]) {
				await expect(
					call(
						updateContextShardPreferenceProcedure,
						{ shardId, shardState: 'enabled' },
						{ context: contextFor(userA) },
					),
				).rejects.toThrow()
			}

			const preferences = await db
				.select()
				.from(userShardPreferences)
				.where(eq(userShardPreferences.user_id, userA))
			const writtenShardIds = preferences.map((p) => p.shard_id)
			expect(writtenShardIds).not.toContain(unreleasedId)
			expect(writtenShardIds).not.toContain(adminDismissedId)
		})

		test('restore rejects a shard that is no longer released', async () => {
			const shardId = await insertShard(organizationId, { released_to_org: false })

			await expect(
				call(restoreContextShardProcedure, { shardId }, { context: contextFor(userA) }),
			).rejects.toThrow()
		})

		test('unrelease hides the shard for every user while stored preferences remain', async () => {
			const shardId = await insertShard(organizationId)

			await call(
				updateContextShardPreferenceProcedure,
				{ shardId, shardState: 'enabled' },
				{ context: contextFor(userA) },
			)
			await call(
				updateContextShardPreferenceProcedure,
				{ shardId, shardState: 'dismissed' },
				{ context: contextFor(userB) },
			)

			// Admin unrelease is a direct flag change; user procedures must respect it
			await db.update(contextShards).set({ released_to_org: false }).where(eq(contextShards.id, shardId))

			for (const userId of [userA, userB]) {
				const result = await call(listContextShardsProcedure, {}, { context: contextFor(userId) })
				expect(result.data.map((r) => r.id)).not.toContain(shardId)
			}

			// Neither user's preference row was deleted
			const preferences = await db
				.select()
				.from(userShardPreferences)
				.where(eq(userShardPreferences.shard_id, shardId))
			expect(preferences).toHaveLength(2)
			expect(preferences.map((p) => p.shard_state).sort()).toEqual(['dismissed', 'enabled'])
		})
	})

	describe('organization isolation', () => {
		test('a user in another organization cannot mutate or restore a foreign shard', async () => {
			const shardId = await insertShard(organizationId)

			const foreignContext = contextFor('user_foreign', otherOrganizationId, otherWorkosOrganizationId)

			await expect(
				call(
					updateContextShardPreferenceProcedure,
					{ shardId, shardState: 'enabled' },
					{ context: foreignContext },
				),
			).rejects.toThrow()

			await expect(call(restoreContextShardProcedure, { shardId }, { context: foreignContext })).rejects.toThrow()

			const preferences = await db
				.select()
				.from(userShardPreferences)
				.where(eq(userShardPreferences.shard_id, shardId))
			expect(preferences).toHaveLength(0)
		})
	})
})
