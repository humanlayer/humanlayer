import { randomUUID } from 'node:crypto'

import { githubIntegrationRepositories } from '@humanlayer/db/tables/github-integration-repositories'
import { githubIntegrations } from '@humanlayer/db/tables/github-integrations'
import { organizations } from '@humanlayer/db/tables/organizations'
import { pullRequests } from '@humanlayer/db/tables/pull-requests'
import { sessionRepositories } from '@humanlayer/db/tables/session-repositories'
import { sessions } from '@humanlayer/db/tables/sessions'
import { tasks } from '@humanlayer/db/tables/tasks'
import { call } from '@orpc/server'
import { eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { parseGitHubRemoteUrl } from '../../src/effects/services/github/repo-name'
import { listPullRequestBranchesProcedure as liveProcedure } from '../../src/orpc/api/integrations/github/pull-requests/list-branches.effect'
import { createMockApiAuth, createMockApiContext } from '../mocks'
import { bindProcedureToRuntime, createRuntimeWithTestPostgresLayer } from '../utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

const SYNCOPATE = 'git@github.com:HumanLayer/Syncopate.git'
const AGENTLAYER = 'https://github.com/humanlayer/agentlayer.git'
const DOCS = 'https://github.com/humanlayer/docs.git'
const GITLAB = 'git@gitlab.com:humanlayer/internal.git'

describe('integrations.github.pullRequests.listPullRequestBranches', async () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let runtime: ReturnType<typeof createRuntimeWithTestPostgresLayer> | undefined
	let listPullRequestBranches: typeof liveProcedure
	let organizationId: string
	let otherOrganizationId: string

	const userId = 'user_list_branches'
	const hostId = randomUUID()

	beforeAll(async () => {
		const testDb = await createTestDb('github_list_branches')
		cleanupTestDb = testDb.cleanup
		db = testDb.db
		runtime = createRuntimeWithTestPostgresLayer(db)
		listPullRequestBranches = bindProcedureToRuntime(liveProcedure, runtime)

		const [org] = await db
			.insert(organizations)
			.values({ name: 'List Targets Org', workos_organization_id: `workos-org-${randomUUID()}` })
			.returning()
		const [otherOrg] = await db
			.insert(organizations)
			.values({ name: 'Other Org', workos_organization_id: `workos-org-${randomUUID()}` })
			.returning()
		if (!org || !otherOrg) throw new Error('Unable to insert organizations for setup')
		organizationId = org.id
		otherOrganizationId = otherOrg.id

		const [integration] = await db
			.insert(githubIntegrations)
			.values({
				organization_id: organizationId,
				installation_id: `installation-${randomUUID()}`,
				account_id: `account-${randomUUID()}`,
				account_login: 'humanlayer',
				account_type: 'Organization',
				repository_selection: 'selected',
				permissions: { contents: 'read', pull_requests: 'read', checks: 'read', metadata: 'read' },
				installation_status: 'active',
				connected_by_user_id: userId,
				last_reconciled_at: BigInt(Date.now()),
			})
			.returning()
		if (!integration) throw new Error('Unable to insert integration for setup')
		for (const fullName of ['humanlayer/syncopate', 'humanlayer/agentlayer']) {
			const [owner, name] = fullName.split('/')
			await db.insert(githubIntegrationRepositories).values({
				integration_id: integration.id,
				github_repository_id: `repo-${randomUUID()}`,
				owner_login: owner ?? 'humanlayer',
				repository_name: name ?? fullName,
				full_name: fullName,
				private: true,
				default_branch: 'main',
			})
		}
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
				name: 'list branches task',
			})
			.returning()
		if (!task) throw new Error('Unable to insert task for setup')
		return task.id
	}

	const createSession = async (input: {
		readonly taskId?: string | null
		readonly workingDirectory?: string
		readonly ownerUserId?: string
	}) => {
		const [session] = await db
			.insert(sessions)
			.values({
				organization_id: organizationId,
				resource_owner_user_id: input.ownerUserId ?? userId,
				created_by: input.ownerUserId ?? userId,
				host_id: hostId,
				title: 'list branches session',
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

	let nextPullRequestNumber = 100

	const recordPullRequest = async (input: {
		readonly repoFullName: string
		readonly branch: string
		readonly taskId?: string | null
		readonly sessionId?: string | null
		readonly state?: 'open' | 'closed' | 'merged'
		readonly updatedAt?: bigint
	}) => {
		const number = nextPullRequestNumber++
		await db.insert(pullRequests).values({
			organization_id: organizationId,
			task_id: input.taskId ?? null,
			session_id: input.sessionId ?? null,
			resource_owner_user_id: userId,
			repo_full_name: input.repoFullName,
			number,
			url: `https://github.com/${input.repoFullName}/pull/${number}`,
			title: `PR ${number}`,
			state: input.state ?? 'open',
			head_ref: input.branch,
			base_ref: 'main',
			head_sha: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
			mergeable: true,
			review_decision: 'APPROVED',
			source: 'daemon',
			...(input.updatedAt !== undefined ? { updated_at: input.updatedAt } : {}),
		})
		return number
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

	test('lists the current checkouts first, the one holding the working directory ahead of them', async () => {
		const taskId = await createTask()
		const sessionId = await createSession({
			taskId,
			workingDirectory: '/repos/agentlayer/packages/core',
		})
		const now = BigInt(Date.now())
		await observe(sessionId, { localPath: '/repos/syncopate', remoteUrl: SYNCOPATE, branch: 'feat/pr-status' })
		await observe(sessionId, {
			localPath: '/repos/syncopate',
			remoteUrl: SYNCOPATE,
			branch: 'feat/earlier',
			isHead: false,
			lastSeenAt: now - 60_000n,
		})
		await observe(sessionId, { localPath: '/repos/agentlayer', remoteUrl: AGENTLAYER, branch: 'feat/tokens' })

		const result = await call(listPullRequestBranches, { sessionId }, { context: context() })

		expect(result.branches.map((branch) => [branch.repoFullName, branch.branch, branch.isCurrent])).toEqual([
			['humanlayer/agentlayer', 'feat/tokens', true],
			['humanlayer/syncopate', 'feat/pr-status', true],
			['humanlayer/syncopate', 'feat/earlier', false],
		])
	})

	test('lists a recorded pull request nobody observed after the observed branches, never as current', async () => {
		const taskId = await createTask()
		const sessionId = await createSession({ taskId })
		await observe(sessionId, { localPath: '/repos/syncopate', remoteUrl: SYNCOPATE, branch: 'feat/observed' })
		const recordedNumber = await recordPullRequest({
			repoFullName: 'humanlayer/agentlayer',
			branch: 'feat/from-the-cli',
			sessionId,
			taskId,
		})

		const result = await call(listPullRequestBranches, { sessionId }, { context: context() })

		expect(
			result.branches.map((branch) => [branch.branch, branch.isCurrent, branch.pullRequest?.number ?? null]),
		).toEqual([
			['feat/observed', true, null],
			['feat/from-the-cli', false, recordedNumber],
		])
	})

	test('drops the default branch and a checkout that is not on GitHub; lists an uncovered repository as not installed', async () => {
		const sessionId = await createSession({ taskId: await createTask() })
		await observe(sessionId, { localPath: '/repos/syncopate', remoteUrl: SYNCOPATE, branch: 'feat/pr-status' })
		await observe(sessionId, { localPath: '/repos/on-main', remoteUrl: AGENTLAYER, branch: 'main' })
		await observe(sessionId, { localPath: '/repos/docs', remoteUrl: DOCS, branch: 'feat/docs' })
		await observe(sessionId, { localPath: '/repos/docs-main', remoteUrl: DOCS, branch: 'main' })
		await observe(sessionId, { localPath: '/repos/docs-master', remoteUrl: DOCS, branch: 'master' })
		await observe(sessionId, { localPath: '/repos/internal', remoteUrl: GITLAB, branch: 'feat/internal' })
		await observe(sessionId, { localPath: '/repos/detached', remoteUrl: SYNCOPATE })

		const result = await call(listPullRequestBranches, { sessionId }, { context: context() })

		expect(result.branches.map((branch) => [branch.repoFullName, branch.branch, branch.installed])).toEqual([
			['humanlayer/syncopate', 'feat/pr-status', true],
			['humanlayer/docs', 'feat/docs', false],
		])
	})

	test('answers an empty list for a session with no task and nothing observed', async () => {
		const sessionId = await createSession({ taskId: null })

		expect((await call(listPullRequestBranches, { sessionId }, { context: context() })).branches).toEqual([])
	})

	test('lists the observed repositories of a session with no task, which owns them itself', async () => {
		const sessionId = await createSession({ taskId: null })
		await observe(sessionId, { localPath: '/repos/syncopate', remoteUrl: SYNCOPATE, branch: 'feat/no-task' })

		const result = await call(listPullRequestBranches, { sessionId }, { context: context() })

		expect(result.branches.map((branch) => [branch.repoFullName, branch.branch, branch.isCurrent])).toEqual([
			['humanlayer/syncopate', 'feat/no-task', true],
		])
	})

	test('rejects a task-less session somebody else owns', async () => {
		const sessionId = await createSession({ taskId: null, ownerUserId: 'user_somebody_else' })

		await expect(call(listPullRequestBranches, { sessionId }, { context: context() })).rejects.toMatchObject({
			code: 'NOT_FOUND',
		})
	})

	test('unions the observations of every session of the task for the taskId form', async () => {
		const taskId = await createTask()
		const older = await createSession({ taskId })
		const newer = await createSession({ taskId })
		const now = BigInt(Date.now())
		await observe(older, {
			localPath: '/repos/syncopate',
			remoteUrl: SYNCOPATE,
			branch: 'feat/first-session',
			lastSeenAt: now - 60_000n,
		})
		await observe(newer, {
			localPath: '/repos/agentlayer',
			remoteUrl: AGENTLAYER,
			branch: 'feat/second-session',
			lastSeenAt: now,
		})

		const result = await call(listPullRequestBranches, { taskId }, { context: context() })

		expect(result.branches.map((branch) => [branch.repoFullName, branch.branch, branch.isCurrent])).toEqual([
			['humanlayer/agentlayer', 'feat/second-session', true],
			['humanlayer/syncopate', 'feat/first-session', true],
		])
	})

	test('attaches any record on the branch, whatever task opened it, newest open one first', async () => {
		const sessionId = await createSession({ taskId: await createTask() })
		await observe(sessionId, { localPath: '/repos/syncopate', remoteUrl: SYNCOPATE, branch: 'feat/shared-branch' })
		const foreignTaskId = await createTask('user_somebody_else')
		const closedNumber = await recordPullRequest({
			repoFullName: 'humanlayer/syncopate',
			branch: 'feat/shared-branch',
			taskId: foreignTaskId,
			state: 'closed',
			updatedAt: BigInt(Date.now() + 60_000),
		})
		const openNumber = await recordPullRequest({
			repoFullName: 'humanlayer/syncopate',
			branch: 'feat/shared-branch',
			taskId: foreignTaskId,
		})

		const result = await call(listPullRequestBranches, { sessionId }, { context: context() })

		expect(result.branches).toEqual([
			{
				repoFullName: 'humanlayer/syncopate',
				branch: 'feat/shared-branch',
				isCurrent: true,
				installed: true,
				sessionIds: [sessionId],
				pullRequest: {
					id: 'humanlayer/syncopate:feat/shared-branch',
					number: openNumber,
					title: `PR ${openNumber}`,
					url: `https://github.com/humanlayer/syncopate/pull/${openNumber}`,
					state: 'open',
					isDraft: false,
					headRef: 'feat/shared-branch',
					baseRef: 'main',
					headSha: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
					mergeable: true,
					reviewDecision: 'APPROVED',
					unresolvedThreadCount: null,
					resolvedThreadCount: null,
					changesRequestedReviews: null,
					merge: null,
				},
				earlierPullRequests: [
					expect.objectContaining({ number: closedNumber, state: 'closed', headRef: 'feat/shared-branch' }),
				],
			},
		])
	})

	test('lists the pull requests a reused branch had before its current one, highest number first', async () => {
		const sessionId = await createSession({ taskId: await createTask() })
		await observe(sessionId, { localPath: '/repos/syncopate', remoteUrl: SYNCOPATE, branch: 'feat/reused' })
		const firstMerged = await recordPullRequest({
			repoFullName: 'humanlayer/syncopate',
			branch: 'feat/reused',
			sessionId,
			state: 'merged',
		})
		const secondMerged = await recordPullRequest({
			repoFullName: 'humanlayer/syncopate',
			branch: 'feat/reused',
			sessionId,
			state: 'merged',
		})
		const current = await recordPullRequest({
			repoFullName: 'humanlayer/syncopate',
			branch: 'feat/reused',
			sessionId,
		})

		const [branch] = (await call(listPullRequestBranches, { sessionId }, { context: context() })).branches

		expect(branch?.pullRequest?.number).toBe(current)
		expect(branch?.earlierPullRequests?.map((pullRequest) => [pullRequest.number, pullRequest.state])).toEqual([
			[secondMerged, 'merged'],
			[firstMerged, 'merged'],
		])
	})

	test('lists no earlier pull requests on a branch with one', async () => {
		const sessionId = await createSession({ taskId: await createTask() })
		await observe(sessionId, { localPath: '/repos/syncopate', remoteUrl: SYNCOPATE, branch: 'feat/single' })
		await recordPullRequest({
			repoFullName: 'humanlayer/syncopate',
			branch: 'feat/single',
			sessionId,
			state: 'merged',
		})

		const [branch] = (await call(listPullRequestBranches, { sessionId }, { context: context() })).branches

		expect(branch?.earlierPullRequests).toEqual([])
	})

	test('lists the whole task for a session of it, ranked by that session: current, seen by it, seen by others', async () => {
		const taskId = await createTask()
		const viewer = await createSession({ taskId })
		const sibling = await createSession({ taskId })
		const now = BigInt(Date.now())
		await observe(viewer, { localPath: '/repos/syncopate', remoteUrl: SYNCOPATE, branch: 'feat/viewer-now' })
		await observe(viewer, {
			localPath: '/repos/syncopate',
			remoteUrl: SYNCOPATE,
			branch: 'feat/viewer-before',
			isHead: false,
			lastSeenAt: now - 120_000n,
		})
		await observe(sibling, {
			localPath: '/repos/agentlayer',
			remoteUrl: AGENTLAYER,
			branch: 'feat/sibling-now',
			lastSeenAt: now - 60_000n,
		})
		await observe(sibling, {
			localPath: '/repos/syncopate',
			remoteUrl: SYNCOPATE,
			branch: 'feat/viewer-before',
			isHead: false,
			lastSeenAt: now - 30_000n,
		})
		const recordedNumber = await recordPullRequest({
			repoFullName: 'humanlayer/agentlayer',
			branch: 'feat/sibling-cli',
			sessionId: sibling,
			taskId,
		})

		const result = await call(listPullRequestBranches, { sessionId: viewer }, { context: context() })

		expect(
			result.branches.map((branch) => [
				branch.branch,
				branch.isCurrent,
				branch.sessionIds,
				branch.pullRequest?.number ?? null,
			]),
		).toEqual([
			['feat/viewer-now', true, [viewer], null],
			['feat/viewer-before', false, [sibling, viewer], null],
			['feat/sibling-now', false, [sibling], null],
			['feat/sibling-cli', false, [sibling], recordedNumber],
		])

		const forSibling = await call(listPullRequestBranches, { sessionId: sibling }, { context: context() })

		expect(forSibling.branches.map((branch) => [branch.branch, branch.isCurrent])).toEqual([
			['feat/sibling-now', true],
			['feat/viewer-before', false],
			['feat/viewer-now', false],
			['feat/sibling-cli', false],
		])
	})

	test('keeps a task-less session to its own observations and records', async () => {
		const taskId = await createTask()
		const inTask = await createSession({ taskId })
		const alone = await createSession({ taskId: null })
		await observe(inTask, { localPath: '/repos/syncopate', remoteUrl: SYNCOPATE, branch: 'feat/in-task' })
		await observe(alone, { localPath: '/repos/agentlayer', remoteUrl: AGENTLAYER, branch: 'feat/alone' })

		const result = await call(listPullRequestBranches, { sessionId: alone }, { context: context() })

		expect(result.branches.map((branch) => [branch.branch, branch.sessionIds])).toEqual([['feat/alone', [alone]]])
	})

	test('rejects a session in another organization and a task the caller has no grant on', async () => {
		const taskId = await createTask()
		const sessionId = await createSession({ taskId })
		const foreignTask = await createTask('user_somebody_else')

		await expect(
			call(listPullRequestBranches, { sessionId }, { context: context(otherOrganizationId) }),
		).rejects.toMatchObject({ code: 'NOT_FOUND' })
		await expect(
			call(listPullRequestBranches, { taskId: foreignTask }, { context: context() }),
		).rejects.toMatchObject({
			code: 'NOT_FOUND',
		})
	})
})
