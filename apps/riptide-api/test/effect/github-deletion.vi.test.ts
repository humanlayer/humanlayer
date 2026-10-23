import { randomUUID } from 'node:crypto'

import { describe, it } from '@effect/vitest'
import { githubIntegrationRepositories } from '@humanlayer/db/tables/github-integration-repositories'
import { githubIntegrations } from '@humanlayer/db/tables/github-integrations'
import { organizationSettings } from '@humanlayer/db/tables/organization-settings'
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

const unusedPrStatusStreamLayer = Layer.succeed(PrStatusStream, {
	hydrate: () => Effect.die('PrStatusStream.hydrate is not part of this suite'),
	publishChecks: () => Effect.die('PrStatusStream.publishChecks is not part of this suite'),
	publishPullRequest: () => Effect.die('PrStatusStream.publishPullRequest is not part of this suite'),
})

describe('GitHub installation deletion and disconnect', () => {
	let cleanupTestDatabase: (() => Promise<void>) | undefined
	let database: PostgresJsDatabase
	let privateKey: string
	// Mutable DELETE /app/installations status: 204 confirms uninstall, 404 already gone, 500 fails.
	let deleteStatus = 204

	beforeAll(async () => {
		const testDatabase = await createTestDb('github_deletion_service')
		cleanupTestDatabase = testDatabase.cleanup
		database = testDatabase.db
		const generatedKeyPair = await generateKeyPair('RS256', { extractable: true })
		privateKey = await exportPKCS8(generatedKeyPair.privateKey)
	}, 60_000)

	afterAll(async () => {
		await cleanupTestDatabase?.()
	}, 30_000)

	const newOrganization = async () => {
		const [organization] = await database
			.insert(organizations)
			.values({ name: 'GitHub deletion org', workos_organization_id: `workos-${randomUUID()}` })
			.returning()
		if (!organization) throw new Error('Failed to create deletion test organization')
		return organization.id
	}

	const makeLayer = () => {
		const configuration = ConfigProvider.layer(
			ConfigProvider.fromUnknown({
				GITHUB_APP_ID: '123',
				CLOUD_ORIGIN: 'https://cloud.example.test',
				GITHUB_APP_CLIENT_ID: 'Iv1.deletion',
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
					const installationMatch = url.pathname.match(/^\/app\/installations\/(\d+)$/)
					if (request.method === 'DELETE' && installationMatch) {
						return emptyResponse(request, deleteStatus)
					}
					if (request.method === 'GET' && installationMatch) {
						return rawJsonResponse(
							request,
							`{"id":${installationMatch[1]},"account":{"id":90071992547409931235,"login":"humanlayer","type":"Organization"},"repository_selection":"selected","permissions":{"issues":"write","metadata":"read"}}`,
						)
					}
					if (request.method === 'POST' && /\/access_tokens$/.test(url.pathname)) {
						return rawJsonResponse(request, '{"token":"ghs-deletion","expires_at":"2030-01-01T00:00:00Z"}')
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

	const claim = (organizationId: string, installationId: string) =>
		Effect.gen(function* () {
			const github = yield* GitHubService
			const install = yield* github.createInstallUrl({ organizationId, requestedByUserId: 'admin-1' })
			const state = new URL(install.url).searchParams.get('state')
			if (!state) return yield* Effect.die('missing state')
			yield* github.completeInstallation({ installationId, state })
		})

	const settingEnabled = (organizationId: string) =>
		Effect.promise(async () => {
			const [settings] = await database
				.select({ enabled: organizationSettings.github_integration_enabled })
				.from(organizationSettings)
				.where(eq(organizationSettings.organization_id, organizationId))
			return settings?.enabled ?? false
		})

	it.effect('terminally deletes only the named installation and disables the setting after the last one', () =>
		Effect.gen(function* () {
			yield* TestClock.setTime(Date.UTC(2026, 6, 16))
			const organizationId = yield* Effect.promise(newOrganization)
			const github = yield* GitHubService
			yield* claim(organizationId, '8001')
			yield* claim(organizationId, '8002')

			// Delete the first installation directly-in-GitHub delivery: sibling and setting survive.
			yield* github.handleWebhook({ type: 'delete', installationId: '8001', deliveryId: 'del1' })
			expect(
				yield* Effect.promise(() =>
					database.select().from(githubIntegrations).where(eq(githubIntegrations.installation_id, '8001')),
				),
			).toEqual([])
			const sibling = yield* Effect.promise(() =>
				database.select().from(githubIntegrations).where(eq(githubIntegrations.installation_id, '8002')),
			)
			expect(sibling).toHaveLength(1)
			expect(yield* settingEnabled(organizationId)).toBe(true)

			// Replayed deletion is idempotent; the last deletion disables the organization setting.
			yield* github.handleWebhook({ type: 'delete', installationId: '8001', deliveryId: 'del1-replay' })
			yield* github.handleWebhook({ type: 'delete', installationId: '8002', deliveryId: 'del2' })
			expect(
				yield* Effect.promise(() =>
					database
						.select()
						.from(githubIntegrations)
						.where(eq(githubIntegrations.organization_id, organizationId)),
				),
			).toEqual([])
			expect(yield* settingEnabled(organizationId)).toBe(false)
		}).pipe(Effect.provide(makeLayer())),
	)

	it.effect('disconnect removes local state only after GitHub confirms the uninstall', () =>
		Effect.gen(function* () {
			yield* TestClock.setTime(Date.UTC(2026, 6, 16))
			deleteStatus = 204
			const organizationId = yield* Effect.promise(newOrganization)
			const github = yield* GitHubService
			yield* claim(organizationId, '8100')
			const [connection] = yield* Effect.promise(() =>
				database.select().from(githubIntegrations).where(eq(githubIntegrations.installation_id, '8100')),
			)
			if (!connection) return yield* Effect.die('connection missing')
			const result = yield* github.disconnect({ organizationId, connectionId: connection.id })
			expect(result).toEqual({ success: true })
			expect(
				yield* Effect.promise(() =>
					database.select().from(githubIntegrations).where(eq(githubIntegrations.id, connection.id)),
				),
			).toEqual([])
			expect(
				yield* Effect.promise(() =>
					database
						.select()
						.from(githubIntegrationRepositories)
						.where(eq(githubIntegrationRepositories.integration_id, connection.id)),
				),
			).toEqual([])
			expect(yield* settingEnabled(organizationId)).toBe(false)
		}).pipe(Effect.provide(makeLayer())),
	)

	it.effect('treats an already-gone (404) installation as a confirmed uninstall', () =>
		Effect.gen(function* () {
			yield* TestClock.setTime(Date.UTC(2026, 6, 16))
			deleteStatus = 404
			const organizationId = yield* Effect.promise(newOrganization)
			const github = yield* GitHubService
			yield* claim(organizationId, '8200')
			const [connection] = yield* Effect.promise(() =>
				database.select().from(githubIntegrations).where(eq(githubIntegrations.installation_id, '8200')),
			)
			if (!connection) return yield* Effect.die('connection missing')
			yield* github.disconnect({ organizationId, connectionId: connection.id })
			expect(
				yield* Effect.promise(() =>
					database.select().from(githubIntegrations).where(eq(githubIntegrations.id, connection.id)),
				),
			).toEqual([])
		}).pipe(Effect.provide(makeLayer())),
	)

	it.effect('preserves local state and fails when GitHub cannot confirm the uninstall', () =>
		Effect.gen(function* () {
			yield* TestClock.setTime(Date.UTC(2026, 6, 16))
			deleteStatus = 500
			const organizationId = yield* Effect.promise(newOrganization)
			const github = yield* GitHubService
			yield* claim(organizationId, '8300')
			const [connection] = yield* Effect.promise(() =>
				database.select().from(githubIntegrations).where(eq(githubIntegrations.installation_id, '8300')),
			)
			if (!connection) return yield* Effect.die('connection missing')
			const outcome = yield* github.disconnect({ organizationId, connectionId: connection.id }).pipe(
				Effect.map(() => 'disconnected' as const),
				Effect.catchTag('GitHubDisconnectFailedError', () => Effect.succeed('failed' as const)),
			)
			expect(outcome).toBe('failed')
			// Local rows are preserved so the administrator can retry.
			expect(
				yield* Effect.promise(() =>
					database.select().from(githubIntegrations).where(eq(githubIntegrations.id, connection.id)),
				),
			).toHaveLength(1)
			expect(yield* settingEnabled(organizationId)).toBe(true)
			deleteStatus = 204
		}).pipe(Effect.provide(makeLayer())),
	)
})

const rawJsonResponse = (request: HttpClientRequest, body: string, status = 200) =>
	HttpClientResponse.fromWeb(request, new Response(body, { status, headers: { 'content-type': 'application/json' } }))

const emptyResponse = (request: HttpClientRequest, status: number) =>
	HttpClientResponse.fromWeb(request, new Response(null, { status }))
