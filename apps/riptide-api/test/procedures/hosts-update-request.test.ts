import { randomUUID } from 'node:crypto'

import { onlineHosts } from '@humanlayer/db/tables/online-hosts'
import { organizations } from '@humanlayer/db/tables/organizations'
import { call } from '@orpc/server'
import { and, eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { requestHostUpdateEffectProcedure as liveRequestHostUpdateProcedure } from '../../src/orpc/api/hosts/update-request.effect'
import { createMockApiAuth, createMockApiContext } from '../mocks'
import { bindProcedureToRuntime, createRuntimeWithTestPostgresLayer } from '../utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('api/hosts/update/request', async () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let effectRuntime: ReturnType<typeof createRuntimeWithTestPostgresLayer> | undefined
	let requestHostUpdateProcedure: typeof liveRequestHostUpdateProcedure
	let organizationId: string

	const userId = 'user_host_update_123'
	const otherUserId = 'user_host_update_other'
	const workosOrganizationId = 'org_host_update'

	beforeAll(async () => {
		const testDb = await createTestDb('hosts_update_request')
		cleanupTestDb = testDb.cleanup
		db = testDb.db
		effectRuntime = createRuntimeWithTestPostgresLayer(db)
		requestHostUpdateProcedure = bindProcedureToRuntime(liveRequestHostUpdateProcedure, effectRuntime)

		const [organization] = await db
			.insert(organizations)
			.values({ name: 'Host Update Org', workos_organization_id: `org_${randomUUID()}` })
			.returning()

		organizationId = organization!.id
	})

	afterAll(async () => {
		await effectRuntime?.dispose()
		await cleanupTestDb?.()
	}, 30000)

	const apiContext = (input?: { userId?: string }) => ({
		context: createMockApiContext({
			auth: createMockApiAuth({ userId: input?.userId ?? userId, organizationId, workosOrganizationId }),
			services: { db, dbReadReplica: db },
		}),
	})

	const insertHost = async (overrides?: Partial<typeof onlineHosts.$inferInsert>) => {
		const hostId = randomUUID()
		await db.insert(onlineHosts).values({
			host_id: hostId,
			host_name: 'cli-host',
			user_id: userId,
			organization_id: organizationId,
			distribution: 'cli',
			can_self_update: true,
			...overrides,
		})
		return hostId
	}

	const selectHost = async (hostId: string, hostUserId: string) => {
		const [host] = await db
			.select()
			.from(onlineHosts)
			.where(
				and(
					eq(onlineHosts.host_id, hostId),
					eq(onlineHosts.organization_id, organizationId),
					eq(onlineHosts.user_id, hostUserId),
				),
			)
		return host
	}

	test('records the requested version and clears a previous failure', async () => {
		const hostId = await insertHost({ update_state: 'failed', update_error: 'install failed' })

		const result = await call(requestHostUpdateProcedure, { hostId, version: '0.31.4' }, apiContext())

		expect(result).toEqual({ hostId, version: '0.31.4' })
		expect(await selectHost(hostId, userId)).toMatchObject({
			update_requested_version: '0.31.4',
			update_state: 'requested',
			update_error: null,
		})
	})

	test('fails with NOT_FOUND when the caller does not own a host with that id', async () => {
		const hostId = await insertHost()

		await expect(
			call(requestHostUpdateProcedure, { hostId, version: '0.31.4' }, apiContext({ userId: otherUserId })),
		).rejects.toMatchObject({ code: 'NOT_FOUND' })

		expect(await selectHost(hostId, userId)).toMatchObject({ update_state: null })
	})

	test('fails with BAD_REQUEST when the daemon cannot update itself', async () => {
		const hostId = await insertHost({ can_self_update: false })

		await expect(
			call(requestHostUpdateProcedure, { hostId, version: '0.31.4' }, apiContext()),
		).rejects.toMatchObject({ code: 'BAD_REQUEST' })

		expect(await selectHost(hostId, userId)).toMatchObject({ update_requested_version: null })
	})

	test('fails with BAD_REQUEST for a desktop daemon', async () => {
		const hostId = await insertHost({ distribution: 'desktop' })

		await expect(
			call(requestHostUpdateProcedure, { hostId, version: '0.31.4' }, apiContext()),
		).rejects.toMatchObject({ code: 'BAD_REQUEST' })

		expect(await selectHost(hostId, userId)).toMatchObject({ update_requested_version: null })
	})
})
