import { randomUUID } from 'node:crypto'

import { linearIntegrationInstallStates } from '@humanlayer/db/tables/linear-integration-install-states'
import { linearIntegrations } from '@humanlayer/db/tables/linear-integrations'
import { organizationSettings } from '@humanlayer/db/tables/organization-settings'
import { organizations } from '@humanlayer/db/tables/organizations'
import { eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { Hono } from 'hono'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { LinearService } from '../../src/lib/linear-service'
import { registerLinearOAuthCallbackRoute } from '../../src/webhooks/linear'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

const REDIRECT_URI = 'https://api.example.test/integrations/linear/callback'

/**
 * Mirrors `test/effect/slack-connect.vi.test.ts` against a real Postgres container: the
 * install URL carries the raw state, the row stores only a hash, the exchange consumes the
 * row, a reused state is rejected *before Linear is called*, an expired state is rejected,
 * and `return_client` round-trips into the redirect URL.
 */
describe('Linear connect', () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let organizationId: string
	let linear: LinearService
	let app: Hono

	let tokenRequests: Record<string, string>[] = []
	let organizationRequests = 0
	let tokenExchangeShouldFail = false
	let organizationLookupShouldFail = false
	const originalFetch = globalThis.fetch
	let previousCloudOrigin: string | undefined

	beforeAll(async () => {
		const testDb = await createTestDb('linear_connect')
		cleanupTestDb = testDb.cleanup
		db = testDb.db

		const [organization] = await db
			.insert(organizations)
			.values({ name: 'Linear connect org', workos_organization_id: `workos-${randomUUID()}` })
			.returning()
		if (!organization) throw new Error('Failed to create organization')
		organizationId = organization.id

		previousCloudOrigin = process.env.CLOUD_ORIGIN
		process.env.CLOUD_ORIGIN = 'https://cloud.example.test'

		linear = new LinearService('client-id', 'client-secret', db, REDIRECT_URI)
		app = new Hono()
		registerLinearOAuthCallbackRoute(app, {
			linearService: linear,
			appRuntime: { runFork: () => undefined as never },
			logger: { info: async () => undefined, warn: async () => undefined, error: async () => undefined },
		})
	}, 60000)

	afterAll(async () => {
		if (previousCloudOrigin === undefined) delete process.env.CLOUD_ORIGIN
		else process.env.CLOUD_ORIGIN = previousCloudOrigin
		await cleanupTestDb?.()
	}, 30000)

	beforeEach(() => {
		tokenRequests = []
		organizationRequests = 0
		tokenExchangeShouldFail = false
		organizationLookupShouldFail = false
		globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
			const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
			if (url.includes('api.linear.app/graphql')) {
				organizationRequests += 1
				if (organizationLookupShouldFail) {
					return new Response('nope', { status: 500 })
				}
				return new Response(JSON.stringify({ data: { organization: { id: 'linear-organization-id' } } }), {
					status: 200,
					headers: { 'content-type': 'application/json' },
				})
			}
			if (!url.includes('api.linear.app/oauth/token')) {
				throw new Error(`Unexpected fetch in test: ${url}`)
			}
			tokenRequests.push(Object.fromEntries(new URLSearchParams(String(init?.body))))
			if (tokenExchangeShouldFail) {
				return new Response('nope', { status: 400 })
			}
			return new Response(
				JSON.stringify({
					access_token: 'linear-access',
					token_type: 'Bearer',
					expires_in: 3600,
					scope: 'read,write,comments:create',
					refresh_token: 'linear-refresh',
				}),
				{ status: 200, headers: { 'content-type': 'application/json' } },
			)
		}) as typeof fetch
	})

	afterEach(async () => {
		globalThis.fetch = originalFetch
		await db.delete(linearIntegrationInstallStates)
		await db.delete(linearIntegrations)
	})

	const stateFromInstallUrl = (url: string): string => {
		const state = new URL(url).searchParams.get('state')
		if (!state) throw new Error('Install URL carried no state')
		return state
	}

	const callback = (params: Record<string, string>) =>
		app.request(`/integrations/linear/callback?${new URLSearchParams(params).toString()}`)

	test('mints an install URL carrying the raw state while storing only a hash', async () => {
		const install = await linear.createInstallUrl({
			organizationId,
			requestedByUserId: 'admin-1',
			client: 'cloud',
		})

		const url = new URL(install.url)
		expect(url.origin + url.pathname).toBe('https://linear.app/oauth/authorize')
		expect(url.searchParams.get('client_id')).toBe('client-id')
		// The redirect URI is server-owned; the browser never supplied one.
		expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT_URI)
		expect(install.expiresAt).toBeGreaterThan(Date.now())

		const state = stateFromInstallUrl(install.url)
		const [row] = await db.select().from(linearIntegrationInstallStates)
		expect(row?.state_token_hash).toBeTruthy()
		expect(row?.state_token_hash).not.toBe(state)
		expect(row?.return_client).toBe('cloud')
		expect(row?.consumed_at).toBeNull()
	})

	test('exchanges a code, consumes the state row, and connects the integration', async () => {
		const install = await linear.createInstallUrl({
			organizationId,
			requestedByUserId: 'admin-1',
			client: 'cloud',
		})
		const state = stateFromInstallUrl(install.url)

		const response = await callback({ code: 'oauth-code', state })

		expect(response.status).toBe(302)
		expect(response.headers.get('location')).toBe(
			'https://cloud.example.test/connect/linear?status=connected&client=cloud',
		)
		expect(tokenRequests[0]).toMatchObject({
			grant_type: 'authorization_code',
			client_id: 'client-id',
			client_secret: 'client-secret',
			code: 'oauth-code',
			redirect_uri: REDIRECT_URI,
		})

		const [integration] = await db
			.select()
			.from(linearIntegrations)
			.where(eq(linearIntegrations.organization_id, organizationId))
		expect(integration).toMatchObject({
			access_token: 'linear-access',
			linear_organization_id: 'linear-organization-id',
			needs_reauth: false,
		})
		expect(organizationRequests).toBe(1)

		const [settings] = await db
			.select()
			.from(organizationSettings)
			.where(eq(organizationSettings.organization_id, organizationId))
		expect(settings?.linear_integration_enabled).toBe(true)

		const [consumed] = await db.select().from(linearIntegrationInstallStates)
		expect(consumed?.consumed_at).toBeTruthy()
	})

	test('backfills a missing Linear organization ID after refreshing an access token', async () => {
		await db.insert(linearIntegrations).values({
			organization_id: organizationId,
			access_token: 'expired-access',
			refresh_token: 'existing-refresh',
			token_expires_at: 1n,
			scopes: 'read,write,comments:create',
			connected_by: 'admin-1',
		})

		const accessToken = await linear.getAccessToken(organizationId)

		expect(accessToken).toBe('linear-access')
		expect(tokenRequests).toHaveLength(1)
		expect(tokenRequests[0]).toMatchObject({
			grant_type: 'refresh_token',
			refresh_token: 'existing-refresh',
		})
		expect(organizationRequests).toBe(1)

		const [integration] = await db
			.select()
			.from(linearIntegrations)
			.where(eq(linearIntegrations.organization_id, organizationId))
		expect(integration).toMatchObject({
			access_token: 'linear-access',
			refresh_token: 'linear-refresh',
			linear_organization_id: 'linear-organization-id',
			needs_reauth: false,
		})
	})

	test('does not look up the Linear organization again when refresh metadata is already populated', async () => {
		await db.insert(linearIntegrations).values({
			organization_id: organizationId,
			linear_organization_id: 'existing-linear-organization-id',
			access_token: 'expired-access',
			refresh_token: 'existing-refresh',
			token_expires_at: 1n,
			scopes: 'read,write,comments:create',
			connected_by: 'admin-1',
		})

		await linear.getAccessToken(organizationId)

		expect(tokenRequests).toHaveLength(1)
		expect(organizationRequests).toBe(0)
		const [integration] = await db
			.select()
			.from(linearIntegrations)
			.where(eq(linearIntegrations.organization_id, organizationId))
		expect(integration?.linear_organization_id).toBe('existing-linear-organization-id')
	})

	test('keeps refreshed credentials when the organization ID backfill fails', async () => {
		organizationLookupShouldFail = true
		await db.insert(linearIntegrations).values({
			organization_id: organizationId,
			access_token: 'expired-access',
			refresh_token: 'existing-refresh',
			token_expires_at: 1n,
			scopes: 'read,write,comments:create',
			connected_by: 'admin-1',
		})

		const accessToken = await linear.getAccessToken(organizationId)

		expect(accessToken).toBe('linear-access')
		expect(organizationRequests).toBe(1)
		const [integration] = await db
			.select()
			.from(linearIntegrations)
			.where(eq(linearIntegrations.organization_id, organizationId))
		expect(integration).toMatchObject({
			access_token: 'linear-access',
			refresh_token: 'linear-refresh',
			linear_organization_id: null,
			needs_reauth: false,
		})
	})

	test('rejects a reused state before calling Linear', async () => {
		const install = await linear.createInstallUrl({
			organizationId,
			requestedByUserId: 'admin-1',
			client: 'cloud',
		})
		const state = stateFromInstallUrl(install.url)

		await callback({ code: 'first-code', state })
		expect(tokenRequests).toHaveLength(1)

		const replay = await callback({ code: 'second-code', state })

		expect(replay.headers.get('location')).toBe(
			'https://cloud.example.test/connect/linear?status=invalid_link&client=cloud',
		)
		// The security-relevant assertion: no second token exchange was attempted.
		expect(tokenRequests).toHaveLength(1)
	})

	test('rejects an expired state', async () => {
		const install = await linear.createInstallUrl({
			organizationId,
			requestedByUserId: 'admin-1',
			client: 'cloud',
		})
		const state = stateFromInstallUrl(install.url)

		await db.update(linearIntegrationInstallStates).set({ expires_at: BigInt(Date.now() - 1000) })

		const response = await callback({ code: 'oauth-code', state })

		expect(response.headers.get('location')).toBe(
			'https://cloud.example.test/connect/linear?status=invalid_link&client=cloud',
		)
		expect(tokenRequests).toHaveLength(0)
	})

	test('rejects an unknown state', async () => {
		const response = await callback({ code: 'oauth-code', state: 'never-minted' })

		expect(response.headers.get('location')).toBe(
			'https://cloud.example.test/connect/linear?status=invalid_link&client=cloud',
		)
		expect(tokenRequests).toHaveLength(0)
	})

	test('round-trips return_client into the redirect URL', async () => {
		const install = await linear.createInstallUrl({
			organizationId,
			requestedByUserId: 'admin-1',
			client: 'native',
		})
		const state = stateFromInstallUrl(install.url)

		const response = await callback({ code: 'oauth-code', state })

		expect(response.headers.get('location')).toBe(
			'https://cloud.example.test/connect/linear?status=connected&client=native',
		)
	})

	test('reports a failed exchange as auth_failed against the requesting client', async () => {
		tokenExchangeShouldFail = true
		const install = await linear.createInstallUrl({
			organizationId,
			requestedByUserId: 'admin-1',
			client: 'native',
		})
		const state = stateFromInstallUrl(install.url)

		const response = await callback({ code: 'oauth-code', state })

		expect(response.headers.get('location')).toBe(
			'https://cloud.example.test/connect/linear?status=auth_failed&client=native',
		)
	})

	test('reports denied consent against the requesting client and consumes the state', async () => {
		const install = await linear.createInstallUrl({
			organizationId,
			requestedByUserId: 'admin-1',
			client: 'native',
		})
		const state = stateFromInstallUrl(install.url)

		const response = await callback({ error: 'access_denied', state })

		expect(response.headers.get('location')).toBe(
			'https://cloud.example.test/connect/linear?status=access_denied&client=native',
		)
		expect(tokenRequests).toHaveLength(0)

		const [consumed] = await db.select().from(linearIntegrationInstallStates)
		expect(consumed?.consumed_at).toBeTruthy()
		const replay = await callback({ error: 'access_denied', state })
		expect(replay.headers.get('location')).toBe(
			'https://cloud.example.test/connect/linear?status=invalid_link&client=cloud',
		)
	})

	test('reports a callback missing code or state as invalid_link', async () => {
		const response = await callback({ code: 'oauth-code' })

		expect(response.headers.get('location')).toBe(
			'https://cloud.example.test/connect/linear?status=invalid_link&client=cloud',
		)
		expect(tokenRequests).toHaveLength(0)
	})
})
