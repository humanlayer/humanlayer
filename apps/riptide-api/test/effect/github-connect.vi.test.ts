import { randomUUID } from 'node:crypto'

import { describe, it } from '@effect/vitest'
import { githubIntegrationInstallStates } from '@humanlayer/db/tables/github-integration-install-states'
import { githubIntegrationRepositories } from '@humanlayer/db/tables/github-integration-repositories'
import { githubIntegrations } from '@humanlayer/db/tables/github-integrations'
import { organizationSettings } from '@humanlayer/db/tables/organization-settings'
import { organizations } from '@humanlayer/db/tables/organizations'
import { eq, sql } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { ConfigProvider, Effect, Layer, Redacted } from 'effect'
import * as HttpClient from 'effect/http/HttpClient'
import type { HttpClientRequest } from 'effect/http/HttpClientRequest'
import * as HttpClientResponse from 'effect/http/HttpClientResponse'
import { TestClock } from 'effect/testing'
import { exportPKCS8, generateKeyPair, importPKCS8 } from 'jose'
import { afterAll, beforeAll, expect } from 'vitest'

import { getOrRefreshGitHubInstallationToken } from '../../src/effects/services/github/github.auth'
import { GitHubService, GitHubServiceLive } from '../../src/effects/services/github/github.service'
import { PostgresDbLive } from '../../src/effects/services/postgres/postgres-db.service'
import { createTestDb } from '../utils/test-db'

describe('GitHub connection workflow', () => {
	let cleanupTestDatabase: (() => Promise<void>) | undefined
	let database: PostgresJsDatabase
	let organizationId: string
	let secondOrganizationId: string
	let privateKey: string
	let providerRequests: Array<{ method: string; pathname: string; page: string | null }> = []

	beforeAll(async () => {
		const testDatabase = await createTestDb('github_connect_service')
		cleanupTestDatabase = testDatabase.cleanup
		database = testDatabase.db
		const createdOrganizations = await database
			.insert(organizations)
			.values([
				{ name: 'GitHub connect org', workos_organization_id: `workos-${randomUUID()}` },
				{ name: 'GitHub conflict org', workos_organization_id: `workos-${randomUUID()}` },
			])
			.returning()
		const firstOrganization = createdOrganizations[0]
		const secondOrganization = createdOrganizations[1]
		if (!firstOrganization || !secondOrganization) throw new Error('Failed to create test organizations')
		organizationId = firstOrganization.id
		secondOrganizationId = secondOrganization.id
		const generatedKeyPair = await generateKeyPair('RS256', { extractable: true })
		privateKey = await exportPKCS8(generatedKeyPair.privateKey)
	}, 60_000)

	afterAll(async () => {
		await cleanupTestDatabase?.()
	}, 30_000)

	const makeLayer = () => {
		const configuration = ConfigProvider.layer(
			ConfigProvider.fromUnknown({
				GITHUB_APP_ID: '123',
				CLOUD_ORIGIN: 'https://cloud.example.test',
				GITHUB_APP_CLIENT_ID: 'Iv1.test-client',
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
					providerRequests.push({
						method: request.method,
						pathname: url.pathname,
						page: url.searchParams.get('page'),
					})
					const installationMatch = url.pathname.match(/^\/app\/installations\/(\d+)$/)
					if (request.method === 'GET' && installationMatch) {
						const installationId = installationMatch[1]
						return rawJsonResponse(
							request,
							`{"id":${installationId},"account":{"id":90071992547409931235,"login":"humanlayer","type":"Organization"},"repository_selection":"selected","permissions":{"contents":"write","issues":"write","pull_requests":"write","metadata":"read"}}`,
						)
					}
					if (request.method === 'POST' && /\/access_tokens$/.test(url.pathname)) {
						return jsonResponse(request, {
							token: `ghs-token-${url.pathname}`,
							expires_at: '2030-01-01T00:00:00Z',
						})
					}
					if (request.method === 'GET' && url.pathname === '/installation/repositories') {
						return rawJsonResponse(
							request,
							'{"total_count":2,"repositories":[{"id":90071992547409931236,"name":"riptide","full_name":"humanlayer/riptide","private":true,"default_branch":"main","archived":false,"owner":{"login":"humanlayer"}},{"id":90071992547409931237,"name":"docs","full_name":"humanlayer/docs","private":false,"default_branch":"main","archived":false,"owner":{"login":"humanlayer"}}]}',
						)
					}
					return jsonResponse(request, { message: 'not found' }, 404)
				}),
			),
		)
		const dependencies = Layer.mergeAll(configuration, transport)
		return Layer.mergeAll(
			PostgresDbLive(database),
			dependencies,
			GitHubServiceLive.pipe(Layer.provide(dependencies)),
		)
	}

	it.effect('claims a hashed state and persists the verified installation and repositories', () =>
		Effect.gen(function* () {
			providerRequests = []
			yield* TestClock.setTime(Date.UTC(2026, 6, 16))
			const github = yield* GitHubService
			const install = yield* github.createInstallUrl({ organizationId, requestedByUserId: 'admin-1' })
			const state = new URL(install.url).searchParams.get('state')
			if (!state) return yield* Effect.die('Install URL did not contain state')

			const completion = yield* github.completeInstallation({ installationId: '90071992547409931234', state })
			expect(completion.result).toBe('connected')

			const [connection] = yield* Effect.promise(() =>
				database
					.select()
					.from(githubIntegrations)
					.where(eq(githubIntegrations.installation_id, '90071992547409931234'))
					.limit(1),
			)
			expect(connection).toMatchObject({
				organization_id: organizationId,
				account_id: '90071992547409931235',
				installation_status: 'active',
			})
			if (!connection) return yield* Effect.die('GitHub connection was not persisted')
			const repositories = yield* Effect.promise(() =>
				database
					.select()
					.from(githubIntegrationRepositories)
					.where(eq(githubIntegrationRepositories.integration_id, connection.id)),
			)
			expect(repositories.map((repository) => repository.github_repository_id)).toEqual([
				'90071992547409931236',
				'90071992547409931237',
			])
			const [settings] = yield* Effect.promise(() =>
				database
					.select()
					.from(organizationSettings)
					.where(eq(organizationSettings.organization_id, organizationId)),
			)
			expect(settings?.github_integration_enabled).toBe(true)
			const [claim] = yield* Effect.promise(() => database.select().from(githubIntegrationInstallStates).limit(1))
			expect(claim?.state_token_hash).not.toBe(state)
			expect(claim?.consumed_at).not.toBeNull()
			expect(providerRequests.map((request) => request.pathname)).toEqual([
				'/app/installations/90071992547409931234',
				'/app/installations/90071992547409931234/access_tokens',
				'/installation/repositories',
			])
		}).pipe(Effect.provide(makeLayer())),
	)

	it.effect('converges a same-organization callback replay without duplicating the connection', () =>
		Effect.gen(function* () {
			const github = yield* GitHubService
			const install = yield* github.createInstallUrl({ organizationId, requestedByUserId: 'admin-1' })
			const state = new URL(install.url).searchParams.get('state')
			if (!state) return yield* Effect.die('Install URL did not contain state')
			const first = yield* github.completeInstallation({ installationId: '43', state })
			const replay = yield* github.completeInstallation({ installationId: '43', state })
			expect(replay).toEqual(first)
			const rows = yield* Effect.promise(() =>
				database.select().from(githubIntegrations).where(eq(githubIntegrations.installation_id, '43')),
			)
			expect(rows).toHaveLength(1)
		}).pipe(Effect.provide(makeLayer())),
	)

	it.effect('rejects cross-organization claims for an existing installation', () =>
		Effect.gen(function* () {
			const github = yield* GitHubService
			const install = yield* github.createInstallUrl({
				organizationId: secondOrganizationId,
				requestedByUserId: 'admin-2',
			})
			const state = new URL(install.url).searchParams.get('state')
			if (!state) return yield* Effect.die('Install URL did not contain state')
			const result = yield* github.completeInstallation({ installationId: '90071992547409931234', state }).pipe(
				Effect.as('connected' as const),
				Effect.catchTag('GitHubConnectionConflictError', () => Effect.succeed('conflict' as const)),
			)
			expect(result).toBe('conflict')
		}).pipe(Effect.provide(makeLayer())),
	)

	it.effect('persists an authenticated installation as unclaimed when state is absent', () =>
		Effect.gen(function* () {
			const github = yield* GitHubService
			const completion = yield* github.completeInstallation({ installationId: '99' })
			expect(completion).toEqual({ result: 'unclaimed' })
			const [connection] = yield* Effect.promise(() =>
				database.select().from(githubIntegrations).where(eq(githubIntegrations.installation_id, '99')),
			)
			expect(connection).toMatchObject({ organization_id: null, installation_status: 'unclaimed' })
		}).pipe(Effect.provide(makeLayer())),
	)

	it.effect('rejects an expired state before making provider requests', () =>
		Effect.gen(function* () {
			const github = yield* GitHubService
			yield* TestClock.setTime(0)
			const install = yield* github.createInstallUrl({ organizationId, requestedByUserId: 'admin-1' })
			const state = new URL(install.url).searchParams.get('state')
			if (!state) return yield* Effect.die('Install URL did not contain state')
			providerRequests = []
			yield* TestClock.adjust('8 days')
			const result = yield* github.completeInstallation({ installationId: '77', state }).pipe(
				Effect.as('connected' as const),
				Effect.catchTag('GitHubInstallStateInvalidError', () => Effect.succeed('expired' as const)),
			)
			expect(result).toBe('expired')
			expect(providerRequests).toEqual([])
		}).pipe(Effect.provide(makeLayer())),
	)

	it.effect('refreshes near-expiry tokens and persists the new generation', () =>
		Effect.gen(function* () {
			yield* TestClock.setTime(Date.UTC(2026, 6, 16))
			const [connection] = yield* Effect.promise(() =>
				database
					.insert(githubIntegrations)
					.values({
						organization_id: organizationId,
						installation_id: '88',
						account_id: '9007199254740990',
						account_login: 'humanlayer',
						account_type: 'Organization',
						access_token: 'expired-token',
						token_expires_at: 1n,
						token_generation: 4,
						repository_selection: 'selected',
						permissions: { metadata: 'read' },
						installation_status: 'active',
						connected_by_user_id: 'admin-1',
						last_reconciled_at: 1n,
					})
					.returning(),
			)
			if (!connection) return yield* Effect.die('Failed to insert token refresh fixture')
			const signingKey = yield* Effect.promise(() => importPKCS8(privateKey, 'RS256'))
			const refreshed = yield* getOrRefreshGitHubInstallationToken({
				organizationId,
				connectionId: connection.id,
				apiBaseUrl: new URL('https://api.github.test'),
				issuer: 'Iv1.test-client',
				signingKey,
			})
			expect(Redacted.value(refreshed)).toContain('ghs-token-')
			const [persisted] = yield* Effect.promise(() =>
				database.select().from(githubIntegrations).where(eq(githubIntegrations.id, connection.id)),
			)
			expect(persisted?.token_generation).toBe(5)
			expect(persisted?.access_token).toContain('ghs-token-')
		}).pipe(Effect.provide(makeLayer())),
	)

	it.effect('rejects malformed persisted permission JSON at the database read boundary', () =>
		Effect.gen(function* () {
			const [connection] = yield* Effect.promise(() =>
				database
					.insert(githubIntegrations)
					.values({
						organization_id: organizationId,
						installation_id: '12345678901234567890',
						account_id: '90071992547409931235',
						account_login: 'invalid-permissions',
						account_type: 'Organization',
						access_token: 'token',
						token_expires_at: BigInt(Date.UTC(2030, 0, 1)),
						token_generation: 1,
						repository_selection: 'selected',
						permissions: { metadata: 'read' },
						installation_status: 'active',
						connected_by_user_id: 'admin-1',
						last_reconciled_at: 1n,
					})
					.returning(),
			)
			if (!connection) return yield* Effect.die('Failed to insert malformed permission fixture')
			yield* Effect.promise(() =>
				database.execute(
					sql`UPDATE github_integrations SET permissions = '{"metadata":"admin"}'::jsonb WHERE id = ${connection.id}`,
				),
			)

			const github = yield* GitHubService
			const result = yield* github.listConnections({ organizationId }).pipe(
				Effect.as('accepted' as const),
				Effect.catchTag('GitHubIntegrationUnavailableError', () => Effect.succeed('rejected' as const)),
			)
			expect(result).toBe('rejected')
			yield* Effect.promise(() =>
				database.delete(githubIntegrations).where(eq(githubIntegrations.id, connection.id)),
			)
		}).pipe(Effect.provide(makeLayer())),
	)
})

const jsonResponse = (request: HttpClientRequest, body: unknown, status = 200) =>
	HttpClientResponse.fromWeb(
		request,
		new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
	)

const rawJsonResponse = (request: HttpClientRequest, body: string, status = 200) =>
	HttpClientResponse.fromWeb(request, new Response(body, { status, headers: { 'content-type': 'application/json' } }))
