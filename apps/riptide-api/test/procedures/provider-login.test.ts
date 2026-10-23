import { onlineHosts } from '@humanlayer/db/tables/online-hosts'
import { organizations } from '@humanlayer/db/tables/organizations'
import { providerLoginRequests } from '@humanlayer/db/tables/provider-login-requests'
import { call } from '@orpc/server'
import { eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { uuidv7 } from 'uuidv7'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { createProviderLoginProcedure as liveCreateProcedure } from '../../src/orpc/api/provider-login'
import { createMockApiAuth, createMockApiContext } from '../mocks'
import { bindProcedureToRuntime, createRuntimeWithTestPostgresLayer } from '../utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('provider login host ownership', () => {
	let db: PostgresJsDatabase
	let cleanup: (() => Promise<void>) | undefined
	let runtime: ReturnType<typeof createRuntimeWithTestPostgresLayer> | undefined
	let createProcedure: typeof liveCreateProcedure
	const organizationId = uuidv7()
	const otherOrganizationId = uuidv7()
	const userId = 'provider-login-owner'
	const workosOrganizationId = `org_${uuidv7()}`

	beforeAll(async () => {
		const testDb = await createTestDb('provider_login_ownership')
		db = testDb.db
		cleanup = testDb.cleanup
		runtime = createRuntimeWithTestPostgresLayer(db)
		createProcedure = bindProcedureToRuntime(liveCreateProcedure, runtime)
		await db.insert(organizations).values([
			{ id: organizationId, name: 'Login ownership', workos_organization_id: workosOrganizationId },
			{ id: otherOrganizationId, name: 'Other organization', workos_organization_id: `org_${uuidv7()}` },
		])
	}, 60000)

	afterAll(async () => {
		await runtime?.dispose()
		await cleanup?.()
	}, 30000)

	const context = () =>
		createMockApiContext({
			auth: createMockApiAuth({ userId, organizationId, workosOrganizationId }),
			services: { db, dbReadReplica: db },
		})

	test('creates a request for a host owned by the caller in this organization', async () => {
		const hostId = uuidv7()
		await db
			.insert(onlineHosts)
			.values({ host_id: hostId, user_id: userId, organization_id: organizationId, status: 'online' })
		const result = await call(createProcedure, { hostId, provider: 'claude' }, { context: context() })
		const rows = await db.select().from(providerLoginRequests).where(eq(providerLoginRequests.id, result.requestId))
		expect(rows).toMatchObject([
			{ host_id: hostId, user_id: userId, organization_id: organizationId, status: 'requested' },
		])
	})

	test('cancels earlier open requests for the same host and provider', async () => {
		const hostId = uuidv7()
		await db
			.insert(onlineHosts)
			.values({ host_id: hostId, user_id: userId, organization_id: organizationId, status: 'online' })
		const first = await call(createProcedure, { hostId, provider: 'codex' }, { context: context() })
		const second = await call(createProcedure, { hostId, provider: 'codex' }, { context: context() })
		const rows = await db
			.select({ id: providerLoginRequests.id, status: providerLoginRequests.status })
			.from(providerLoginRequests)
			.where(eq(providerLoginRequests.host_id, hostId))
		expect(rows).toEqual(
			expect.arrayContaining([
				{ id: first.requestId, status: 'cancelled' },
				{ id: second.requestId, status: 'requested' },
			]),
		)
	})

	test.each(['other user', 'other organization', 'missing'] as const)(
		'rejects a host belonging to %s without creating a request',
		async (scope) => {
			const hostId = uuidv7()
			if (scope !== 'missing') {
				await db.insert(onlineHosts).values({
					host_id: hostId,
					user_id: scope === 'other user' ? 'another-user' : userId,
					organization_id: scope === 'other organization' ? otherOrganizationId : organizationId,
					status: 'online',
				})
			}
			await expect(
				call(createProcedure, { hostId, provider: 'claude' }, { context: context() }),
			).rejects.toMatchObject({ code: 'NOT_FOUND' })
			expect(
				await db.select().from(providerLoginRequests).where(eq(providerLoginRequests.host_id, hostId)),
			).toEqual([])
		},
	)
})
