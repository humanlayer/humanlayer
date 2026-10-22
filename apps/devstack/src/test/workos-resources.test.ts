import { afterEach, describe, expect, it } from 'vitest'

import { createWorkOSResourceState } from '../lib/manifest'
import { inspectWorkOSResources, reconcileWorkOSResources, WorkOSResourcesClient } from '../lib/workos-resources'
import { createFakeWorkOSServer } from './fixtures/workos-server'

const cleanup: Array<() => void | Promise<void>> = []
afterEach(async () => {
	for (const dispose of cleanup.splice(0).reverse()) await dispose()
})

function clientFor(server: ReturnType<typeof createFakeWorkOSServer>) {
	return new WorkOSResourcesClient({ apiKey: 'sandbox-key', baseUrl: server.baseUrl, fetch: server.fetch })
}

describe.skipIf(Boolean(process.env.CI))('WorkOS AuthKit resource lifecycle', () => {
	it('generates exact stack resources and paginates list responses', async () => {
		const server = createFakeWorkOSServer({ pageSize: 1 })
		cleanup.push(server.stop)
		server.insert('redirectUri', 'https://unrelated.localhost/auth/callback')
		const client = clientFor(server)
		const state = await reconcileWorkOSResources(client, 'auth-a', createWorkOSResourceState('auth-a'))

		expect(state).toMatchObject({
			callbackUri: 'https://cloud.auth-a.localhost/auth/callback',
			corsOrigin: 'https://cloud.auth-a.localhost',
			appRedirectUri: 'https://app.auth-a.localhost',
			appCorsOrigin: 'https://app.auth-a.localhost',
			status: 'healthy',
		})
		expect(await client.list('redirectUri')).toHaveLength(3)
		expect(server.requests.filter(({ path }) => path.includes('after=1'))).not.toHaveLength(0)
	})

	it('reuses persisted and exact pre-existing IDs, detects duplicates, and recovers partial creation', async () => {
		const server = createFakeWorkOSServer()
		cleanup.push(server.stop)
		const client = clientFor(server)
		const initial = await reconcileWorkOSResources(client, 'auth-a', createWorkOSResourceState('auth-a'))
		const repeated = await reconcileWorkOSResources(client, 'auth-a', initial)
		expect(repeated.status).toBe('healthy')
		expect(server.resources.redirectUri).toHaveLength(2)
		expect(server.resources.corsOrigin).toHaveLength(2)
		expect(repeated.redirectUri?.source).toBe('created')

		const retained = createWorkOSResourceState('retained')
		const retainedRedirect = server.insert('redirectUri', retained.callbackUri)
		const retainedCors = server.insert('corsOrigin', retained.corsOrigin)
		server.insert('redirectUri', retained.appRedirectUri)
		server.insert('corsOrigin', retained.appCorsOrigin)
		const reused = await reconcileWorkOSResources(client, 'retained', retained)
		expect(reused).toMatchObject({
			status: 'healthy',
			redirectUri: { id: retainedRedirect.id, source: 'reused' },
			corsOriginResource: { id: retainedCors.id, source: 'reused' },
		})

		server.insert('corsOrigin', initial.corsOrigin)
		expect((await inspectWorkOSResources(client, 'auth-a', repeated)).status).toBe('duplicate')

		const failingServer = createFakeWorkOSServer({ failCreateKind: 'corsOrigin' })
		cleanup.push(failingServer.stop)
		const partial = await reconcileWorkOSResources(
			clientFor(failingServer),
			'partial',
			createWorkOSResourceState('partial'),
		)
		expect(partial.status).toBe('partial')
		expect(partial.redirectUri).toBeDefined()
		expect(partial.corsOriginResource).toBeUndefined()
	})

	it('retains remote resources when local stack ownership is removed', async () => {
		const server = createFakeWorkOSServer()
		cleanup.push(server.stop)
		const client = clientFor(server)
		const authA = await reconcileWorkOSResources(client, 'auth-a', createWorkOSResourceState('auth-a'))
		const authB = await reconcileWorkOSResources(client, 'auth-b', createWorkOSResourceState('auth-b'))

		expect(await inspectWorkOSResources(client, 'auth-a', authA)).toMatchObject({ status: 'healthy' })
		expect(await inspectWorkOSResources(client, 'auth-b', authB)).toMatchObject({ status: 'healthy' })
		expect(server.requests.some(({ method }) => method === 'DELETE')).toBe(false)
	})
})
