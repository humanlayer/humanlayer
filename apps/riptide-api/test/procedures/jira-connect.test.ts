import { randomUUID } from 'node:crypto'

import { jiraIntegrationInstallStates } from '@humanlayer/db/tables/jira-integration-install-states'
import { jiraIntegrations } from '@humanlayer/db/tables/jira-integrations'
import { organizationSettings } from '@humanlayer/db/tables/organization-settings'
import { organizations } from '@humanlayer/db/tables/organizations'
import { eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { Hono } from 'hono'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { JiraService } from '../../src/lib/jira-service'
import { registerJiraOAuthCallbackRoute } from '../../src/webhooks/jira'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

const REDIRECT_URI = 'https://api.example.test/integrations/jira/callback'

describe('Jira connect', () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let organizationId: string
	let jira: JiraService
	let app: Hono

	let tokenRequests: Record<string, unknown>[] = []
	let resourcesRequests = 0
	let tokenExchangeShouldFail = false
	const originalFetch = globalThis.fetch
	let previousCloudOrigin: string | undefined

	beforeAll(async () => {
		const testDb = await createTestDb('jira_connect')
		cleanupTestDb = testDb.cleanup
		db = testDb.db

		const [organization] = await db
			.insert(organizations)
			.values({ name: 'Jira connect org', workos_organization_id: `workos-${randomUUID()}` })
			.returning()
		if (!organization) throw new Error('Failed to create organization')
		organizationId = organization.id

		previousCloudOrigin = process.env.CLOUD_ORIGIN
		process.env.CLOUD_ORIGIN = 'https://cloud.example.test'

		jira = new JiraService('client-id', 'client-secret', db, REDIRECT_URI)
		app = new Hono()
		registerJiraOAuthCallbackRoute(app, {
			jiraService: jira,
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
		resourcesRequests = 0
		tokenExchangeShouldFail = false
		globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
			const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
			if (url === 'https://auth.atlassian.com/oauth/token') {
				tokenRequests.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
				if (tokenExchangeShouldFail) return new Response('nope', { status: 400 })
				return new Response(
					JSON.stringify({
						access_token: 'jira-access',
						refresh_token: 'jira-refresh',
						expires_in: 3600,
						scope: 'offline_access read:jira-work write:jira-work',
					}),
					{ status: 200, headers: { 'content-type': 'application/json' } },
				)
			}
			if (url === 'https://api.atlassian.com/oauth/token/accessible-resources') {
				resourcesRequests += 1
				return new Response(
					JSON.stringify([
						{
							id: 'jira-cloud-id',
							url: 'https://example.atlassian.net',
							name: 'Example Jira',
							scopes: ['read:jira-work', 'write:jira-work'],
						},
					]),
					{ status: 200, headers: { 'content-type': 'application/json' } },
				)
			}
			throw new Error(`Unexpected fetch in test: ${url}`)
		}) as typeof fetch
	})

	afterEach(async () => {
		globalThis.fetch = originalFetch
		await db.delete(jiraIntegrationInstallStates)
		await db.delete(jiraIntegrations)
	})

	const stateFromInstallUrl = (url: string): string => {
		const state = new URL(url).searchParams.get('state')
		if (!state) throw new Error('Install URL carried no state')
		return state
	}

	const callback = (params: Record<string, string>) =>
		app.request(`/integrations/jira/callback?${new URLSearchParams(params).toString()}`)

	test('mints an install URL carrying the raw state while storing only a hash', async () => {
		const install = await jira.createInstallUrl({
			organizationId,
			requestedByUserId: 'admin-1',
			client: 'cloud',
		})

		const url = new URL(install.url)
		expect(url.origin + url.pathname).toBe('https://auth.atlassian.com/authorize')
		expect(url.searchParams.get('client_id')).toBe('client-id')
		expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT_URI)
		expect(install.expiresAt).toBeGreaterThan(Date.now())

		const state = stateFromInstallUrl(install.url)
		const [row] = await db.select().from(jiraIntegrationInstallStates)
		expect(row?.state_token_hash).toBeTruthy()
		expect(row?.state_token_hash).not.toBe(state)
		expect(row?.return_client).toBe('cloud')
		expect(row?.consumed_at).toBeNull()
	})

	test('exchanges a code, consumes the state row, and connects the Jira site', async () => {
		const install = await jira.createInstallUrl({
			organizationId,
			requestedByUserId: 'admin-1',
			client: 'cloud',
		})
		const state = stateFromInstallUrl(install.url)

		const response = await callback({ code: 'oauth-code', state })

		expect(response.status).toBe(302)
		expect(response.headers.get('location')).toBe(
			'https://cloud.example.test/connect/jira?status=connected&client=cloud',
		)
		expect(tokenRequests[0]).toMatchObject({
			grant_type: 'authorization_code',
			client_id: 'client-id',
			client_secret: 'client-secret',
			code: 'oauth-code',
			redirect_uri: REDIRECT_URI,
		})
		expect(resourcesRequests).toBe(1)

		const [integration] = await db
			.select()
			.from(jiraIntegrations)
			.where(eq(jiraIntegrations.organization_id, organizationId))
		expect(integration).toMatchObject({
			cloud_id: 'jira-cloud-id',
			site_url: 'https://example.atlassian.net',
			access_token: 'jira-access',
			needs_reauth: false,
		})

		const [settings] = await db
			.select()
			.from(organizationSettings)
			.where(eq(organizationSettings.organization_id, organizationId))
		expect(settings?.jira_integration_enabled).toBe(true)

		const [consumed] = await db.select().from(jiraIntegrationInstallStates)
		expect(consumed?.consumed_at).toBeTruthy()
	})

	test('rejects a reused state before calling Jira', async () => {
		const install = await jira.createInstallUrl({
			organizationId,
			requestedByUserId: 'admin-1',
			client: 'cloud',
		})
		const state = stateFromInstallUrl(install.url)

		await callback({ code: 'first-code', state })
		expect(tokenRequests).toHaveLength(1)

		const replay = await callback({ code: 'second-code', state })

		expect(replay.headers.get('location')).toBe(
			'https://cloud.example.test/connect/jira?status=invalid_link&client=cloud',
		)
		expect(tokenRequests).toHaveLength(1)
		expect(resourcesRequests).toBe(1)
	})

	test('rejects an expired state before calling Jira', async () => {
		const install = await jira.createInstallUrl({
			organizationId,
			requestedByUserId: 'admin-1',
			client: 'cloud',
		})
		const state = stateFromInstallUrl(install.url)
		await db.update(jiraIntegrationInstallStates).set({ expires_at: BigInt(Date.now() - 1000) })

		const response = await callback({ code: 'oauth-code', state })

		expect(response.headers.get('location')).toBe(
			'https://cloud.example.test/connect/jira?status=invalid_link&client=cloud',
		)
		expect(tokenRequests).toHaveLength(0)
	})

	test('round-trips return_client into the redirect URL', async () => {
		const install = await jira.createInstallUrl({
			organizationId,
			requestedByUserId: 'admin-1',
			client: 'native',
		})
		const state = stateFromInstallUrl(install.url)

		const response = await callback({ code: 'oauth-code', state })

		expect(response.headers.get('location')).toBe(
			'https://cloud.example.test/connect/jira?status=connected&client=native',
		)
	})

	test('reports a failed exchange as auth_failed against the requesting client', async () => {
		tokenExchangeShouldFail = true
		const install = await jira.createInstallUrl({
			organizationId,
			requestedByUserId: 'admin-1',
			client: 'native',
		})
		const state = stateFromInstallUrl(install.url)

		const response = await callback({ code: 'oauth-code', state })

		expect(response.headers.get('location')).toBe(
			'https://cloud.example.test/connect/jira?status=auth_failed&client=native',
		)
	})

	test('reports denied consent against the requesting client, consumes state, and rejects malformed callbacks', async () => {
		const install = await jira.createInstallUrl({
			organizationId,
			requestedByUserId: 'admin-1',
			client: 'native',
		})
		const state = stateFromInstallUrl(install.url)

		const denied = await callback({ error: 'access_denied', state })
		expect(denied.headers.get('location')).toBe(
			'https://cloud.example.test/connect/jira?status=access_denied&client=native',
		)
		const [consumed] = await db.select().from(jiraIntegrationInstallStates)
		expect(consumed?.consumed_at).toBeTruthy()
		const replay = await callback({ error: 'access_denied', state })
		expect(replay.headers.get('location')).toBe(
			'https://cloud.example.test/connect/jira?status=invalid_link&client=cloud',
		)

		const malformed = await callback({ code: 'oauth-code' })
		expect(malformed.headers.get('location')).toBe(
			'https://cloud.example.test/connect/jira?status=invalid_link&client=cloud',
		)
		expect(tokenRequests).toHaveLength(0)
	})
})
