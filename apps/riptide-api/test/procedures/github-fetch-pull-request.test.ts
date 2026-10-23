import { randomUUID } from 'node:crypto'

import { githubIntegrationRepositories } from '@humanlayer/db/tables/github-integration-repositories'
import { githubIntegrations } from '@humanlayer/db/tables/github-integrations'
import { organizations } from '@humanlayer/db/tables/organizations'
import type { GitHubInstallationPermissions } from '@humanlayer/db/zodschemas/github-installation-permissions'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { ConfigProvider, Effect, Layer } from 'effect'
import * as HttpClient from 'effect/http/HttpClient'
import type { HttpClientRequest } from 'effect/http/HttpClientRequest'
import * as HttpClientResponse from 'effect/http/HttpClientResponse'
import { exportPKCS8, generateKeyPair } from 'jose'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { GitHubService, GitHubServiceLive } from '../../src/effects/services/github/github.service'
import { PostgresDbLive } from '../../src/effects/services/postgres/postgres-db.service'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

const REPO_FULL_NAME = 'humanlayer/syncopate'
const BRANCH = 'feat/pr-status'

const PANEL_PERMISSIONS: GitHubInstallationPermissions = {
	metadata: 'read',
	issues: 'write',
	pull_requests: 'write',
	checks: 'read',
	statuses: 'read',
}

const LEGACY_PERMISSIONS: GitHubInstallationPermissions = {
	metadata: 'read',
	issues: 'write',
	pull_requests: 'write',
}

const rawJsonResponse = (request: HttpClientRequest, body: string, status = 200) =>
	HttpClientResponse.fromWeb(request, new Response(body, { status, headers: { 'content-type': 'application/json' } }))

const forbiddenTransport = Layer.succeed(
	HttpClient.HttpClient,
	HttpClient.make(() => Effect.die('The capability guard must fire before any GitHub request')),
)

describe('GitHubService.fetchPullRequest', () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let githubLayer: Layer.Layer<GitHubService>
	let configuration: Layer.Layer<never>
	let organizationId: string

	beforeAll(async () => {
		const testDb = await createTestDb('github_fetch_pull_request')
		cleanupTestDb = testDb.cleanup
		db = testDb.db

		const { privateKey } = await generateKeyPair('RS256', { extractable: true })
		configuration = ConfigProvider.layer(
			ConfigProvider.fromUnknown({
				GITHUB_APP_ID: '123456',
				CLOUD_ORIGIN: 'https://cloud.example.test',
				GITHUB_APP_CLIENT_ID: 'Iv1.test-client-id',
				GITHUB_APP_SLUG: 'codelayer-integration-dev',
				GITHUB_APP_PRIVATE_KEY: await exportPKCS8(privateKey),
				GITHUB_APP_WEBHOOK_SECRET: 'test-webhook-secret',
			}),
		)
		githubLayer = GitHubServiceLive.pipe(
			Layer.provide(Layer.mergeAll(configuration, forbiddenTransport)),
			Layer.orDie,
		)

		const [org] = await db
			.insert(organizations)
			.values({ name: 'PR Panel Org', workos_organization_id: `workos-org-${randomUUID()}` })
			.returning()
		if (!org) throw new Error('Unable to insert organization for setup')
		organizationId = org.id
	}, 30000)

	afterAll(async () => {
		await cleanupTestDb?.()
	}, 30000)

	const createInstallation = async (input: {
		readonly permissions: GitHubInstallationPermissions
		readonly repoFullName: string
		readonly status?: 'active' | 'suspended'
	}) => {
		const status = input.status ?? 'active'
		const [integration] = await db
			.insert(githubIntegrations)
			.values({
				organization_id: organizationId,
				installation_id: `installation-${randomUUID()}`,
				account_id: `account-${randomUUID()}`,
				account_login: 'humanlayer',
				account_type: 'Organization',
				repository_selection: 'selected',
				permissions: input.permissions,
				installation_status: status,
				connected_by_user_id: status === 'active' ? 'user_pr_panel' : null,
				last_reconciled_at: BigInt(Date.now()),
			})
			.returning()
		if (!integration) throw new Error('Unable to insert github integration for setup')
		await db.insert(githubIntegrationRepositories).values({
			integration_id: integration.id,
			github_repository_id: `repo-${randomUUID()}`,
			owner_login: input.repoFullName.split('/')[0] ?? 'humanlayer',
			repository_name: input.repoFullName.split('/')[1] ?? 'syncopate',
			full_name: input.repoFullName,
			private: true,
			default_branch: 'main',
		})
		return integration
	}

	const fetchPullRequestFailure = (repoFullName: string) =>
		Effect.runPromise(
			Effect.gen(function* () {
				const github = yield* GitHubService
				return yield* Effect.flip(github.fetchPullRequest({ organizationId, repoFullName, branch: BRANCH }))
			}).pipe(Effect.provide(Layer.mergeAll(githubLayer, PostgresDbLive(db), forbiddenTransport))),
		)

	test('sends the repository and branch as separate GraphQL variables', async () => {
		const repoFullName = `humanlayer/panel-${randomUUID().slice(0, 8)}`
		await createInstallation({ permissions: PANEL_PERMISSIONS, repoFullName })

		const graphqlBodies: { query: string; variables: Record<string, unknown> }[] = []
		const recordingTransport = Layer.succeed(
			HttpClient.HttpClient,
			HttpClient.make((request, url) =>
				Effect.gen(function* () {
					if (request.method === 'POST' && /\/access_tokens$/.test(url.pathname)) {
						return rawJsonResponse(request, '{"token":"ghs-panel","expires_at":"2030-01-01T00:00:00Z"}')
					}
					if (request.method === 'POST' && url.pathname === '/graphql') {
						const body = yield* Effect.promise(async () =>
							request.body._tag === 'Uint8Array'
								? new TextDecoder().decode(request.body.body)
								: JSON.stringify({}),
						)
						graphqlBodies.push(JSON.parse(body) as (typeof graphqlBodies)[number])
						return rawJsonResponse(
							request,
							'{"data":{"repository":{"mergeCommitAllowed":true,"squashMergeAllowed":true,"rebaseMergeAllowed":true,"viewerDefaultMergeMethod":"MERGE","pullRequests":{"nodes":[]}}}}',
						)
					}
					return rawJsonResponse(request, '{"message":"Not Found"}', 404)
				}),
			),
		)
		const recordingGitHub = GitHubServiceLive.pipe(
			Layer.provide(Layer.mergeAll(configuration, recordingTransport)),
			Layer.orDie,
		)

		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const github = yield* GitHubService
				return yield* github.fetchPullRequest({ organizationId, repoFullName, branch: BRANCH })
			}).pipe(Effect.provide(Layer.mergeAll(recordingGitHub, PostgresDbLive(db), recordingTransport))),
		)

		expect(result).toBeNull()
		expect(graphqlBodies).toHaveLength(1)
		expect(graphqlBodies[0]?.variables).toEqual({
			owner: 'humanlayer',
			repo: repoFullName.split('/')[1],
			branch: BRANCH,
		})
	})

	test('refuses an installation without Checks read, before any GitHub request', async () => {
		await createInstallation({ permissions: LEGACY_PERMISSIONS, repoFullName: REPO_FULL_NAME })

		const error = await fetchPullRequestFailure(REPO_FULL_NAME)

		expect(error._tag).toBe('GitHubMissingPermissionsError')
		expect(error).toMatchObject({
			detectedBy: 'installation_grant',
			missing: [
				{ capability: 'readChecks', requiredPermission: 'checks', grantedLevel: null },
				{ capability: 'readCommitStatuses', requiredPermission: 'statuses', grantedLevel: null },
			],
		})
	})

	// A repository whose CI reports through commit statuses returns nothing from the Checks grant
	// alone, and the panel's rollup selects both node types in one union.
	test('refuses an installation with Checks read but no Commit statuses read', async () => {
		const repoFullName = `humanlayer/checks-only-${randomUUID().slice(0, 8)}`
		await createInstallation({ permissions: { ...LEGACY_PERMISSIONS, checks: 'read' }, repoFullName })

		const error = await fetchPullRequestFailure(repoFullName)

		expect(error._tag).toBe('GitHubMissingPermissionsError')
		expect(error).toMatchObject({
			detectedBy: 'installation_grant',
			missing: [{ capability: 'readCommitStatuses', requiredPermission: 'statuses', grantedLevel: null }],
		})
	})

	// An installation keeps the grant set it was installed with until an owner accepts a
	// permission the App added later, so the stored grant can pass the guard and GitHub still
	// refuse the nodes it covers. That is the connection needing a refresh, not an outage.
	test('reports a GraphQL refusal as a missing permission rather than an outage', async () => {
		const repoFullName = `humanlayer/refused-${randomUUID().slice(0, 8)}`
		await createInstallation({ permissions: PANEL_PERMISSIONS, repoFullName })

		const refusingTransport = Layer.succeed(
			HttpClient.HttpClient,
			HttpClient.make((request, url) => {
				if (request.method === 'POST' && /\/access_tokens$/.test(url.pathname)) {
					return Effect.succeed(
						rawJsonResponse(request, '{"token":"ghs-panel","expires_at":"2030-01-01T00:00:00Z"}'),
					)
				}
				if (request.method === 'POST' && url.pathname === '/graphql') {
					return Effect.succeed(
						rawJsonResponse(
							request,
							JSON.stringify({
								data: { repository: { pullRequests: { nodes: [null] } } },
								errors: [
									{
										type: 'FORBIDDEN',
										message: 'Resource not accessible by integration',
										path: ['repository', 'pullRequests', 'nodes', 0, 'commits'],
									},
								],
							}),
						),
					)
				}
				return Effect.succeed(rawJsonResponse(request, '{"message":"Not Found"}', 404))
			}),
		)
		const refusingGitHub = GitHubServiceLive.pipe(
			Layer.provide(Layer.mergeAll(configuration, refusingTransport)),
			Layer.orDie,
		)

		const error = await Effect.runPromise(
			Effect.gen(function* () {
				const github = yield* GitHubService
				return yield* Effect.flip(github.fetchPullRequest({ organizationId, repoFullName, branch: BRANCH }))
			}).pipe(Effect.provide(Layer.mergeAll(refusingGitHub, PostgresDbLive(db), refusingTransport))),
		)

		expect(error._tag).toBe('GitHubMissingPermissionsError')
		expect(error).toMatchObject({ detectedBy: 'github_refusal' })
	})

	test('reports a repository no installation covers as not accessible', async () => {
		const error = await fetchPullRequestFailure('humanlayer/never-installed')

		expect(error._tag).toBe('GitHubRepositoryNotAccessibleError')
	})

	test('reports a suspended installation as not accessible rather than reaching GitHub', async () => {
		const suspendedRepo = 'humanlayer/suspended-repo'
		await createInstallation({
			permissions: { ...LEGACY_PERMISSIONS, checks: 'read' },
			repoFullName: suspendedRepo,
			status: 'suspended',
		})

		const error = await fetchPullRequestFailure(suspendedRepo)

		expect(error._tag).toBe('GitHubRepositoryNotAccessibleError')
	})

	test('matches a repository stored with GitHub casing', async () => {
		await createInstallation({ permissions: LEGACY_PERMISSIONS, repoFullName: 'HumanLayer/CasedRepo' })

		const error = await fetchPullRequestFailure('humanlayer/casedrepo')

		expect(error._tag).toBe('GitHubMissingPermissionsError')
	})
})
