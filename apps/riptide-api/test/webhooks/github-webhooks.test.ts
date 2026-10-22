import { randomUUID } from 'node:crypto'

import { githubIntegrationRepositories } from '@humanlayer/db/tables/github-integration-repositories'
import { githubIntegrations } from '@humanlayer/db/tables/github-integrations'
import { organizations } from '@humanlayer/db/tables/organizations'
import { pullRequests } from '@humanlayer/db/tables/pull-requests'
import { sessionRepositories } from '@humanlayer/db/tables/session-repositories'
import { sessions } from '@humanlayer/db/tables/sessions'
import { tasks } from '@humanlayer/db/tables/tasks'
import type { CheckRowType, PullRequestRowType } from '@humanlayer/streams/pr-status'
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
import { createTestDb } from '../utils/test-db'

const WEBHOOK_SECRET = 'webhook-secret'
const INSTALLATION_ID = '90071992547409931234'
const INVALID_SIGNATURE_INSTALLATION_ID = '90071992547409931238'
const FAILED_RECONCILIATION_INSTALLATION_ID = '90071992547409931239'
// A number literal above MAX_SAFE_INTEGER would round, so build the raw body as a string.
const installationBody = (action: string, installationId = INSTALLATION_ID) =>
	`{"action":"${action}","installation":{"id":${installationId},"account":{"id":1,"login":"acme","type":"Organization"}},"sender":{"id":2,"login":"octocat","type":"User"}}`

const CHECKS_INSTALLATION_ID = '90071992547409935678'
const WATCHED_REPO = 'humanlayer/syncopate'
const WATCHED_BRANCH = 'feat/pr-status'

/**
 * A `check_run` delivery, built as a raw string like `installationBody` above: the installation id
 * is above `MAX_SAFE_INTEGER`, so `JSON.stringify` of a number literal would round it and the
 * signature would then cover a body GitHub never sent.
 */
const CHECK_HEAD_SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'

const checkRunBody = (input: {
	readonly branch: string | null
	readonly name?: string
	readonly status?: string
	readonly conclusion?: string | null
	readonly repoFullName?: string
}) => {
	const headBranch = input.branch === null ? 'null' : `"${input.branch}"`
	// A running check has no conclusion and no end, which GitHub sends as JSON nulls rather than
	// as the strings `"null"` a naive builder would produce.
	const conclusion =
		input.conclusion === undefined ? '"failure"' : input.conclusion === null ? 'null' : `"${input.conclusion}"`
	const completedAt = input.conclusion === null ? 'null' : '"2026-08-30T09:01:12Z"'
	return (
		`{"action":"completed","installation":{"id":${CHECKS_INSTALLATION_ID}},` +
		`"repository":{"full_name":"${input.repoFullName ?? 'HumanLayer/Syncopate'}"},` +
		`"check_run":{"name":"${input.name ?? 'typecheck'}","head_sha":"${CHECK_HEAD_SHA}",` +
		`"status":"${input.status ?? 'completed'}",` +
		`"conclusion":${conclusion},` +
		`"details_url":"https://github.com/humanlayer/syncopate/actions/runs/1/job/2",` +
		`"started_at":"2026-08-30T09:00:00Z","completed_at":${completedAt},` +
		`"check_suite":{"id":42,"head_branch":${headBranch}}}}`
	)
}

const LINKED_BRANCH = 'feat/linked-by-observation'
const LINKED_REPO_REMOTE = 'git@github.com:HumanLayer/Syncopate.git'
const LINKED_OWNER_USER_ID = 'user_linked_session_owner'

/** A `pull_request` delivery for the watched repository, as a raw string for the same reason. */
const pullRequestBody = (input: {
	readonly action?: string
	readonly number?: number
	readonly branch?: string
	readonly state?: 'open' | 'closed'
	readonly merged?: boolean
	readonly draft?: boolean
	readonly mergeable?: boolean | null
	readonly installationId?: string
	readonly title?: string
	readonly headRepo?: string
}) =>
	`{"action":"${input.action ?? 'opened'}","installation":{"id":${input.installationId ?? CHECKS_INSTALLATION_ID}},` +
	`"repository":{"full_name":"HumanLayer/Syncopate"},` +
	`"pull_request":{"number":${input.number ?? 2261},"title":"${input.title ?? 'Show status'}",` +
	`"html_url":"https://github.com/humanlayer/syncopate/pull/${input.number ?? 2261}",` +
	`"state":"${input.state ?? 'open'}","draft":${input.draft ?? false},"merged":${input.merged ?? false},` +
	`"mergeable":${input.mergeable === undefined ? 'null' : String(input.mergeable)},` +
	`"head":{"ref":"${input.branch ?? WATCHED_BRANCH}","sha":"${CHECK_HEAD_SHA}","repo":{"full_name":"${input.headRepo ?? 'HumanLayer/Syncopate'}"}},` +
	`"base":{"ref":"main"},` +
	`"user":{"login":"octocat","id":583231,"type":"User"},` +
	`"created_at":"2026-08-30T09:00:00Z",` +
	`"merged_at":${input.merged ? '"2026-08-31T10:00:00Z"' : 'null'},` +
	`"closed_at":${input.state === 'closed' ? '"2026-08-31T10:00:00Z"' : 'null'},` +
	`"merged_by":${input.merged ? '{"login":"reviewer","id":1}' : 'null'}}}`

const panelQueryResponse = (input: {
	readonly branch: string
	readonly reviewDecision: string | null
	readonly mergeStateStatus?: string
}) =>
	JSON.stringify({
		data: {
			repository: {
				mergeCommitAllowed: true,
				squashMergeAllowed: true,
				rebaseMergeAllowed: true,
				viewerDefaultMergeMethod: 'MERGE',
				pullRequests: {
					nodes: [
						{
							number: 2261,
							title: 'Show status (from GitHub)',
							url: 'https://github.com/humanlayer/syncopate/pull/2261',
							state: 'OPEN',
							isDraft: false,
							mergeable: 'MERGEABLE',
							reviewDecision: input.reviewDecision,
							headRefName: input.branch,
							baseRefName: 'main',
							headRepository: { nameWithOwner: 'HumanLayer/Syncopate' },
							reviewThreads: {
								pageInfo: { hasNextPage: false, endCursor: null },
								nodes: [{ isResolved: false }, { isResolved: true }, { isResolved: false }],
							},
							latestReviews: {
								nodes: [
									{
										state: 'CHANGES_REQUESTED',
										body: 'Split the service and delete the wrapper.',
										submittedAt: '2026-09-01T10:00:00Z',
										url: 'https://github.com/humanlayer/syncopate/pull/2261#pullrequestreview-1',
										author: { login: 'reviewer' },
									},
									{
										state: 'COMMENTED',
										body: 'nit',
										submittedAt: '2026-09-01T11:00:00Z',
										url: 'https://github.com/humanlayer/syncopate/pull/2261#pullrequestreview-2',
										author: null,
									},
								],
							},
							mergeStateStatus: input.mergeStateStatus ?? 'CLEAN',
							autoMergeRequest: null,
							viewerCanEnableAutoMerge: false,
							viewerCanDisableAutoMerge: false,
							viewerCanUpdateBranch: false,
							mergeHeadline: 'Merge pull request #2261',
							mergeBody: 'Show status (from GitHub)',
							squashHeadline: 'Show status (from GitHub) (#2261)',
							squashBody: '* Show status (from GitHub)',
							commits: {
								totalCount: 1,
								nodes: [{ commit: { oid: CHECK_HEAD_SHA, message: '', statusCheckRollup: null } }],
							},
						},
					],
				},
			},
		},
	})

describe('GitHub webhook route', () => {
	let cleanupTestDatabase: (() => Promise<void>) | undefined
	let database: PostgresJsDatabase
	let runtime: ReturnType<typeof createRuntimeWithTestPostgresLayer>
	let app: Hono
	let organizationId: string
	let linkedTaskId: string
	let linkedSessionId: string
	/** Every request the service makes to GitHub. The check arm must add none. */
	const githubRequests: string[] = []
	const checkAppends: {
		organizationId: string
		repoFullName: string
		branch: string
		rows: CheckRowType[]
	}[] = []
	const pullRequestAppends: { organizationId: string; branch: string; row: PullRequestRowType }[] = []

	beforeAll(async () => {
		const testDatabase = await createTestDb('github_webhook_route')
		cleanupTestDatabase = testDatabase.cleanup
		database = testDatabase.db
		const [organization] = await database
			.insert(organizations)
			.values({ name: 'GitHub webhook org', workos_organization_id: `workos-${randomUUID()}` })
			.returning()
		if (!organization) throw new Error('Unable to insert the organization for setup')
		organizationId = organization.id
		const [integration] = await database
			.insert(githubIntegrations)
			.values({
				organization_id: organizationId,
				installation_id: CHECKS_INSTALLATION_ID,
				account_id: '4242',
				account_login: 'humanlayer',
				account_type: 'Organization',
				repository_selection: 'selected',
				permissions: { metadata: 'read', pull_requests: 'read', checks: 'read', statuses: 'read' },
				installation_status: 'active',
				connected_by_user_id: 'user_webhook_checks',
				last_reconciled_at: BigInt(Date.now()),
			})
			.returning({ id: githubIntegrations.id })
		if (!integration) throw new Error('Unable to insert the integration for setup')
		await database.insert(githubIntegrationRepositories).values({
			integration_id: integration.id,
			github_repository_id: 'repo-syncopate',
			owner_login: 'humanlayer',
			repository_name: 'syncopate',
			full_name: 'humanlayer/syncopate',
			private: true,
			default_branch: 'main',
		})
		const [linkedTask] = await database
			.insert(tasks)
			.values({
				organization_id: organizationId,
				resource_owner_user_id: LINKED_OWNER_USER_ID,
				created_by: LINKED_OWNER_USER_ID,
				name: 'linked by an observed checkout',
			})
			.returning({ id: tasks.id })
		if (!linkedTask) throw new Error('Unable to insert the linked task for setup')
		linkedTaskId = linkedTask.id
		const linkedHostId = randomUUID()
		const [linkedSession] = await database
			.insert(sessions)
			.values({
				organization_id: organizationId,
				resource_owner_user_id: LINKED_OWNER_USER_ID,
				created_by: LINKED_OWNER_USER_ID,
				host_id: linkedHostId,
				title: 'linked session',
				working_directory: '/workspaces/linked/syncopate',
				coding_agent: 'claude',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissions_mode: 'default',
				status: 'running',
				task_id: linkedTaskId,
			})
			.returning({ id: sessions.id })
		if (!linkedSession) throw new Error('Unable to insert the linked session for setup')
		linkedSessionId = linkedSession.id
		await database.insert(sessionRepositories).values({
			organization_id: organizationId,
			session_id: linkedSessionId,
			task_id: linkedTaskId,
			host_id: linkedHostId,
			local_path: '/workspaces/linked/syncopate',
			remote_url: LINKED_REPO_REMOTE,
			repo_full_name: 'humanlayer/syncopate',
			branch: LINKED_BRANCH,
			is_head: true,
		})
		const generatedKeyPair = await generateKeyPair('RS256', { extractable: true })
		const privateKey = await exportPKCS8(generatedKeyPair.privateKey)
		const configuration = ConfigProvider.layer(
			ConfigProvider.fromUnknown({
				GITHUB_APP_ID: '123',
				CLOUD_ORIGIN: 'https://cloud.example.test',
				GITHUB_APP_CLIENT_ID: 'Iv1.webhook-route',
				GITHUB_APP_SLUG: 'humanlayer-test',
				GITHUB_APP_PRIVATE_KEY: privateKey,
				GITHUB_APP_WEBHOOK_SECRET: WEBHOOK_SECRET,
				GITHUB_API_BASE_URL: 'https://api.github.test',
			}),
		)
		const transport = Layer.succeed(
			HttpClient.HttpClient,
			HttpClient.make((request, url) =>
				Effect.sync(() => {
					githubRequests.push(`${request.method} ${url.pathname}`)
					const installationMatch = url.pathname.match(/^\/app\/installations\/(\d+)$/)
					if (request.method === 'GET' && installationMatch) {
						if (installationMatch[1] === FAILED_RECONCILIATION_INSTALLATION_ID)
							return rawJsonResponse(request, '{"message":"Not Found"}', 404)
						return rawJsonResponse(
							request,
							`{"id":${installationMatch[1]},"account":{"id":90071992547409931235,"login":"humanlayer","type":"Organization"},"repository_selection":"selected","permissions":{"issues":"write","metadata":"read"}}`,
						)
					}
					if (request.method === 'POST' && /\/access_tokens$/.test(url.pathname)) {
						return rawJsonResponse(request, '{"token":"ghs-route","expires_at":"2030-01-01T00:00:00Z"}')
					}
					if (request.method === 'GET' && url.pathname === '/installation/repositories') {
						return rawJsonResponse(request, '{"total_count":0,"repositories":[]}')
					}
					if (request.method === 'POST' && url.pathname === '/graphql') {
						return rawJsonResponse(
							request,
							panelQueryResponse({ branch: WATCHED_BRANCH, reviewDecision: 'APPROVED' }),
						)
					}
					return rawJsonResponse(request, '{"message":"Not Found"}', 404)
				}),
			),
		)
		const githubLayer = GitHubServiceLive.pipe(
			Layer.provide(Layer.mergeAll(PostgresDbLive(database), configuration, transport)),
			Layer.orDie,
		)
		runtime = createRuntimeWithTestPostgresLayer(database, {
			github: githubLayer,
			httpClient: transport,
			prStatusStream: Layer.succeed(PrStatusStream, {
				hydrate: () => Effect.die('hydrate is not part of the check webhook arm'),
				publishChecks: (key, rows) =>
					Effect.sync(() => {
						checkAppends.push({
							organizationId: key.organizationId,
							repoFullName: key.repoFullName,
							branch: key.branch,
							rows: [...rows],
						})
					}),
				publishPullRequest: (key, row) =>
					Effect.sync(() => {
						pullRequestAppends.push({ organizationId: key.organizationId, branch: key.branch, row })
					}),
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

	const post = (body: string, headers: Record<string, string>) =>
		app.request('http://localhost/webhooks/github', { method: 'POST', headers, body })

	const signed = (body: string, event: string) => ({
		'X-Hub-Signature-256': computeGitHubSignature({ webhookSecret: WEBHOOK_SECRET, rawBody: body }),
		'X-GitHub-Event': event,
		'X-GitHub-Delivery': randomUUID(),
	})

	test('acknowledges a correctly signed installation event with 202', async () => {
		const body = installationBody('created')
		const response = await post(body, signed(body, 'installation'))
		expect(response.status).toBe(202)
	})

	test('acknowledges a safely-ignored event type with 202', async () => {
		const body = '{"action":"opened","issue":{"number":1}}'
		const response = await post(body, signed(body, 'issues'))
		expect(response.status).toBe(202)
	})

	test('rejects an invalid signature with 401 and does not invoke reconciliation', async () => {
		const body = installationBody('created', INVALID_SIGNATURE_INSTALLATION_ID)
		const response = await post(body, {
			'X-Hub-Signature-256': 'sha256=deadbeef',
			'X-GitHub-Event': 'installation',
			'X-GitHub-Delivery': randomUUID(),
		})
		expect(response.status).toBe(401)
		// Verify-before-ACK: no reconciliation is forked for an unauthenticated delivery.
		const rows = await database
			.select()
			.from(githubIntegrations)
			.where(eq(githubIntegrations.installation_id, INVALID_SIGNATURE_INSTALLATION_ID))
		expect(rows).toEqual([])
	})

	test('rejects a missing signature header with 401', async () => {
		const body = installationBody('created')
		const response = await post(body, { 'X-GitHub-Event': 'installation', 'X-GitHub-Delivery': randomUUID() })
		expect(response.status).toBe(401)
	})

	test('maps an authentic but malformed payload to 400', async () => {
		const body = '{"action":"created","installation":{"account":{}}}'
		const response = await post(body, signed(body, 'installation'))
		expect(response.status).toBe(400)
	})

	// `handleWebhook` is forked after the 202, so an append lands a moment after the response.
	const waitForCheckAppends = async (expected: number) => {
		const deadline = Date.now() + 5_000
		while (checkAppends.length < expected && Date.now() < deadline) {
			await new Promise((resolve) => setTimeout(resolve, 10))
		}
		return checkAppends.length
	}

	/** Long enough for a fork that was going to append to have appended. */
	const settle = () => new Promise((resolve) => setTimeout(resolve, 250))

	// The installation tests fork their handler too, so a plain reset in `beforeEach` races the
	// previous test's late requests.
	const drainGithubRequests = async () => {
		const deadline = Date.now() + 5_000
		let previous = -1
		while (previous !== githubRequests.length && Date.now() < deadline) {
			previous = githubRequests.length
			await new Promise((resolve) => setTimeout(resolve, 100))
		}
		githubRequests.length = 0
	}

	describe('check_run deliveries', () => {
		beforeEach(async () => {
			await drainGithubRequests()
			checkAppends.length = 0
		})

		test('publishes one row for the branch and makes no GitHub request at all', async () => {
			const body = checkRunBody({ branch: WATCHED_BRANCH })

			expect((await post(body, signed(body, 'check_run'))).status).toBe(202)
			expect(await waitForCheckAppends(1)).toBe(1)

			expect(checkAppends[0]).toEqual({
				organizationId,
				repoFullName: WATCHED_REPO,
				branch: WATCHED_BRANCH,
				rows: [
					{
						id: 'check_run:typecheck',
						name: 'typecheck',
						headSha: CHECK_HEAD_SHA,
						status: 'COMPLETED',
						conclusion: 'FAILURE',
						detailsUrl: 'https://github.com/humanlayer/syncopate/actions/runs/1/job/2',
						startedAt: '2026-08-30T09:00:00Z',
						completedAt: '2026-08-30T09:01:12Z',
					},
				],
			})
			expect(githubRequests).toEqual([])
		})

		test('leaves the watched-or-not question to the stream: any branch is published, never fetched', async () => {
			const body = checkRunBody({ branch: 'feat/nobody-is-looking' })

			expect((await post(body, signed(body, 'check_run'))).status).toBe(202)
			expect(await waitForCheckAppends(1)).toBe(1)

			expect(checkAppends[0]?.branch).toBe('feat/nobody-is-looking')
			expect(githubRequests).toEqual([])
		})

		test('drops a fork pull request, whose head branch is null, rather than inventing a key', async () => {
			const body = checkRunBody({ branch: null })

			expect((await post(body, signed(body, 'check_run'))).status).toBe(202)
			await settle()

			expect(checkAppends).toEqual([])
		})

		test('drops a conclusion it does not model, and keeps acknowledging', async () => {
			const body = checkRunBody({ branch: WATCHED_BRANCH, conclusion: 'quantum_undecided' })

			expect((await post(body, signed(body, 'check_run'))).status).toBe(202)
			await settle()

			expect(checkAppends).toEqual([])
		})

		test('carries a still-running check through as a row with no conclusion', async () => {
			const body = checkRunBody({
				branch: WATCHED_BRANCH,
				name: 'build / native',
				status: 'in_progress',
				conclusion: null,
			})

			expect((await post(body, signed(body, 'check_run'))).status).toBe(202)
			expect(await waitForCheckAppends(1)).toBe(1)
			expect(checkAppends[0]?.rows).toEqual([
				{
					id: 'check_run:build / native',
					name: 'build / native',
					headSha: CHECK_HEAD_SHA,
					status: 'IN_PROGRESS',
					conclusion: null,
					detailsUrl: 'https://github.com/humanlayer/syncopate/actions/runs/1/job/2',
					startedAt: '2026-08-30T09:00:00Z',
					completedAt: null,
				},
			])
		})

		test('rejects an unsigned check delivery with 401 and never reaches the stream', async () => {
			const body = checkRunBody({ branch: WATCHED_BRANCH })

			const response = await post(body, {
				'X-Hub-Signature-256': 'sha256=deadbeef',
				'X-GitHub-Event': 'check_run',
				'X-GitHub-Delivery': randomUUID(),
			})

			expect(response.status).toBe(401)
			await settle()
			expect(checkAppends).toEqual([])
		})

		test('maps an authentic check delivery with a missing check_run to 400', async () => {
			const body = `{"action":"completed","installation":{"id":${CHECKS_INSTALLATION_ID}},"repository":{"full_name":"HumanLayer/Syncopate"}}`
			expect((await post(body, signed(body, 'check_run'))).status).toBe(400)
		})

		test('acknowledges a check_suite delivery without writing anything', async () => {
			const body = `{"action":"completed","installation":{"id":${CHECKS_INSTALLATION_ID}},"repository":{"full_name":"HumanLayer/Syncopate"},"check_suite":{"head_branch":"${WATCHED_BRANCH}","status":"completed","conclusion":"failure"}}`

			expect((await post(body, signed(body, 'check_suite'))).status).toBe(202)
			await settle()
			expect(checkAppends).toEqual([])
		})
	})

	describe('pull_request deliveries', () => {
		const waitForPullRequestAppends = async (expected: number) => {
			const deadline = Date.now() + 5_000
			while (pullRequestAppends.length < expected && Date.now() < deadline) {
				await new Promise((resolve) => setTimeout(resolve, 10))
			}
			return pullRequestAppends.length
		}

		const recordedRows = (number: number) =>
			database
				.select()
				.from(pullRequests)
				.where(and(eq(pullRequests.organization_id, organizationId), eq(pullRequests.number, number)))

		beforeEach(async () => {
			await drainGithubRequests()
			pullRequestAppends.length = 0
		})

		test('records an opened pull request against the session that observed the branch, with no GitHub request', async () => {
			const body = pullRequestBody({ branch: LINKED_BRANCH, number: 3001, mergeable: true })

			expect((await post(body, signed(body, 'pull_request'))).status).toBe(202)
			expect(await waitForPullRequestAppends(1)).toBe(1)

			const [row] = await recordedRows(3001)
			expect(row).toMatchObject({
				task_id: linkedTaskId,
				session_id: linkedSessionId,
				resource_owner_user_id: LINKED_OWNER_USER_ID,
				repo_full_name: 'humanlayer/syncopate',
				head_ref: LINKED_BRANCH,
				head_sha: CHECK_HEAD_SHA,
				state: 'open',
				is_draft: false,
				mergeable: true,
				review_decision: null,
				author_github_login: 'octocat',
				author_github_id: '583231',
				source: 'webhook',
			})
			expect(row?.opened_at).toBe(BigInt(Date.parse('2026-08-30T09:00:00Z')))
			expect(pullRequestAppends[0]).toEqual({
				organizationId,
				branch: LINKED_BRANCH,
				row: expect.objectContaining({ number: 3001, state: 'open', mergeable: true }),
			})
			expect(githubRequests).toEqual([])
		})

		test('keeps what earlier sources knew when a delivery does not carry it', async () => {
			await database.insert(pullRequests).values({
				organization_id: organizationId,
				task_id: linkedTaskId,
				session_id: null,
				resource_owner_user_id: 'user_from_the_daemon',
				repo_full_name: 'humanlayer/syncopate',
				number: 3002,
				url: 'https://github.com/humanlayer/syncopate/pull/3002',
				title: 'Captured by the daemon',
				state: 'open',
				head_ref: LINKED_BRANCH,
				mergeable: true,
				review_decision: 'APPROVED',
				source: 'daemon',
			})
			const body = pullRequestBody({
				branch: LINKED_BRANCH,
				number: 3002,
				action: 'synchronize',
				title: 'Renamed',
			})

			expect((await post(body, signed(body, 'pull_request'))).status).toBe(202)
			expect(await waitForPullRequestAppends(1)).toBe(1)

			const [row] = await recordedRows(3002)
			// The row had no attribution tier, so the session observed on the branch now owns it.
			expect(row).toMatchObject({
				title: 'Renamed',
				mergeable: true,
				review_decision: 'APPROVED',
				resource_owner_user_id: LINKED_OWNER_USER_ID,
				attribution_method: 'observed',
				source: 'webhook',
			})
			expect(pullRequestAppends[0]?.row).toMatchObject({
				title: 'Renamed',
				mergeable: true,
				reviewDecision: 'APPROVED',
			})
		})

		test('records a merge as merged with its time and merger, and a branch no task owns without a task', async () => {
			const body = pullRequestBody({
				branch: 'feat/nobody-owns-this',
				number: 3003,
				action: 'closed',
				state: 'closed',
				merged: true,
			})

			expect((await post(body, signed(body, 'pull_request'))).status).toBe(202)
			expect(await waitForPullRequestAppends(1)).toBe(1)

			const [row] = await recordedRows(3003)
			expect(row).toMatchObject({
				task_id: null,
				state: 'merged',
				merged_by_github_login: 'reviewer',
			})
			expect(row?.merged_at).toBe(BigInt(Date.parse('2026-08-31T10:00:00Z')))
			expect(pullRequestAppends[0]?.row.state).toBe('merged')
		})

		test('keeps a merge when a re-delivered pre-merge snapshot arrives after it', async () => {
			const merged = pullRequestBody({
				branch: 'feat/out-of-order',
				number: 3009,
				action: 'closed',
				state: 'closed',
				merged: true,
			})
			expect((await post(merged, signed(merged, 'pull_request'))).status).toBe(202)
			expect(await waitForPullRequestAppends(1)).toBe(1)

			// GitHub does not order deliveries and retries them, so the open snapshot can land last.
			const reopened = pullRequestBody({ branch: 'feat/out-of-order', number: 3009, action: 'synchronize' })
			expect((await post(reopened, signed(reopened, 'pull_request'))).status).toBe(202)
			expect(await waitForPullRequestAppends(2)).toBe(2)

			const [row] = await recordedRows(3009)
			expect(row).toMatchObject({ state: 'merged', merged_by_github_login: 'reviewer' })
			expect(row?.merged_at).toBe(BigInt(Date.parse('2026-08-31T10:00:00Z')))
		})

		test('drops a fork pull request whose branch shares its name with one the session observed', async () => {
			const body = pullRequestBody({ branch: LINKED_BRANCH, number: 3005, headRepo: 'someone-else/syncopate' })

			expect((await post(body, signed(body, 'pull_request'))).status).toBe(202)
			await settle()

			expect(await recordedRows(3005)).toEqual([])
			expect(pullRequestAppends).toEqual([])
			expect(githubRequests).toEqual([])
		})

		test('drops a delivery for an installation nobody connected', async () => {
			const body = pullRequestBody({ number: 3004, installationId: '90071992547409939999' })

			expect((await post(body, signed(body, 'pull_request'))).status).toBe(202)
			await settle()

			expect(await recordedRows(3004)).toEqual([])
			expect(pullRequestAppends).toEqual([])
		})

		test('refetches the branch once after a review and records the decision GitHub reports', async () => {
			const body =
				`{"action":"submitted","installation":{"id":${CHECKS_INSTALLATION_ID}},"repository":{"full_name":"HumanLayer/Syncopate"},` +
				`"review":{"state":"approved"},"pull_request":{"number":2261,"head":{"ref":"${WATCHED_BRANCH}","repo":{"full_name":"HumanLayer/Syncopate"}}}}`

			expect((await post(body, signed(body, 'pull_request_review'))).status).toBe(202)
			expect(await waitForPullRequestAppends(1)).toBe(1)

			const [row] = await recordedRows(2261)
			expect(row).toMatchObject({
				title: 'Show status (from GitHub)',
				review_decision: 'APPROVED',
				mergeable: true,
				source: 'app',
				unresolved_thread_count: 2,
				resolved_thread_count: 1,
				changes_requested_reviews: [
					{
						login: 'reviewer',
						body: 'Split the service and delete the wrapper.',
						submittedAt: '2026-09-01T10:00:00Z',
						url: 'https://github.com/humanlayer/syncopate/pull/2261#pullrequestreview-1',
					},
				],
			})
			expect(pullRequestAppends[0]?.row).toMatchObject({
				reviewDecision: 'APPROVED',
				unresolvedThreadCount: 2,
				resolvedThreadCount: 1,
			})
			expect(githubRequests.filter((line) => line.endsWith('/graphql'))).toHaveLength(1)
		})

		test.each(['pull_request_review_comment', 'pull_request_review_thread'])(
			'refetches the branch once after a %s delivery, which carries none of what it changes',
			async (event) => {
				const body =
					`{"action":"resolved","installation":{"id":${CHECKS_INSTALLATION_ID}},"repository":{"full_name":"HumanLayer/Syncopate"},` +
					`"pull_request":{"number":2261,"head":{"ref":"${WATCHED_BRANCH}","repo":{"full_name":"HumanLayer/Syncopate"}}}}`

				expect((await post(body, signed(body, event))).status).toBe(202)
				expect(await waitForPullRequestAppends(1)).toBe(1)

				expect(pullRequestAppends[0]?.row).toMatchObject({ unresolvedThreadCount: 2, resolvedThreadCount: 1 })
				expect(githubRequests.filter((line) => line.endsWith('/graphql'))).toHaveLength(1)
			},
		)

		test('leaves a review comment on a fork pull request alone', async () => {
			const body =
				`{"action":"created","installation":{"id":${CHECKS_INSTALLATION_ID}},"repository":{"full_name":"HumanLayer/Syncopate"},` +
				`"pull_request":{"number":2261,"head":{"ref":"${WATCHED_BRANCH}","repo":{"full_name":"stranger/syncopate"}}}}`

			expect((await post(body, signed(body, 'pull_request_review_comment'))).status).toBe(202)
			await drainGithubRequests()

			expect(pullRequestAppends).toEqual([])
			expect(githubRequests.filter((line) => line.endsWith('/graphql'))).toHaveLength(0)
		})

		test('maps an authentic pull_request delivery with no pull request to 400', async () => {
			const body = `{"action":"opened","installation":{"id":${CHECKS_INSTALLATION_ID}},"repository":{"full_name":"HumanLayer/Syncopate"}}`
			expect((await post(body, signed(body, 'pull_request'))).status).toBe(400)
		})
	})

	test('still acknowledges (202) when the forked handler fails internally', async () => {
		const body = installationBody('created', FAILED_RECONCILIATION_INSTALLATION_ID)
		const response = await post(body, signed(body, 'installation'))
		// The total `Effect<void, never>` handler absorbs its own failure, so the ACK is immune.
		expect(response.status).toBe(202)
	})
})

const rawJsonResponse = (request: HttpClientRequest, body: string, status = 200) =>
	HttpClientResponse.fromWeb(request, new Response(body, { status, headers: { 'content-type': 'application/json' } }))
