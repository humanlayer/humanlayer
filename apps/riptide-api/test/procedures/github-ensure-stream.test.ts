import { randomUUID } from 'node:crypto'

import { organizations } from '@humanlayer/db/tables/organizations'
import { pullRequests } from '@humanlayer/db/tables/pull-requests'
import { sessionRepositories } from '@humanlayer/db/tables/session-repositories'
import { sessions } from '@humanlayer/db/tables/sessions'
import { tasks } from '@humanlayer/db/tables/tasks'
import { call } from '@orpc/server'
import { and, eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { Effect, Layer } from 'effect'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { GitHubService } from '../../src/effects/services/github/github.service'
import { parseGitHubRemoteUrl } from '../../src/effects/services/github/repo-name'
import { PrStatusStream } from '../../src/effects/services/pr-status-stream/pr-status-stream.service'
import { ensurePullRequestStreamProcedure as liveEnsureStreamProcedure } from '../../src/orpc/api/integrations/github/pull-requests/ensure-stream.effect'
import { createMockApiAuth, createMockApiContext } from '../mocks'
import { bindProcedureToRuntime, createRuntimeWithTestPostgresLayer } from '../utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

const BRANCH = 'feat/pr-status'
const REMOTE_URL = 'git@github.com:HumanLayer/Syncopate.git'
const AGENTLAYER_REMOTE_URL = 'https://github.com/humanlayer/agentlayer.git'

const HEAD_SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'

const repositorySettings = {
	mergeCommitAllowed: true,
	squashMergeAllowed: true,
	rebaseMergeAllowed: true,
	viewerDefaultMergeMethod: 'MERGE' as const,
}

const wirePullRequest = {
	number: 2261,
	title: 'Show GitHub pull request status in the session sidebar',
	url: 'https://github.com/humanlayer/syncopate/pull/2261',
	state: 'OPEN' as const,
	isDraft: false,
	mergeable: 'MERGEABLE' as const,
	reviewDecision: 'REVIEW_REQUIRED' as const,
	headRefName: BRANCH,
	baseRefName: 'main',
	headRepository: { nameWithOwner: 'HumanLayer/Syncopate' },
	mergeStateStatus: 'BLOCKED' as const,
	autoMergeRequest: null,
	viewerCanEnableAutoMerge: false,
	viewerCanDisableAutoMerge: false,
	viewerCanUpdateBranch: false,
	mergeHeadline: 'Merge pull request #2261 from humanlayer/feat/pr-status',
	mergeBody: 'Show GitHub pull request status in the session sidebar',
	squashHeadline: 'Show GitHub pull request status in the session sidebar (#2261)',
	squashBody: '* Show GitHub pull request status in the session sidebar',
	reviewThreads: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] },
	latestReviews: { nodes: [] },
	commits: {
		totalCount: 1,
		nodes: [
			{
				commit: {
					oid: HEAD_SHA,
					message: '',
					statusCheckRollup: {
						contexts: {
							nodes: [
								{
									__typename: 'CheckRun' as const,
									name: 'typecheck',
									status: 'COMPLETED' as const,
									conclusion: 'FAILURE' as const,
									startedAt: '2026-08-30T09:00:00Z',
									completedAt: '2026-08-30T09:01:12Z',
									detailsUrl: 'https://github.com/humanlayer/syncopate/actions/runs/1/job/2',
								},
								{
									__typename: 'StatusContext' as const,
									context: 'ci/legacy',
									state: 'SUCCESS' as const,
									targetUrl: 'https://ci.example.test/build/9',
									createdAt: '2026-08-30T09:02:00Z',
								},
							],
						},
					},
				},
			},
		],
	},
}

describe('integrations.github.pullRequests.ensureStream', async () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let runtime: ReturnType<typeof createRuntimeWithTestPostgresLayer> | undefined
	let ensureStreamProcedure: typeof liveEnsureStreamProcedure
	let organizationId: string
	let otherOrganizationId: string

	const fetchCalls: { organizationId: string; repoFullName: string; branch: string }[] = []
	const createCalls: { repoFullName: string; branch: string }[] = []
	const hydrationAppends: { branch: string; rowId: string | null; checkRowIds: string[]; headShas: string[] }[] = []
	let streamExists = false
	let pullRequestExists = true

	const userId = 'user_ensure_stream'
	const hostId = randomUUID()

	beforeAll(async () => {
		const testDb = await createTestDb('github_ensure_stream')
		cleanupTestDb = testDb.cleanup
		db = testDb.db
		runtime = createRuntimeWithTestPostgresLayer(db, {
			github: Layer.succeed(GitHubService, {
				createInstallUrl: () => Effect.die('not used'),
				completeInstallation: () => Effect.die('not used'),
				listConnections: () => Effect.die('not used'),
				getConnection: () => Effect.die('not used'),
				listRepositories: () => Effect.die('not used'),
				getIssuePreview: () => Effect.die('not used'),
				prepareIssueImport: () => Effect.die('not used'),
				syncArtifactBacklink: () => Effect.die('not used'),
				refreshConnection: () => Effect.die('not used'),
				disconnect: () => Effect.die('not used'),
				mutatePullRequest: () => Effect.die('not used'),
				fetchPullRequest: (input) =>
					Effect.sync(() => {
						fetchCalls.push(input)
						return pullRequestExists
							? { wire: wirePullRequest, moreReviewThreads: [], repository: repositorySettings }
							: null
					}),
				verifyWebhook: () => Effect.die('not used'),
				handleWebhook: () => Effect.void,
			}),
			prStatusStream: Layer.succeed(PrStatusStream, {
				hydrate: (key, snapshot) =>
					Effect.sync(() => {
						if (!streamExists) createCalls.push({ repoFullName: key.repoFullName, branch: key.branch })
						if (snapshot.pullRequest === null) return
						hydrationAppends.push({
							branch: key.branch,
							rowId: snapshot.pullRequest.id,
							checkRowIds: snapshot.checks.map((row) => row.id),
							headShas: [snapshot.pullRequest.headSha, ...snapshot.checks.map((row) => row.headSha)],
						})
					}),
				publishChecks: () => Effect.die('publishChecks is not part of the hydration path'),
				publishPullRequest: () => Effect.die('publishPullRequest is not part of the hydration path'),
			}),
		})
		ensureStreamProcedure = bindProcedureToRuntime(liveEnsureStreamProcedure, runtime)

		const [org] = await db
			.insert(organizations)
			.values({ name: 'PR Panel Org', workos_organization_id: `workos-org-${randomUUID()}` })
			.returning()
		const [otherOrg] = await db
			.insert(organizations)
			.values({ name: 'Other Org', workos_organization_id: `workos-org-${randomUUID()}` })
			.returning()
		if (!org || !otherOrg) throw new Error('Unable to insert organizations for setup')
		organizationId = org.id
		otherOrganizationId = otherOrg.id
	}, 30000)

	afterAll(async () => {
		await runtime?.dispose()
		await cleanupTestDb?.()
	}, 30000)

	const createTask = async (ownerUserId: string = userId) => {
		const [task] = await db
			.insert(tasks)
			.values({
				organization_id: organizationId,
				resource_owner_user_id: ownerUserId,
				created_by: ownerUserId,
				name: 'PR panel task',
			})
			.returning()
		if (!task) throw new Error('Unable to insert task for setup')
		return task.id
	}

	const createSession = async (input: {
		readonly taskId?: string | null
		readonly workingDirectory?: string
		readonly ownerOrganizationId?: string
	}) => {
		const [session] = await db
			.insert(sessions)
			.values({
				organization_id: input.ownerOrganizationId ?? organizationId,
				resource_owner_user_id: userId,
				created_by: userId,
				host_id: hostId,
				title: 'pr panel session',
				working_directory: input.workingDirectory ?? '/repos/syncopate',
				coding_agent: 'claude',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissions_mode: 'default',
				status: 'running',
				task_id: input.taskId ?? null,
			})
			.returning()
		if (!session) throw new Error('Unable to insert session for setup')
		return session.id
	}

	/** One row of a daemon snapshot: what HEAD pointed at in that checkout, when it was last seen. */
	const observe = async (
		sessionId: string,
		input: {
			readonly localPath: string
			readonly remoteUrl?: string
			readonly branch?: string
			readonly isHead?: boolean
			readonly lastSeenAt?: bigint
		},
	) => {
		const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1)
		if (!session) throw new Error('Unable to read the session the observation belongs to')
		const lastSeenAt = input.lastSeenAt ?? BigInt(Date.now())
		await db.insert(sessionRepositories).values({
			organization_id: organizationId,
			session_id: sessionId,
			task_id: session.task_id,
			host_id: hostId,
			local_path: input.localPath,
			remote_url: input.remoteUrl ?? null,
			repo_full_name: input.remoteUrl ? parseGitHubRemoteUrl(input.remoteUrl) : null,
			branch: input.branch ?? null,
			is_head: input.isHead ?? true,
			first_seen_at: lastSeenAt,
			last_seen_at: lastSeenAt,
		})
	}

	const observedSession = async (taskId: string | null = null) => {
		const sessionId = await createSession({ taskId, workingDirectory: '/repos/syncopate' })
		await observe(sessionId, { localPath: '/repos/syncopate', remoteUrl: REMOTE_URL, branch: BRANCH })
		return sessionId
	}

	const context = (requestedOrganizationId = organizationId) =>
		createMockApiContext({
			auth: createMockApiAuth({
				organizationId: requestedOrganizationId,
				userId,
				role: 'member',
				roles: ['member'],
			}),
		})

	beforeEach(() => {
		streamExists = false
		pullRequestExists = true
		fetchCalls.length = 0
		createCalls.length = 0
		hydrationAppends.length = 0
	})

	test('resolves the observed repository and branch, and lowercases the repo name', async () => {
		const sessionId = await observedSession(await createTask())

		const result = await call(ensureStreamProcedure, { sessionId }, { context: context() })

		expect(result.repoFullName).toBe('humanlayer/syncopate')
		expect(result.branch).toBe(BRANCH)
		expect(result.hasPullRequest).toBe(true)
		expect(result.streamPath).toBe(
			`/organizations/${organizationId}/github/repos/humanlayer%2Fsyncopate/branches/feat%2Fpr-status/pr-status`,
		)
		expect(fetchCalls).toEqual([{ organizationId, repoFullName: 'humanlayer/syncopate', branch: BRANCH }])
		expect(hydrationAppends).toEqual([
			{
				branch: BRANCH,
				rowId: `humanlayer/syncopate:${BRANCH}`,
				checkRowIds: ['check_run:typecheck', 'status_context:ci/legacy'],
				headShas: [HEAD_SHA, HEAD_SHA, HEAD_SHA],
			},
		])
	})

	test('records the fetched pull request against the session that observed the branch, with no task', async () => {
		// Attribution fills once, so the row must not already belong to an earlier test's session.
		await db.delete(pullRequests).where(eq(pullRequests.organization_id, organizationId))
		const sessionId = await observedSession()

		await call(ensureStreamProcedure, { sessionId }, { context: context() })
		await call(ensureStreamProcedure, { sessionId }, { context: context() })

		const rows = await db
			.select()
			.from(pullRequests)
			.where(and(eq(pullRequests.organization_id, organizationId), eq(pullRequests.number, 2261)))
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({
			task_id: null,
			session_id: sessionId,
			resource_owner_user_id: userId,
			repo_full_name: 'humanlayer/syncopate',
			head_ref: BRANCH,
			base_ref: 'main',
			head_sha: HEAD_SHA,
			state: 'open',
			is_draft: false,
			mergeable: true,
			review_decision: 'REVIEW_REQUIRED',
			source: 'app',
		})
	})

	test('records the task of a session that has one', async () => {
		await db.delete(pullRequests).where(eq(pullRequests.organization_id, organizationId))
		const taskId = await createTask()
		const sessionId = await observedSession(taskId)

		await call(ensureStreamProcedure, { sessionId }, { context: context() })

		const rows = await db
			.select()
			.from(pullRequests)
			.where(and(eq(pullRequests.organization_id, organizationId), eq(pullRequests.number, 2261)))
		expect(rows[0]).toMatchObject({ task_id: taskId, session_id: sessionId })
	})

	test('resolves a recorded pull request by repository and branch when nobody observed it', async () => {
		const sessionId = await observedSession()
		await db.insert(pullRequests).values({
			organization_id: organizationId,
			task_id: null,
			session_id: sessionId,
			resource_owner_user_id: userId,
			repo_full_name: 'humanlayer/agentlayer',
			number: 41,
			url: 'https://github.com/humanlayer/agentlayer/pull/41',
			title: 'Captured from the CLI',
			state: 'open',
			head_ref: 'feat/from-the-cli',
			source: 'daemon',
		})

		const result = await call(
			ensureStreamProcedure,
			{ sessionId, repoFullName: 'humanlayer/agentlayer', branch: 'feat/from-the-cli' },
			{ context: context() },
		)

		expect(result.repoFullName).toBe('humanlayer/agentlayer')
		expect(result.branch).toBe('feat/from-the-cli')
		expect(fetchCalls).toEqual([
			{ organizationId, repoFullName: 'humanlayer/agentlayer', branch: 'feat/from-the-cli' },
		])
	})

	test('rejects a repository and branch the session neither observed nor recorded', async () => {
		const sessionId = await observedSession()

		await expect(
			call(
				ensureStreamProcedure,
				{ sessionId, repoFullName: 'humanlayer/agentlayer', branch: 'feat/nobody-observed' },
				{ context: context() },
			),
		).rejects.toMatchObject({ code: 'NOT_FOUND' })
		expect(fetchCalls).toEqual([])
	})

	test('reports an empty result as the pre-PR state and appends nothing', async () => {
		pullRequestExists = false
		const sessionId = await observedSession()

		const result = await call(ensureStreamProcedure, { sessionId }, { context: context() })

		expect(result.hasPullRequest).toBe(false)
		expect(fetchCalls).toHaveLength(1)
		expect(hydrationAppends).toEqual([])
	})

	test('re-hydrates an existing stream instead of returning its first state for ever', async () => {
		streamExists = true
		const sessionId = await observedSession()

		const result = await call(ensureStreamProcedure, { sessionId }, { context: context() })

		expect(result.hasPullRequest).toBe(true)
		expect(fetchCalls).toEqual([{ organizationId, repoFullName: 'humanlayer/syncopate', branch: BRANCH }])
		expect(hydrationAppends).toEqual([
			{
				branch: BRANCH,
				rowId: `humanlayer/syncopate:${BRANCH}`,
				checkRowIds: ['check_run:typecheck', 'status_context:ci/legacy'],
				headShas: [HEAD_SHA, HEAD_SHA, HEAD_SHA],
			},
		])
		expect(createCalls).toEqual([])
	})

	test('reports the pre-PR state truthfully for an existing stream', async () => {
		streamExists = true
		pullRequestExists = false
		const sessionId = await observedSession()

		const result = await call(ensureStreamProcedure, { sessionId }, { context: context() })

		expect(result.hasPullRequest).toBe(false)
		expect(hydrationAppends).toEqual([])
		expect(createCalls).toEqual([])
	})

	test('picks the current checkout containing the session working directory', async () => {
		const sessionId = await createSession({ workingDirectory: '/repos/agentlayer/apps/cli' })
		await observe(sessionId, { localPath: '/repos/syncopate', remoteUrl: REMOTE_URL, branch: BRANCH })
		await observe(sessionId, {
			localPath: '/repos/agentlayer',
			remoteUrl: AGENTLAYER_REMOTE_URL,
			branch: 'feat/other',
		})

		const result = await call(ensureStreamProcedure, { sessionId }, { context: context() })

		expect(result.repoFullName).toBe('humanlayer/agentlayer')
		expect(result.branch).toBe('feat/other')
	})

	test('prefers the current branch of a checkout over one it moved away from', async () => {
		const sessionId = await createSession({ workingDirectory: '/tmp/somewhere-else' })
		const now = BigInt(Date.now())
		await observe(sessionId, {
			localPath: '/repos/syncopate',
			remoteUrl: REMOTE_URL,
			branch: 'feat/moved-away-from',
			isHead: false,
			lastSeenAt: now,
		})
		await observe(sessionId, {
			localPath: '/repos/syncopate',
			remoteUrl: REMOTE_URL,
			branch: BRANCH,
			lastSeenAt: now - 60_000n,
		})

		const result = await call(ensureStreamProcedure, { sessionId }, { context: context() })

		expect(result.branch).toBe(BRANCH)
	})

	test('resolves the taskId form from the observations of the sessions of the task', async () => {
		const taskId = await createTask()
		await observedSession(taskId)

		const result = await call(ensureStreamProcedure, { taskId }, { context: context() })

		expect(result.repoFullName).toBe('humanlayer/syncopate')
		expect(result.branch).toBe(BRANCH)
	})

	test('rejects a task in the caller organization that the caller has no grant on', async () => {
		const taskId = await createTask('user_somebody_else')

		await expect(call(ensureStreamProcedure, { taskId }, { context: context() })).rejects.toMatchObject({
			code: 'NOT_FOUND',
		})
		expect(fetchCalls).toEqual([])
	})

	test('rejects a session in another organization as not found', async () => {
		const sessionId = await createSession({ ownerOrganizationId: otherOrganizationId })

		await expect(call(ensureStreamProcedure, { sessionId }, { context: context() })).rejects.toMatchObject({
			code: 'NOT_FOUND',
		})
	})

	test('rejects a session nobody has observed a repository for', async () => {
		const sessionId = await createSession({})

		await expect(call(ensureStreamProcedure, { sessionId }, { context: context() })).rejects.toMatchObject({
			code: 'NOT_FOUND',
		})
		expect(fetchCalls).toEqual([])
	})

	test('rejects a checkout whose remote is not on github.com', async () => {
		const sessionId = await createSession({ workingDirectory: '/repos/internal' })
		await observe(sessionId, {
			localPath: '/repos/internal',
			remoteUrl: 'git@gitlab.com:humanlayer/internal.git',
			branch: BRANCH,
		})

		await expect(call(ensureStreamProcedure, { sessionId }, { context: context() })).rejects.toMatchObject({
			code: 'NOT_FOUND',
		})
		expect(fetchCalls).toEqual([])
	})
})
