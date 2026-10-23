import { randomUUID } from 'node:crypto'

import { organizations } from '@humanlayer/db/tables/organizations'
import { pullRequests } from '@humanlayer/db/tables/pull-requests'
import { sessionRepositories } from '@humanlayer/db/tables/session-repositories'
import { sessions } from '@humanlayer/db/tables/sessions'
import { tasks } from '@humanlayer/db/tables/tasks'
import type { PullRequestMutation } from '@humanlayer/riptide-api-contract/api/integrations/github/pull-requests/mutate'
import type { PullRequestRowType } from '@humanlayer/streams/pr-status'
import { call } from '@orpc/server'
import { and, eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { Effect, Layer } from 'effect'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import {
	GitHubMissingPermissionsError,
	GitHubPullRequestMutationRejectedError,
	GitHubRepositoryNotAccessibleError,
} from '../../src/effects/services/github/github.errors'
import { GitHubService } from '../../src/effects/services/github/github.service'
import type { GitHubPullRequestWire } from '../../src/effects/services/github/pull-requests/github-api'
import {
	PrStatusStream,
	PrStatusStreamAppendError,
} from '../../src/effects/services/pr-status-stream/pr-status-stream.service'
import { mutatePullRequestProcedure as liveMutateProcedure } from '../../src/orpc/api/integrations/github/pull-requests/mutate.effect'
import { createMockApiAuth, createMockApiContext } from '../mocks'
import { bindProcedureToRuntime, createRuntimeWithTestPostgresLayer } from '../utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

const REPO = 'humanlayer/syncopate'
const BRANCH = 'feat/merge-row'
const HEAD_SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'
const USER_ID = 'user_merge_row'

const wireAfter = (input: { state: GitHubPullRequestWire['state']; isDraft?: boolean }): GitHubPullRequestWire => ({
	number: 2489,
	title: 'Add the tray',
	url: 'https://github.com/humanlayer/syncopate/pull/2489',
	state: input.state,
	isDraft: input.isDraft ?? false,
	mergeable: 'MERGEABLE',
	reviewDecision: 'APPROVED',
	headRefName: BRANCH,
	baseRefName: 'main',
	headRepository: { nameWithOwner: 'HumanLayer/Syncopate' },
	reviewThreads: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] },
	latestReviews: { nodes: [] },
	mergeStateStatus: input.state === 'OPEN' ? 'CLEAN' : 'UNKNOWN',
	autoMergeRequest: null,
	viewerCanEnableAutoMerge: false,
	viewerCanDisableAutoMerge: false,
	viewerCanUpdateBranch: false,
	mergeHeadline: 'Merge pull request #2489',
	mergeBody: 'Add the tray',
	squashHeadline: 'Add the tray (#2489)',
	squashBody: '* Add the tray',
	commits: { totalCount: 1, nodes: [{ commit: { oid: HEAD_SHA, message: '', statusCheckRollup: null } }] },
})

const repositorySettings = {
	mergeCommitAllowed: true,
	squashMergeAllowed: true,
	rebaseMergeAllowed: true,
	viewerDefaultMergeMethod: 'MERGE' as const,
}

describe('integrations.github.pullRequests.mutate', () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let runtime: ReturnType<typeof createRuntimeWithTestPostgresLayer> | undefined
	let mutateProcedure: typeof liveMutateProcedure
	let organizationId: string
	let taskId: string
	let sessionId: string

	const mutations: { organizationId: string; number: number; mutation: PullRequestMutation }[] = []
	const published: { branch: string; row: PullRequestRowType }[] = []
	/** What the fake GitHub does for the next write: succeed with a state, or fail. */
	let outcome:
		| { state: GitHubPullRequestWire['state']; isDraft?: boolean }
		| 'rejected'
		| 'forbidden'
		| 'stale_read'
		| 'gone' = {
		state: 'MERGED',
	}
	let streamGone = false

	beforeAll(async () => {
		const testDb = await createTestDb('github_mutate_pull_request')
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
				fetchPullRequest: () => Effect.die('not used'),
				verifyWebhook: () => Effect.die('not used'),
				handleWebhook: () => Effect.void,
				mutatePullRequest: (input) => {
					mutations.push({
						organizationId: input.organizationId,
						number: input.number,
						mutation: input.mutation,
					})
					if (outcome === 'rejected') {
						return Effect.fail(
							new GitHubPullRequestMutationRejectedError({
								mutation: input.mutation.type,
								message: 'Head branch was modified. Review and try the merge again.',
							}),
						)
					}
					if (outcome === 'forbidden') {
						return Effect.fail(
							new GitHubMissingPermissionsError({
								missing: [
									{
										capability: 'writePullRequests',
										requiredPermission: 'pull_requests',
										requiredLevel: 'write',
										grantedLevel: 'read',
									},
								],
								detectedBy: 'installation_grant',
							}),
						)
					}
					// The write landed and the read that confirms it was refused: the stored grant is stale.
					if (outcome === 'stale_read') {
						return Effect.fail(
							new GitHubMissingPermissionsError({
								missing: [
									{
										capability: 'readChecks',
										requiredPermission: 'checks',
										requiredLevel: 'read',
										grantedLevel: 'read',
									},
								],
								detectedBy: 'github_refusal',
							}),
						)
					}
					if (outcome === 'gone') {
						return Effect.fail(new GitHubRepositoryNotAccessibleError({ repositoryId: input.repoFullName }))
					}
					return Effect.succeed({
						wire: wireAfter(outcome),
						moreReviewThreads: [],
						repository: repositorySettings,
					})
				},
			}),
			prStatusStream: Layer.succeed(PrStatusStream, {
				hydrate: () => Effect.die('not used'),
				publishChecks: () => Effect.die('not used'),
				publishPullRequest: (key, row) =>
					streamGone
						? Effect.fail(new PrStatusStreamAppendError({ message: 'stream gone', cause: null }))
						: Effect.sync(() => void published.push({ branch: key.branch, row })),
			}),
		})
		mutateProcedure = bindProcedureToRuntime(liveMutateProcedure, runtime)

		const [org] = await db
			.insert(organizations)
			.values({ name: 'Merge row org', workos_organization_id: `workos-org-${randomUUID()}` })
			.returning()
		if (!org) throw new Error('Unable to insert the organization for setup')
		organizationId = org.id

		const [task] = await db
			.insert(tasks)
			.values({
				organization_id: organizationId,
				resource_owner_user_id: USER_ID,
				created_by: USER_ID,
				name: 'merge row task',
			})
			.returning({ id: tasks.id })
		if (!task) throw new Error('Unable to insert the task for setup')
		taskId = task.id
		const [session] = await db
			.insert(sessions)
			.values({
				organization_id: organizationId,
				resource_owner_user_id: USER_ID,
				created_by: USER_ID,
				host_id: randomUUID(),
				title: 'merge row session',
				working_directory: '/repos/syncopate',
				coding_agent: 'claude',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissions_mode: 'default',
				status: 'running',
				task_id: taskId,
			})
			.returning({ id: sessions.id })
		if (!session) throw new Error('Unable to insert the session for setup')
		sessionId = session.id
		await db.insert(sessionRepositories).values({
			organization_id: organizationId,
			session_id: sessionId,
			task_id: taskId,
			host_id: randomUUID(),
			local_path: '/repos/syncopate',
			remote_url: 'git@github.com:HumanLayer/Syncopate.git',
			repo_full_name: REPO,
			branch: BRANCH,
			is_head: true,
			first_seen_at: BigInt(Date.now()),
			last_seen_at: BigInt(Date.now()),
		})
	}, 30_000)

	afterAll(async () => {
		await runtime?.dispose()
		await cleanupTestDb?.()
	}, 30_000)

	beforeEach(async () => {
		mutations.length = 0
		published.length = 0
		outcome = { state: 'MERGED' }
		streamGone = false
		await db.delete(pullRequests).where(eq(pullRequests.organization_id, organizationId))
	})

	const context = (userId: string = USER_ID) =>
		createMockApiContext({
			auth: createMockApiAuth({ organizationId, userId, role: 'member', roles: ['member'] }),
		})

	const input = (mutation: PullRequestMutation) => ({
		sessionId,
		repoFullName: REPO,
		branch: BRANCH,
		number: 2489,
		mutation,
	})

	const recorded = () =>
		db
			.select()
			.from(pullRequests)
			.where(and(eq(pullRequests.organization_id, organizationId), eq(pullRequests.number, 2489)))

	test('writes as the App, records GitHub’s answer, publishes it, and returns it', async () => {
		const merge: PullRequestMutation = {
			type: 'merge',
			method: 'SQUASH',
			expectedHeadSha: HEAD_SHA,
			commitHeadline: 'Add the tray (#2489)',
		}

		const result = await call(mutateProcedure, input(merge), { context: context() })

		expect(mutations).toEqual([{ organizationId, number: 2489, mutation: merge }])
		expect(result.pullRequest).toMatchObject({ number: 2489, state: 'merged', headRef: BRANCH })
		expect(result.pullRequest.merge).toMatchObject({
			mergeStateStatus: 'UNKNOWN',
			viewerDefaultMergeMethod: 'MERGE',
		})
		expect(published).toEqual([{ branch: BRANCH, row: result.pullRequest }])
		const [row] = await recorded()
		expect(row).toMatchObject({ state: 'merged', source: 'app', repo_full_name: REPO })
		expect(row?.merge_state).toMatchObject({ mergeStateStatus: 'UNKNOWN' })
	})

	test('a draft flipped to ready comes back open and not draft', async () => {
		outcome = { state: 'OPEN', isDraft: false }

		const result = await call(mutateProcedure, input({ type: 'ready_for_review' }), { context: context() })

		expect(result.pullRequest).toMatchObject({ state: 'open', isDraft: false })
		expect(result.pullRequest.merge).toMatchObject({ mergeStateStatus: 'CLEAN' })
	})

	test('a stream nobody is watching does not turn a write that happened into a failure', async () => {
		streamGone = true
		outcome = { state: 'CLOSED' }

		const result = await call(mutateProcedure, input({ type: 'close' }), { context: context() })

		expect(result.pullRequest.state).toBe('closed')
		expect(await recorded()).toHaveLength(1)
	})

	test('hands GitHub’s reason back as a bad request, and records nothing', async () => {
		outcome = 'rejected'

		await expect(
			call(mutateProcedure, input({ type: 'merge', method: 'MERGE', expectedHeadSha: HEAD_SHA }), {
				context: context(),
			}),
		).rejects.toMatchObject({
			code: 'BAD_REQUEST',
			data: { message: 'Head branch was modified. Review and try the merge again.' },
		})
		expect(published).toEqual([])
		expect(await recorded()).toEqual([])
	})

	test('names the missing write grant with the marker the tab reads', async () => {
		outcome = 'forbidden'

		await expect(call(mutateProcedure, input({ type: 'close' }), { context: context() })).rejects.toMatchObject({
			code: 'BAD_REQUEST',
			data: { message: 'github_pull_requests_write_permission_required' },
		})
	})

	test('names the stale read grant, not the write grant, when only the confirming read was refused', async () => {
		outcome = 'stale_read'

		await expect(call(mutateProcedure, input({ type: 'close' }), { context: context() })).rejects.toMatchObject({
			code: 'BAD_REQUEST',
			data: { message: 'github_checks_permission_required' },
		})
	})

	test('a repository no installation covers is not found', async () => {
		outcome = 'gone'

		await expect(call(mutateProcedure, input({ type: 'close' }), { context: context() })).rejects.toMatchObject({
			code: 'NOT_FOUND',
		})
	})

	test('refuses a branch the caller’s session was never on, before any write', async () => {
		await expect(
			call(
				mutateProcedure,
				{ ...input({ type: 'close' }), branch: 'somebody-elses-branch' },
				{ context: context() },
			),
		).rejects.toMatchObject({ code: 'NOT_FOUND', data: { message: 'repo_not_observed' } })
		expect(mutations).toEqual([])
	})

	test('refuses a member with no grant on the task, so the App’s wider access is not borrowed', async () => {
		await expect(
			call(mutateProcedure, { ...input({ type: 'close' }), taskId, sessionId: undefined } as never, {
				context: context('user_somebody_else'),
			}),
		).rejects.toMatchObject({ code: 'NOT_FOUND' })
		expect(mutations).toEqual([])
	})
})
