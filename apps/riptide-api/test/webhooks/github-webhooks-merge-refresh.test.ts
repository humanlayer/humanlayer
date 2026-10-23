import { randomUUID } from 'node:crypto'

import { githubIntegrationRepositories } from '@humanlayer/db/tables/github-integration-repositories'
import { githubIntegrations } from '@humanlayer/db/tables/github-integrations'
import { organizations } from '@humanlayer/db/tables/organizations'
import { pullRequestSessions } from '@humanlayer/db/tables/pull-request-sessions'
import { pullRequests } from '@humanlayer/db/tables/pull-requests'
import { sessionRepositories } from '@humanlayer/db/tables/session-repositories'
import { sessions } from '@humanlayer/db/tables/sessions'
import type { PullRequestRowType } from '@humanlayer/streams/pr-status'
import { and, eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { ConfigProvider, Effect, Layer } from 'effect'
import * as HttpClient from 'effect/http/HttpClient'
import type { HttpClientRequest } from 'effect/http/HttpClientRequest'
import * as HttpClientResponse from 'effect/http/HttpClientResponse'
import { Hono } from 'hono'
import { exportPKCS8, generateKeyPair } from 'jose'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { GitHubServiceLive } from '../../src/effects/services/github/github.service'
import { computeGitHubSignature } from '../../src/effects/services/github/github.webhooks'
import { PostgresDbLive } from '../../src/effects/services/postgres/postgres-db.service'
import { PrStatusStream } from '../../src/effects/services/pr-status-stream/pr-status-stream.service'
import { registerGitHubWebhookRoute } from '../../src/webhooks/github'
import { createRuntimeWithTestPostgresLayer } from '../utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

const WEBHOOK_SECRET = 'webhook-secret'
const INSTALLATION_ID = '90071992547409935679'
const BRANCH = 'feat/merge-row'
const HEAD_SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'
/** Short enough to wait for, long enough that a burst of deliveries lands inside it. */
const REFRESH_DELAY_MS = 40

// Raw strings: the installation id is above MAX_SAFE_INTEGER, so a number literal would round.
const checkRunBody = (status: 'completed' | 'in_progress') =>
	`{"action":"${status}","installation":{"id":${INSTALLATION_ID}},` +
	`"repository":{"full_name":"HumanLayer/Syncopate"},` +
	`"check_run":{"name":"typecheck","head_sha":"${HEAD_SHA}","status":"${status}",` +
	`"conclusion":${status === 'completed' ? '"success"' : 'null'},` +
	`"details_url":"https://github.com/humanlayer/syncopate/actions/runs/1/job/2",` +
	`"started_at":"2026-08-30T09:00:00Z","completed_at":${status === 'completed' ? '"2026-08-30T09:01:12Z"' : 'null'},` +
	`"check_suite":{"id":42,"head_branch":"${BRANCH}"}}}`

const pullRequestBody = (action: string, state: 'open' | 'closed' = 'open') =>
	`{"action":"${action}","installation":{"id":${INSTALLATION_ID}},` +
	`"repository":{"full_name":"HumanLayer/Syncopate"},` +
	`"pull_request":{"number":2489,"title":"Add the tray",` +
	`"html_url":"https://github.com/humanlayer/syncopate/pull/2489",` +
	`"state":"${state}","draft":false,"merged":false,"mergeable":null,` +
	`"head":{"ref":"${BRANCH}","sha":"${HEAD_SHA}","repo":{"full_name":"HumanLayer/Syncopate"}},` +
	`"base":{"ref":"main"},"user":{"login":"octocat","id":583231,"type":"User"},` +
	`"created_at":"2026-08-30T09:00:00Z","merged_at":null,"closed_at":null,"merged_by":null}}`

const panelQueryResponse = (headCommitMessage: string) =>
	JSON.stringify({
		data: {
			repository: {
				mergeCommitAllowed: true,
				squashMergeAllowed: true,
				rebaseMergeAllowed: false,
				viewerDefaultMergeMethod: 'SQUASH',
				pullRequests: {
					nodes: [
						{
							number: 2489,
							title: 'Add the tray',
							url: 'https://github.com/humanlayer/syncopate/pull/2489',
							state: 'OPEN',
							isDraft: false,
							mergeable: 'MERGEABLE',
							reviewDecision: 'APPROVED',
							headRefName: BRANCH,
							baseRefName: 'main',
							headRepository: { nameWithOwner: 'HumanLayer/Syncopate' },
							mergeStateStatus: 'CLEAN',
							autoMergeRequest: null,
							viewerCanEnableAutoMerge: false,
							viewerCanDisableAutoMerge: false,
							viewerCanUpdateBranch: false,
							mergeHeadline: 'Merge pull request #2489',
							mergeBody: 'Add the tray',
							squashHeadline: 'Add the tray (#2489)',
							squashBody: '* Add the tray',
							reviewThreads: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] },
							latestReviews: { nodes: [] },
							commits: {
								totalCount: 1,
								nodes: [
									{ commit: { oid: HEAD_SHA, message: headCommitMessage, statusCheckRollup: null } },
								],
							},
						},
					],
				},
			},
		},
	})

const rawJsonResponse = (request: HttpClientRequest, body: string, status = 200) =>
	HttpClientResponse.fromWeb(request, new Response(body, { status, headers: { 'content-type': 'application/json' } }))

describe('GitHub webhook merge state refresh', () => {
	let cleanupTestDatabase: (() => Promise<void>) | undefined
	let database: PostgresJsDatabase
	let runtime: ReturnType<typeof createRuntimeWithTestPostgresLayer>
	let app: Hono
	let organizationId: string
	let observedSessionId: string
	let unobservedSessionId: string
	let headCommitMessage = ''
	const graphqlRequests: string[] = []
	const pullRequestAppends: { branch: string; row: PullRequestRowType }[] = []

	beforeAll(async () => {
		const testDatabase = await createTestDb('github_webhook_merge_refresh')
		cleanupTestDatabase = testDatabase.cleanup
		database = testDatabase.db
		const [organization] = await database
			.insert(organizations)
			.values({ name: 'Merge refresh org', workos_organization_id: `workos-${randomUUID()}` })
			.returning()
		if (!organization) throw new Error('Unable to insert the organization for setup')
		organizationId = organization.id
		const [integration] = await database
			.insert(githubIntegrations)
			.values({
				organization_id: organizationId,
				installation_id: INSTALLATION_ID,
				account_id: '4243',
				account_login: 'humanlayer',
				account_type: 'Organization',
				repository_selection: 'selected',
				permissions: { metadata: 'read', pull_requests: 'write', checks: 'read', statuses: 'read' },
				installation_status: 'active',
				connected_by_user_id: 'user_merge_refresh',
				last_reconciled_at: BigInt(Date.now()),
			})
			.returning({ id: githubIntegrations.id })
		if (!integration) throw new Error('Unable to insert the integration for setup')
		await database.insert(githubIntegrationRepositories).values({
			integration_id: integration.id,
			github_repository_id: 'repo-syncopate-refresh',
			owner_login: 'humanlayer',
			repository_name: 'syncopate',
			full_name: 'humanlayer/syncopate',
			private: true,
			default_branch: 'main',
		})
		const insertSession = async () => {
			const [session] = await database
				.insert(sessions)
				.values({
					organization_id: organizationId,
					resource_owner_user_id: 'user_merge_refresh',
					created_by: 'user_merge_refresh',
					host_id: randomUUID(),
					title: 'trailer session',
					working_directory: '/home/dev/syncopate',
					status: 'running',
				})
				.returning({ id: sessions.id })
			if (!session) throw new Error('Unable to insert a session for setup')
			return session.id
		}
		observedSessionId = await insertSession()
		unobservedSessionId = await insertSession()
		await database.insert(sessionRepositories).values({
			organization_id: organizationId,
			session_id: observedSessionId,
			host_id: randomUUID(),
			local_path: '/home/dev/syncopate',
			repo_full_name: 'humanlayer/syncopate',
			branch: 'another-branch',
			is_head: true,
			first_seen_at: BigInt(Date.now()),
			last_seen_at: BigInt(Date.now()),
		})
		const generatedKeyPair = await generateKeyPair('RS256', { extractable: true })
		const configuration = ConfigProvider.layer(
			ConfigProvider.fromUnknown({
				GITHUB_APP_ID: '123',
				CLOUD_ORIGIN: 'https://cloud.example.test',
				GITHUB_APP_CLIENT_ID: 'Iv1.merge-refresh',
				GITHUB_APP_SLUG: 'humanlayer-test',
				GITHUB_APP_PRIVATE_KEY: await exportPKCS8(generatedKeyPair.privateKey),
				GITHUB_APP_WEBHOOK_SECRET: WEBHOOK_SECRET,
				GITHUB_API_BASE_URL: 'https://api.github.test',
				GITHUB_MERGE_STATE_REFRESH_DELAY_MS: String(REFRESH_DELAY_MS),
			}),
		)
		const transport = Layer.succeed(
			HttpClient.HttpClient,
			HttpClient.make((request, url) =>
				Effect.sync(() => {
					if (request.method === 'POST' && /\/access_tokens$/.test(url.pathname)) {
						return rawJsonResponse(request, '{"token":"ghs-refresh","expires_at":"2030-01-01T00:00:00Z"}')
					}
					if (request.method === 'POST' && url.pathname === '/graphql') {
						graphqlRequests.push(url.pathname)
						return rawJsonResponse(request, panelQueryResponse(headCommitMessage))
					}
					return rawJsonResponse(request, '{"message":"Not Found"}', 404)
				}),
			),
		)
		runtime = createRuntimeWithTestPostgresLayer(database, {
			github: GitHubServiceLive.pipe(
				Layer.provide(Layer.mergeAll(PostgresDbLive(database), configuration, transport)),
				Layer.orDie,
			),
			httpClient: transport,
			prStatusStream: Layer.succeed(PrStatusStream, {
				hydrate: () => Effect.die('not used'),
				publishChecks: () => Effect.void,
				publishPullRequest: (key, row) =>
					Effect.sync(() => void pullRequestAppends.push({ branch: key.branch, row })),
			}),
		})
		app = new Hono()
		registerGitHubWebhookRoute(app, {
			appRuntime: runtime,
			logger: { info: async () => undefined, warn: async () => undefined, error: async () => undefined },
		})
	}, 60_000)

	afterAll(async () => {
		await runtime?.dispose()
		await cleanupTestDatabase?.()
	}, 30_000)

	const post = (body: string, event: string) =>
		app.request('http://localhost/webhooks/github', {
			method: 'POST',
			headers: {
				'X-Hub-Signature-256': computeGitHubSignature({ webhookSecret: WEBHOOK_SECRET, rawBody: body }),
				'X-GitHub-Event': event,
				'X-GitHub-Delivery': randomUUID(),
			},
			body,
		})

	const settle = () => new Promise((resolve) => setTimeout(resolve, REFRESH_DELAY_MS * 4))

	const waitForGraphql = async (expected: number) => {
		const deadline = Date.now() + 5_000
		while (graphqlRequests.length < expected && Date.now() < deadline) {
			await new Promise((resolve) => setTimeout(resolve, 10))
		}
		return graphqlRequests.length
	}

	/** The branch as the panel already recorded it: a check settles the merge state only for one of these. */
	const recordOpenPullRequest = async () => {
		await database.insert(pullRequests).values({
			organization_id: organizationId,
			repo_full_name: 'humanlayer/syncopate',
			number: 2489,
			url: 'https://github.com/humanlayer/syncopate/pull/2489',
			title: 'Add the tray',
			state: 'open',
			head_ref: BRANCH,
			head_sha: HEAD_SHA,
			source: 'app',
		})
	}

	beforeEach(async () => {
		await settle()
		graphqlRequests.length = 0
		pullRequestAppends.length = 0
		headCommitMessage = ''
		await database.delete(pullRequests).where(eq(pullRequests.organization_id, organizationId))
		await database.delete(pullRequestSessions).where(eq(pullRequestSessions.organization_id, organizationId))
		await database.delete(sessionRepositories).where(eq(sessionRepositories.branch, BRANCH))
	})

	const recordedOwner = async () => {
		const [row] = await database
			.select({ sessionId: pullRequests.session_id })
			.from(pullRequests)
			.where(and(eq(pullRequests.organization_id, organizationId), eq(pullRequests.number, 2489)))
		return row?.sessionId
	}

	const trailerNaming = (sessionId: string) =>
		`Add the tray\n\nHumanLayer-Session: https://app.example.test/sessions/${sessionId}`

	test('a completed check on a branch with no pull request costs no query at all', async () => {
		expect((await post(checkRunBody('completed'), 'check_run')).status).toBe(202)
		await settle()

		expect(graphqlRequests).toEqual([])
	})

	test('a burst of completed checks costs one query, a little later, and publishes the merge state', async () => {
		await recordOpenPullRequest()
		for (let index = 0; index < 5; index += 1) {
			expect((await post(checkRunBody('completed'), 'check_run')).status).toBe(202)
		}
		expect(graphqlRequests).toEqual([])

		expect(await waitForGraphql(1)).toBe(1)
		await settle()

		expect(graphqlRequests).toHaveLength(1)
		const refreshed = pullRequestAppends.find((append) => append.row.merge !== null)
		expect(refreshed?.row.merge).toMatchObject({
			mergeStateStatus: 'CLEAN',
			mergeCommitAllowed: true,
			squashMergeAllowed: true,
			rebaseMergeAllowed: false,
			viewerDefaultMergeMethod: 'SQUASH',
		})
		const [row] = await database
			.select()
			.from(pullRequests)
			.where(and(eq(pullRequests.organization_id, organizationId), eq(pullRequests.number, 2489)))
		expect(row?.merge_state).toMatchObject({ mergeStateStatus: 'CLEAN' })
	})

	test('a check still running schedules nothing', async () => {
		await recordOpenPullRequest()

		expect((await post(checkRunBody('in_progress'), 'check_run')).status).toBe(202)
		await settle()

		expect(graphqlRequests).toEqual([])
	})

	test('an opened pull request on a branch a session observed is free', async () => {
		await database.insert(sessionRepositories).values({
			organization_id: organizationId,
			session_id: observedSessionId,
			host_id: randomUUID(),
			local_path: '/home/dev/syncopate',
			repo_full_name: 'humanlayer/syncopate',
			branch: BRANCH,
			is_head: false,
			first_seen_at: BigInt(Date.now()),
			last_seen_at: BigInt(Date.now()),
		})

		expect((await post(pullRequestBody('opened'), 'pull_request')).status).toBe(202)
		await settle()

		expect(graphqlRequests).toEqual([])
		expect(pullRequestAppends.map((append) => append.row.merge)).toEqual([null])
		expect(await recordedOwner()).toBe(observedSessionId)
	})

	test('an opened pull request no session observed takes the session its head commit trailer names', async () => {
		headCommitMessage = trailerNaming(observedSessionId)

		expect((await post(pullRequestBody('opened'), 'pull_request')).status).toBe(202)
		expect(await waitForGraphql(1)).toBe(1)
		await settle()

		expect(graphqlRequests).toHaveLength(1)
		expect(await recordedOwner()).toBe(observedSessionId)
	})

	test('a trailer naming a session never observed in the repository links nothing', async () => {
		headCommitMessage = trailerNaming(unobservedSessionId)

		expect((await post(pullRequestBody('opened'), 'pull_request')).status).toBe(202)
		expect(await waitForGraphql(1)).toBe(1)
		await settle()

		expect(await recordedOwner()).toBeNull()
	})

	test('a push refreshes the merge state the delivery cannot carry', async () => {
		await recordOpenPullRequest()

		expect((await post(pullRequestBody('synchronize'), 'pull_request')).status).toBe(202)
		expect(await waitForGraphql(1)).toBe(1)
		await settle()

		expect(graphqlRequests).toHaveLength(1)
		expect(pullRequestAppends.at(-1)?.row.merge).toMatchObject({ mergeStateStatus: 'CLEAN' })
	})

	test('arming auto-merge on GitHub refreshes too, but a closed pull request does not', async () => {
		expect((await post(pullRequestBody('auto_merge_enabled'), 'pull_request')).status).toBe(202)
		expect(await waitForGraphql(1)).toBe(1)
		await settle()
		graphqlRequests.length = 0

		expect((await post(pullRequestBody('synchronize', 'closed'), 'pull_request')).status).toBe(202)
		await settle()
		expect(graphqlRequests).toEqual([])
	})
})
