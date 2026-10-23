import { createHash, randomUUID } from 'node:crypto'

import { githubIntegrationInstallStates } from '@humanlayer/db/tables/github-integration-install-states'
import { githubIntegrations } from '@humanlayer/db/tables/github-integrations'
import { organizations } from '@humanlayer/db/tables/organizations'
import { eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { ConfigProvider, Effect, Layer } from 'effect'
import * as HttpClient from 'effect/http/HttpClient'
import type { HttpClientRequest } from 'effect/http/HttpClientRequest'
import * as HttpClientResponse from 'effect/http/HttpClientResponse'
import { Hono } from 'hono'
import { exportPKCS8, generateKeyPair } from 'jose'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { GitHubService, GitHubServiceLive } from '../../src/effects/services/github/github.service'
import { PostgresDbLive } from '../../src/effects/services/postgres/postgres-db.service'
import { registerGitHubSetupCallbackRoute } from '../../src/webhooks/github'
import { createRuntimeWithTestPostgresLayer } from '../utils/effect-procedure-test-runtime'
import { createTestDb } from '../utils/test-db'

const KNOWN_INSTALLATION_ID = '90071992547409931234'
const UNCLAIMED_INSTALLATION_ID = '90071992547409931235'
const FORGED_INSTALLATION_ID = '90071992547409939999'
// The route builds its redirect from `process.env`, while the GitHub service reads CLOUD_ORIGIN
// through Effect `Config`. Feed both from one value so the assertions stay readable.
const CLOUD_ORIGIN = process.env.CLOUD_ORIGIN ?? 'http://localhost:5174'

describe('GitHub setup callback', () => {
	let cleanupTestDatabase: (() => Promise<void>) | undefined
	let database: PostgresJsDatabase
	let organizationId: string
	let runtime: ReturnType<typeof createRuntimeWithTestPostgresLayer>
	let app: Hono
	let providerRequests: string[] = []

	beforeAll(async () => {
		const testDatabase = await createTestDb('github_callback_spoof_resistance')
		cleanupTestDatabase = testDatabase.cleanup
		database = testDatabase.db
		const [organization] = await database
			.insert(organizations)
			.values({ name: 'GitHub callback org', workos_organization_id: `workos-${randomUUID()}` })
			.returning()
		if (!organization) throw new Error('Failed to create callback test organization')
		organizationId = organization.id

		const generatedKeyPair = await generateKeyPair('RS256', { extractable: true })
		const privateKey = await exportPKCS8(generatedKeyPair.privateKey)
		const configuration = ConfigProvider.layer(
			ConfigProvider.fromUnknown({
				GITHUB_APP_ID: '123',
				CLOUD_ORIGIN,
				GITHUB_APP_CLIENT_ID: 'Iv1.callback-test',
				GITHUB_APP_SLUG: 'humanlayer-test',
				GITHUB_APP_PRIVATE_KEY: privateKey,
				GITHUB_APP_WEBHOOK_SECRET: 'webhook-secret',
				GITHUB_API_BASE_URL: 'https://api.github.test',
			}),
		)
		const transport = Layer.succeed(
			HttpClient.HttpClient,
			HttpClient.make((request, url) =>
				Effect.sync(() => {
					providerRequests.push(`${request.method} ${url.pathname}`)
					const installationMatch = url.pathname.match(/^\/app\/installations\/(\d+)$/)
					if (request.method === 'GET' && installationMatch) {
						const installationId = installationMatch[1]
						if (installationId !== KNOWN_INSTALLATION_ID && installationId !== UNCLAIMED_INSTALLATION_ID) {
							return rawJsonResponse(request, '{"message":"Not Found"}', 404)
						}
						return rawJsonResponse(
							request,
							`{"id":${installationId},"account":{"id":90071992547409931236,"login":"humanlayer","type":"Organization"},"repository_selection":"selected","permissions":{"metadata":"read","issues":"write"}}`,
						)
					}
					if (request.method === 'POST' && /\/access_tokens$/.test(url.pathname)) {
						return rawJsonResponse(
							request,
							'{"token":"ghs-callback-token","expires_at":"2030-01-01T00:00:00Z"}',
						)
					}
					if (request.method === 'GET' && url.pathname === '/installation/repositories') {
						return rawJsonResponse(
							request,
							'{"total_count":1,"repositories":[{"id":90071992547409931237,"name":"riptide","full_name":"humanlayer/riptide","private":true,"default_branch":"main","archived":false,"owner":{"login":"humanlayer"}}]}',
						)
					}
					return rawJsonResponse(request, '{"message":"Not Found"}', 404)
				}),
			),
		)
		const githubDependencies = Layer.mergeAll(PostgresDbLive(database), configuration, transport)
		const githubLayer = GitHubServiceLive.pipe(Layer.provide(githubDependencies), Layer.orDie)
		runtime = createRuntimeWithTestPostgresLayer(database, { github: githubLayer, httpClient: transport })
		app = new Hono()
		registerGitHubSetupCallbackRoute(app, {
			appRuntime: runtime,
			logger: { info: async () => undefined, warn: async () => undefined, error: async () => undefined },
		})
	}, 60_000)

	beforeEach(() => {
		providerRequests = []
	})

	afterAll(async () => {
		await runtime?.dispose()
		await cleanupTestDatabase?.()
	}, 30_000)

	const createInstallState = () =>
		runtime.runPromise(
			Effect.gen(function* () {
				const github = yield* GitHubService
				const install = yield* github.createInstallUrl({ organizationId, requestedByUserId: 'admin-1' })
				const state = new URL(install.url).searchParams.get('state')
				if (!state) return yield* Effect.die('Install URL did not contain state')
				return state
			}),
		)

	test('rejects malformed installation IDs before invoking the service', async () => {
		const response = await app.request(
			'http://localhost/integrations/github/callback?installation_id=spoofed&state=claim',
		)
		expect(response.status).toBe(302)
		expect(response.headers.get('location')).toBe(`${CLOUD_ORIGIN}/settings?github_error=invalid_link`)
		expect(providerRequests).toEqual([])
	})

	test('rejects an unknown state before contacting GitHub or persisting the known installation', async () => {
		const response = await app.request(
			`http://localhost/integrations/github/callback?installation_id=${KNOWN_INSTALLATION_ID}&state=forged-claim`,
		)

		expect(response.headers.get('location')).toBe(`${CLOUD_ORIGIN}/settings?github_error=invalid_link`)
		expect(providerRequests).toEqual([])
		const rows = await database
			.select()
			.from(githubIntegrations)
			.where(eq(githubIntegrations.installation_id, KNOWN_INSTALLATION_ID))
		expect(rows).toEqual([])
	})

	test('authenticates the installation and preserves state when a forged installation ID is unknown to GitHub', async () => {
		const state = await createInstallState()
		providerRequests = []
		const response = await app.request(
			`http://localhost/integrations/github/callback?installation_id=${FORGED_INSTALLATION_ID}&state=${state}`,
		)

		expect(response.headers.get('location')).toBe(`${CLOUD_ORIGIN}/settings?github_error=unavailable`)
		expect(providerRequests).toEqual([`GET /app/installations/${FORGED_INSTALLATION_ID}`])
		const integrations = await database
			.select()
			.from(githubIntegrations)
			.where(eq(githubIntegrations.installation_id, FORGED_INSTALLATION_ID))
		expect(integrations).toEqual([])
		const [claim] = await database
			.select()
			.from(githubIntegrationInstallStates)
			.where(
				eq(githubIntegrationInstallStates.state_token_hash, createHash('sha256').update(state).digest('hex')),
			)
		expect(claim?.consumed_at).toBeNull()
	})

	test('binds and persists only the provider-authenticated installation', async () => {
		const state = await createInstallState()
		providerRequests = []
		const response = await app.request(
			`http://localhost/integrations/github/callback?installation_id=${KNOWN_INSTALLATION_ID}&state=${state}`,
		)

		expect(response.headers.get('location')).toBe(`${CLOUD_ORIGIN}/settings?github=connected`)
		const [connection] = await database
			.select()
			.from(githubIntegrations)
			.where(eq(githubIntegrations.installation_id, KNOWN_INSTALLATION_ID))
		expect(connection).toMatchObject({
			organization_id: organizationId,
			installation_id: KNOWN_INSTALLATION_ID,
			account_id: '90071992547409931236',
			installation_status: 'active',
		})
	})

	test('uses the safe action-required path and persists an authenticated unclaimed installation without state', async () => {
		const response = await app.request(
			`http://localhost/integrations/github/callback?installation_id=${UNCLAIMED_INSTALLATION_ID}`,
		)
		expect(response.headers.get('location')).toBe(`${CLOUD_ORIGIN}/settings?github=unclaimed`)
		const [connection] = await database
			.select()
			.from(githubIntegrations)
			.where(eq(githubIntegrations.installation_id, UNCLAIMED_INSTALLATION_ID))
		expect(connection).toMatchObject({ organization_id: null, installation_status: 'unclaimed' })
	})
})

const rawJsonResponse = (request: HttpClientRequest, body: string, status = 200) =>
	HttpClientResponse.fromWeb(request, new Response(body, { status, headers: { 'content-type': 'application/json' } }))
