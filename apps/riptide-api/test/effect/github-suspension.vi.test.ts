import { randomUUID } from 'node:crypto'

import { describe, it } from '@effect/vitest'
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

const SUSPENDED_AT = Date.parse('2026-07-16T00:00:00Z')

const unusedPrStatusStreamLayer = Layer.succeed(PrStatusStream, {
	hydrate: () => Effect.die('PrStatusStream.hydrate is not part of this suite'),
	publishChecks: () => Effect.die('PrStatusStream.publishChecks is not part of this suite'),
	publishPullRequest: () => Effect.die('PrStatusStream.publishPullRequest is not part of this suite'),
})

describe('GitHub installation suspension lifecycle', () => {
	let cleanupTestDatabase: (() => Promise<void>) | undefined
	let database: PostgresJsDatabase
	let organizationId: string
	let privateKey: string
	let providerRequests: string[] = []

	beforeAll(async () => {
		const testDatabase = await createTestDb('github_suspension_service')
		cleanupTestDatabase = testDatabase.cleanup
		database = testDatabase.db
		const [organization] = await database
			.insert(organizations)
			.values({ name: 'GitHub suspension org', workos_organization_id: `workos-${randomUUID()}` })
			.returning()
		if (!organization) throw new Error('Failed to create suspension test organization')
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
				GITHUB_APP_CLIENT_ID: 'Iv1.suspension',
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
							`{"id":${installationMatch[1]},"account":{"id":90071992547409931235,"login":"humanlayer","type":"Organization"},"repository_selection":"selected","permissions":{"issues":"write","metadata":"read"}}`,
						)
					}
					if (request.method === 'POST' && /\/access_tokens$/.test(url.pathname)) {
						return rawJsonResponse(
							request,
							'{"token":"ghs-suspension","expires_at":"2030-01-01T00:00:00Z"}',
						)
					}
					if (request.method === 'GET' && url.pathname === '/installation/repositories') {
						return rawJsonResponse(
							request,
							'{"total_count":1,"repositories":[{"id":90071992547409931236,"name":"riptide","full_name":"humanlayer/riptide","private":true,"default_branch":"main","archived":false,"owner":{"login":"humanlayer"}}]}',
						)
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

	const claimInstallation = (installationId: string) =>
		Effect.gen(function* () {
			const github = yield* GitHubService
			const install = yield* github.createInstallUrl({ organizationId, requestedByUserId: 'admin-1' })
			const state = new URL(install.url).searchParams.get('state')
			if (!state) return yield* Effect.die('missing state')
			yield* github.completeInstallation({ installationId, state })
		})

	it.effect('records suspension from the authenticated payload with zero provider requests and retains binding', () =>
		Effect.gen(function* () {
			yield* TestClock.setTime(Date.UTC(2026, 6, 16))
			const installationId = '7001'
			yield* claimInstallation(installationId)
			providerRequests = []
			const github = yield* GitHubService
			yield* github.handleWebhook({
				type: 'suspend',
				installationId,
				suspendedAt: SUSPENDED_AT,
				suspendedById: '55',
				suspendedByLogin: 'suspender',
				deliveryId: 's1',
			})
			// Suspension is a pure DB transition — GitHub cannot mint a token for a suspended install.
			expect(providerRequests).toEqual([])
			const [connection] = yield* Effect.promise(() =>
				database
					.select()
					.from(githubIntegrations)
					.where(eq(githubIntegrations.installation_id, installationId)),
			)
			expect(connection).toMatchObject({
				organization_id: organizationId,
				installation_status: 'suspended',
				suspended_by_id: '55',
				suspended_by_login: 'suspender',
			})
			expect(connection?.suspended_at).toBe(BigInt(SUSPENDED_AT))
		}).pipe(Effect.provide(makeLayer())),
	)

	it.effect('blocks refresh of a suspended connection with a suspension error and zero provider requests', () =>
		Effect.gen(function* () {
			yield* TestClock.setTime(Date.UTC(2026, 6, 16))
			const installationId = '7002'
			yield* claimInstallation(installationId)
			const github = yield* GitHubService
			yield* github.handleWebhook({
				type: 'suspend',
				installationId,
				suspendedAt: SUSPENDED_AT,
				suspendedById: '55',
				suspendedByLogin: 'suspender',
				deliveryId: 's2',
			})
			const [connection] = yield* Effect.promise(() =>
				database
					.select()
					.from(githubIntegrations)
					.where(eq(githubIntegrations.installation_id, installationId)),
			)
			if (!connection) return yield* Effect.die('connection missing')
			providerRequests = []
			const outcome = yield* github.refreshConnection({ organizationId, connectionId: connection.id }).pipe(
				Effect.map(() => 'refreshed' as const),
				Effect.catchTag('GitHubInstallationSuspendedError', (error) =>
					Effect.succeed({ suspended: error.suspendedByLogin }),
				),
			)
			expect(outcome).toEqual({ suspended: 'suspender' })
			expect(providerRequests).toEqual([])
		}).pipe(Effect.provide(makeLayer())),
	)

	it.effect('clears suspension and restores active state on an unsuspend reconciliation', () =>
		Effect.gen(function* () {
			yield* TestClock.setTime(Date.UTC(2026, 6, 16))
			const installationId = '7003'
			yield* claimInstallation(installationId)
			const github = yield* GitHubService
			yield* github.handleWebhook({
				type: 'suspend',
				installationId,
				suspendedAt: SUSPENDED_AT,
				suspendedById: '55',
				suspendedByLogin: 'suspender',
				deliveryId: 's3',
			})
			yield* github.handleWebhook({
				type: 'reconcile',
				installationId,
				reason: 'unsuspend',
				deliveryId: 's4',
			})
			const [connection] = yield* Effect.promise(() =>
				database
					.select()
					.from(githubIntegrations)
					.where(eq(githubIntegrations.installation_id, installationId)),
			)
			expect(connection).toMatchObject({
				organization_id: organizationId,
				installation_status: 'active',
				suspended_by_id: null,
				suspended_by_login: null,
			})
			expect(connection?.suspended_at).toBeNull()
		}).pipe(Effect.provide(makeLayer())),
	)
})

const rawJsonResponse = (request: HttpClientRequest, body: string, status = 200) =>
	HttpClientResponse.fromWeb(request, new Response(body, { status, headers: { 'content-type': 'application/json' } }))
