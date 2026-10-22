import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'

import { type NewSession, sessionSelectSchema, sessions } from '@humanlayer/db/tables/sessions'
import { createCollection, createLiveQueryCollection, eq as liveEq } from '@tanstack/db'
import { electricCollectionOptions } from '@tanstack/electric-db-collection'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { createElectricTestContext, createTestUser, type ElectricTestContext, waitFor } from './fixtures'

describe('on-demand collections and partial updates', () => {
	let ctx: ElectricTestContext

	beforeAll(async () => {
		ctx = await createElectricTestContext()
	})

	afterAll(async () => {
		await ctx.shutdown()
	})

	test('an update for a row the client never loaded is ignored until a query loads the row', async () => {
		const testId = randomUUID().slice(0, 8)
		const owner = createTestUser(`partial_updates_${testId}`)
		const server = ctx.createProxyServer({
			user: owner,
			organization: ctx.defaultOrganization,
			key: `partial_updates_${testId}`,
		})
		const sessionFor = () =>
			({
				id: randomUUID(),
				resource_owner_user_id: owner.userId,
				organization_id: ctx.defaultOrganization.id,
				working_directory: tmpdir(),
				status: 'draft',
				host_id: randomUUID(),
				created_by: owner.userId,
			}) satisfies NewSession
		const viewed = await ctx.seedSession(sessionFor())
		const unloaded = await ctx.seedSession(sessionFor())

		const source = createCollection(
			electricCollectionOptions({
				schema: sessionSelectSchema,
				shapeOptions: { url: `http://localhost:${server.port}/v2/sessions`, subsetMethod: 'POST' },
				getKey: (row) => row.id,
				syncMode: 'on-demand',
				startSync: true,
			}),
		)
		const loadSession = async (id: string) => {
			const query = createLiveQueryCollection({
				query: (q) => q.from({ rows: source }).where(({ rows }) => liveEq(rows.id, id)),
			})
			await query.preload()
			await waitFor(() => source.has(id), { timeout: 10_000 })
			return query
		}
		const viewedQuery = await loadSession(viewed.id)

		const sentinel = sessionFor()
		await ctx.db.transaction(async (tx) => {
			await tx.update(sessions).set({ title: 'Renamed unloaded' }).where(eq(sessions.id, unloaded.id))
			await tx.update(sessions).set({ title: 'Renamed viewed' }).where(eq(sessions.id, viewed.id))
			await tx.insert(sessions).values(sentinel)
		})
		await waitFor(() => source.has(sentinel.id), { timeout: 10_000 })

		expect(source.has(unloaded.id)).toBe(false)
		expect(source.get(viewed.id)).toMatchObject({
			title: 'Renamed viewed',
			status: 'draft',
			working_directory: tmpdir(),
		})

		const unloadedQuery = await loadSession(unloaded.id)
		expect(source.get(unloaded.id)).toMatchObject({
			title: 'Renamed unloaded',
			status: 'draft',
			working_directory: tmpdir(),
		})

		await unloadedQuery.cleanup()
		await viewedQuery.cleanup()
		await source.cleanup()
	})
})
