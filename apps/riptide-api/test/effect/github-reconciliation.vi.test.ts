import { randomUUID } from 'node:crypto'

import { describe, it } from '@effect/vitest'
import { githubIntegrationRepositories } from '@humanlayer/db/tables/github-integration-repositories'
import { githubIntegrations } from '@humanlayer/db/tables/github-integrations'
import { organizations } from '@humanlayer/db/tables/organizations'
import { eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { ConfigProvider, Effect, Layer } from 'effect'
import * as HttpClient from 'effect/http/HttpClient'
import type { HttpClientRequest } from 'effect/http/HttpClientRequest'
import * as HttpClientResponse from 'effect/http/HttpClientResponse'
import { TestClock } from 'effect/testing'
import { exportPKCS8, generateKeyPair } from 'jose'
import { afterAll, beforeAll, expect } from 'vitest'

import { GitHubService, GitHubServiceLive } from '../../src/effects/services/github/github.service'
import { PostgresDbLive } from '../../src/effects/services/postgres/postgres-db.service'
import { PrStatusStream } from '../../src/effects/services/pr-status-stream/pr-status-stream.service'
import { createTestDb } from '../utils/test-db'

const INSTALLATION_ID = '90071992547409931234'

const unusedPrStatusStreamLayer = Layer.succeed(PrStatusStream, {
	hydrate: () => Effect.die('PrStatusStream.hydrate is not part of this suite'),
	publishChecks: () => Effect.die('PrStatusStream.publishChecks is not part of this suite'),
	publishPullRequest: () => Effect.die('PrStatusStream.publishPullRequest is not part of this suite'),
})

describe('GitHub installation reconciliation', () => {
	let cleanupTestDatabase: (() => Promise<void>) | undefined
	let database: PostgresJsDatabase
	let organizationId: string
	let privateKey: string
	let providerRequests: string[] = []
	// Mutable provider state so a test can change GitHub's "current" response between deliveries.
	let permissionsJson = '{"contents":"write","issues":"write","pull_requests":"write","metadata":"read"}'
	let repositoriesJson =
		'{"total_count":2,"repositories":[{"id":90071992547409931236,"name":"riptide","full_name":"humanlayer/riptide","private":true,"default_branch":"main","archived":false,"owner":{"login":"humanlayer"}},{"id":90071992547409931237,"name":"docs","full_name":"humanlayer/docs","private":false,"default_branch":"main","archived":false,"owner":{"login":"humanlayer"}}]}'

	beforeAll(async () => {
		const testDatabase = await createTestDb('github_reconciliation_service')
		cleanupTestDatabase = testDatabase.cleanup
		database = testDatabase.db
		const [organization] = await database
			.insert(organizations)
			.values({ name: 'GitHub reconcile org', workos_organization_id: `workos-${randomUUID()}` })
			.returning()
		if (!organization) throw new Error('Failed to create reconcile test organization')
		organizationId = organization.id
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
				GITHUB_APP_CLIENT_ID: 'Iv1.reconcile',
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
						return rawJsonResponse(
							request,
							`{"id":${installationMatch[1]},"account":{"id":90071992547409931235,"login":"humanlayer","type":"Organization"},"repository_selection":"selected","permissions":${permissionsJson}}`,
						)
					}
					if (request.method === 'POST' && /\/access_tokens$/.test(url.pathname)) {
						return rawJsonResponse(request, '{"token":"ghs-reconcile","expires_at":"2030-01-01T00:00:00Z"}')
					}
					if (request.method === 'GET' && url.pathname === '/installation/repositories') {
						return rawJsonResponse(request, repositoriesJson)
					}
					return rawJsonResponse(request, '{"message":"Not Found"}', 404)
				}),
			),
		)
		const dependencies = Layer.mergeAll(PostgresDbLive(database), configuration, transport)
		return Layer.mergeAll(
			PostgresDbLive(database),
			transport,
			unusedPrStatusStreamLayer,
			GitHubServiceLive.pipe(Layer.provide(dependencies)),
		)
	}

	it.effect('stores a first-seen installation.created delivery as unclaimed and seeds its inventory', () =>
		Effect.gen(function* () {
			yield* TestClock.setTime(Date.UTC(2026, 6, 16))
			providerRequests = []
			const github = yield* GitHubService
			yield* github.handleWebhook({
				type: 'reconcile',
				installationId: INSTALLATION_ID,
				reason: 'created',
				deliveryId: 'd1',
			})
			const [connection] = yield* Effect.promise(() =>
				database
					.select()
					.from(githubIntegrations)
					.where(eq(githubIntegrations.installation_id, INSTALLATION_ID)),
			)
			expect(connection).toMatchObject({ organization_id: null, installation_status: 'unclaimed' })
			if (!connection) return yield* Effect.die('connection missing')
			const repositories = yield* Effect.promise(() =>
				database
					.select()
					.from(githubIntegrationRepositories)
					.where(eq(githubIntegrationRepositories.integration_id, connection.id)),
			)
			expect(repositories.map((repository) => repository.github_repository_id).sort()).toEqual([
				'90071992547409931236',
				'90071992547409931237',
			])
		}).pipe(Effect.provide(makeLayer())),
	)

	it.effect(
		'replaces the repository inventory and updates permissions on a later delivery without duplicating rows',
		() =>
			Effect.gen(function* () {
				yield* TestClock.setTime(Date.UTC(2026, 6, 16))
				const github = yield* GitHubService
				// Bind the installation to the organization so we can assert the binding survives reconcile.
				const install = yield* github.createInstallUrl({ organizationId, requestedByUserId: 'admin-1' })
				const state = new URL(install.url).searchParams.get('state')
				if (!state) return yield* Effect.die('missing state')
				const claimInstallationId = '5150'
				yield* github.completeInstallation({ installationId: claimInstallationId, state })

				// GitHub now reports a different repository set and a degraded permission grant.
				repositoriesJson =
					'{"total_count":1,"repositories":[{"id":90071992547409931237,"name":"docs","full_name":"humanlayer/docs","private":false,"default_branch":"main","archived":false,"owner":{"login":"humanlayer"}}]}'
				permissionsJson = '{"issues":"read","metadata":"read"}'
				yield* github.handleWebhook({
					type: 'reconcile',
					installationId: claimInstallationId,
					reason: 'new_permissions_accepted',
					deliveryId: 'd2',
				})

				const rows = yield* Effect.promise(() =>
					database
						.select()
						.from(githubIntegrations)
						.where(eq(githubIntegrations.installation_id, claimInstallationId)),
				)
				expect(rows).toHaveLength(1)
				const connection = rows[0]
				if (!connection) return yield* Effect.die('connection missing')
				// Binding preserved; still active; permission grant updated.
				expect(connection).toMatchObject({
					organization_id: organizationId,
					installation_status: 'active',
					permissions: { issues: 'read', metadata: 'read' },
				})
				const repositories = yield* Effect.promise(() =>
					database
						.select()
						.from(githubIntegrationRepositories)
						.where(eq(githubIntegrationRepositories.integration_id, connection.id)),
				)
				expect(repositories.map((repository) => repository.github_repository_id)).toEqual([
					'90071992547409931237',
				])

				// The projected connection derives capabilities from the persisted grant: preview stays
				// available (issues:read) while the back-link write capability is now unavailable.
				const projected = yield* github.getConnection({ organizationId, connectionId: connection.id })
				expect(projected.capabilities.previewIssue).toBe(true)
				expect(projected.capabilities.writeBacklink).toBe(false)
				expect(projected.status).toBe('active')

				// Reset shared provider state for other tests.
				repositoriesJson =
					'{"total_count":2,"repositories":[{"id":90071992547409931236,"name":"riptide","full_name":"humanlayer/riptide","private":true,"default_branch":"main","archived":false,"owner":{"login":"humanlayer"}},{"id":90071992547409931237,"name":"docs","full_name":"humanlayer/docs","private":false,"default_branch":"main","archived":false,"owner":{"login":"humanlayer"}}]}'
				permissionsJson = '{"contents":"write","issues":"write","pull_requests":"write","metadata":"read"}'
			}).pipe(Effect.provide(makeLayer())),
	)

	it.effect('converges duplicate reconcile deliveries on a single row', () =>
		Effect.gen(function* () {
			yield* TestClock.setTime(Date.UTC(2026, 6, 16))
			const github = yield* GitHubService
			const duplicateInstallationId = '246810'
			const reconcile = () =>
				github.handleWebhook({
					type: 'reconcile' as const,
					installationId: duplicateInstallationId,
					reason: 'created' as const,
					deliveryId: 'dup',
				})
			yield* reconcile()
			yield* reconcile()
			yield* reconcile()
			const rows = yield* Effect.promise(() =>
				database
					.select()
					.from(githubIntegrations)
					.where(eq(githubIntegrations.installation_id, duplicateInstallationId)),
			)
			expect(rows).toHaveLength(1)
		}).pipe(Effect.provide(makeLayer())),
	)
})

const rawJsonResponse = (request: HttpClientRequest, body: string, status = 200) =>
	HttpClientResponse.fromWeb(request, new Response(body, { status, headers: { 'content-type': 'application/json' } }))
