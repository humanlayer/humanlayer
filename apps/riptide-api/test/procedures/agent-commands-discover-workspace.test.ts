import { agentCommandDiscoveryRequests } from '@humanlayer/db/tables/agent-command-discovery-requests'
import { onlineHosts } from '@humanlayer/db/tables/online-hosts'
import { organizations } from '@humanlayer/db/tables/organizations'
import { call } from '@orpc/server'
import { eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { uuidv7 } from 'uuidv7'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { discoverWorkspaceAgentCommandsProcedure as liveDiscoverProcedure } from '../../src/orpc/api/agent-commands/discover-workspace.effect'
import { createMockApiAuth, createMockApiContext } from '../mocks'
import { bindProcedureToRuntime, createRuntimeWithTestPostgresLayer } from '../utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('api/agent-commands/discover-workspace', () => {
	let db: PostgresJsDatabase
	let cleanup: (() => Promise<void>) | undefined
	let runtime: ReturnType<typeof createRuntimeWithTestPostgresLayer> | undefined
	let discoverProcedure: typeof liveDiscoverProcedure
	const organizationId = uuidv7()
	const userId = 'agent-command-discovery-owner'
	const workosOrganizationId = `org_${uuidv7()}`

	beforeAll(async () => {
		const testDb = await createTestDb('agent_command_discovery_requests')
		db = testDb.db
		cleanup = testDb.cleanup
		runtime = createRuntimeWithTestPostgresLayer(db)
		discoverProcedure = bindProcedureToRuntime(liveDiscoverProcedure, runtime)
		await db
			.insert(organizations)
			.values({ id: organizationId, name: 'Discovery requests', workos_organization_id: workosOrganizationId })
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

	const ownedHost = async () => {
		const hostId = uuidv7()
		await db
			.insert(onlineHosts)
			.values({ host_id: hostId, user_id: userId, organization_id: organizationId, status: 'online' })
		return hostId
	}

	const requestsFor = (hostId: string) =>
		db
			.select({
				workspace_path: agentCommandDiscoveryRequests.workspace_path,
				requested_at: agentCommandDiscoveryRequests.requested_at,
			})
			.from(agentCommandDiscoveryRequests)
			.where(eq(agentCommandDiscoveryRequests.host_id, hostId))

	test('keeps one request per host, pointing at the directory asked for last', async () => {
		const hostId = await ownedHost()

		await call(discoverProcedure, { hostId, workspacePath: '/repos/app' }, { context: context() })
		await db
			.update(agentCommandDiscoveryRequests)
			.set({ requested_at: 1n })
			.where(eq(agentCommandDiscoveryRequests.host_id, hostId))
		await call(discoverProcedure, { hostId, workspacePath: '/repos/other' }, { context: context() })

		const rows = await requestsFor(hostId)
		expect(rows).toHaveLength(1)
		expect(rows[0]?.workspace_path).toBe('/repos/other')
		expect(rows[0]?.requested_at).toBeGreaterThan(1n)
	})

	test('rejects a host the caller does not own', async () => {
		const hostId = uuidv7()
		await db
			.insert(onlineHosts)
			.values({ host_id: hostId, user_id: 'someone-else', organization_id: organizationId, status: 'online' })

		await expect(
			call(discoverProcedure, { hostId, workspacePath: '/repos/app' }, { context: context() }),
		).rejects.toThrow()
		expect(await requestsFor(hostId)).toHaveLength(0)
	})
})
