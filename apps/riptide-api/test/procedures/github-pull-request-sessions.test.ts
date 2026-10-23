import { randomUUID } from 'node:crypto'

import { describe, it } from '@effect/vitest'
import { commits } from '@humanlayer/db/tables/commits'
import { organizations } from '@humanlayer/db/tables/organizations'
import { pullRequestSessions } from '@humanlayer/db/tables/pull-request-sessions'
import { pullRequests } from '@humanlayer/db/tables/pull-requests'
import { sessionRepositories } from '@humanlayer/db/tables/session-repositories'
import { sessions } from '@humanlayer/db/tables/sessions'
import { tasks } from '@humanlayer/db/tables/tasks'
import type { PullRequestRowType } from '@humanlayer/streams/pr-status'
import { and, asc, eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { Effect } from 'effect'
import { TestClock } from 'effect/testing'
import { afterAll, beforeAll, expect } from 'vitest'

import { pullRequestRowId } from '../../src/effects/services/github/pull-requests/github-api'
import { recordPullRequest } from '../../src/effects/services/github/pull-requests/persistence'
import { type PostgresDb, PostgresDbLive } from '../../src/effects/services/postgres/postgres-db.service'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

const REPO = 'humanlayer/syncopate'
const REMOTE = 'git@github.com:HumanLayer/Syncopate.git'
const OWNER = 'user_link_owner'
const HEAD_SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'
const MINUTE = 60 * 1000
const DAY = 24 * 60 * MINUTE
/** Every fixture time is measured from here, and the test clock is pinned to it. */
const NOW = 1_750_000_000_000

const rowFor = (input: {
	readonly branch: string
	readonly number: number
	readonly headSha?: string
}): PullRequestRowType => ({
	id: pullRequestRowId({ repoFullName: REPO, branch: input.branch }),
	number: input.number,
	title: `PR ${input.number}`,
	url: `https://github.com/${REPO}/pull/${input.number}`,
	state: 'open',
	isDraft: false,
	headRef: input.branch,
	baseRef: 'main',
	headSha: input.headSha ?? HEAD_SHA,
	mergeable: true,
	reviewDecision: null,
	unresolvedThreadCount: null,
	resolvedThreadCount: null,
	changesRequestedReviews: null,
	merge: null,
})

describe('linking sessions to a recorded pull request', () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let organizationId: string
	const hostId = randomUUID()

	beforeAll(async () => {
		const testDb = await createTestDb('github_pull_request_sessions')
		cleanupTestDb = testDb.cleanup
		db = testDb.db
		const [org] = await db
			.insert(organizations)
			.values({ name: 'Link Org', workos_organization_id: `workos-org-${randomUUID()}` })
			.returning()
		if (!org) throw new Error('Unable to insert organization for setup')
		organizationId = org.id
	}, 30_000)

	afterAll(async () => {
		await cleanupTestDb?.()
	}, 30_000)

	const createTask = () =>
		Effect.promise(async () => {
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					created_by: OWNER,
					resource_owner_user_id: OWNER,
					name: 'linked task',
				})
				.returning({ id: tasks.id })
			if (!task) throw new Error('Unable to insert task for setup')
			return task.id
		})

	const createSession = (input?: { readonly taskId: string | null }) =>
		Effect.promise(async () => {
			const [session] = await db
				.insert(sessions)
				.values({
					organization_id: organizationId,
					resource_owner_user_id: OWNER,
					created_by: OWNER,
					host_id: hostId,
					title: 'linked session',
					working_directory: '/workspaces/syncopate',
					coding_agent: 'claude',
					provider: 'anthropic',
					model: 'claude-sonnet-4-5',
					permissions_mode: 'default',
					status: 'running',
					task_id: input?.taskId ?? null,
				})
				.returning({ id: sessions.id })
			if (!session) throw new Error('Unable to insert session for setup')
			return session.id
		})

	/** The daemon's checkout report: the session has the branch checked out. */
	const observeBranch = (input: {
		readonly sessionId: string
		readonly branch: string
		readonly taskId?: string | null
		readonly lastSeenAt?: number
		readonly localPath?: string
	}) =>
		Effect.promise(() =>
			db.insert(sessionRepositories).values({
				organization_id: organizationId,
				session_id: input.sessionId,
				task_id: input.taskId ?? null,
				host_id: hostId,
				local_path: input.localPath ?? `/workspaces/${input.sessionId}`,
				remote_url: REMOTE,
				repo_full_name: REPO,
				branch: input.branch,
				is_head: false,
				last_seen_at: BigInt(input.lastSeenAt ?? NOW),
			}),
		)

	/** The commit ledger's record that the session committed on the branch. */
	const commitOnBranch = (input: {
		readonly sessionId: string
		readonly branch: string
		readonly at?: number
		readonly sha?: string
	}) =>
		Effect.promise(async () => {
			const [row] = await db
				.insert(commits)
				.values({
					organization_id: organizationId,
					session_id: input.sessionId,
					resource_owner_user_id: OWNER,
					repo_full_name: REPO,
					branch: input.branch,
					commit_sha: input.sha ?? `sha-${randomUUID()}`,
					subject: 'work on the branch',
					committed_at: BigInt(input.at ?? NOW),
					additions: 1,
					deletions: 0,
					files_changed: 1,
					capture_algorithm_version: 1,
				})
				.returning({ id: commits.id })
			if (!row) throw new Error('Unable to insert commit for setup')
			return row.id
		})

	/** What a delivery does: record the row and let the head branch say who it belongs to. */
	const record = (input: {
		readonly branch: string
		readonly number: number
		readonly headSha?: string
		readonly owner?: {
			readonly sessionId: string | null
			readonly taskId: string | null
			readonly resourceOwnerUserId: string | null
		}
	}) =>
		recordPullRequest({
			organizationId,
			repoFullName: REPO,
			row: rowFor(input),
			source: 'webhook',
			owner: input.owner,
		})

	const recordedPullRequest = (number: number) =>
		Effect.promise(async () => {
			const [row] = await db
				.select()
				.from(pullRequests)
				.where(and(eq(pullRequests.organization_id, organizationId), eq(pullRequests.number, number)))
			return row
		})

	const linkedSessions = (number: number) =>
		Effect.promise(() =>
			db
				.select()
				.from(pullRequestSessions)
				.where(
					and(
						eq(pullRequestSessions.organization_id, organizationId),
						eq(pullRequestSessions.number, number),
					),
				)
				.orderBy(asc(pullRequestSessions.linked_at), asc(pullRequestSessions.id)),
		)

	const atPinnedTime = <A, E>(program: Effect.Effect<A, E, never>) =>
		TestClock.setTime(NOW).pipe(Effect.andThen(program))

	const withDb = <A, E>(program: Effect.Effect<A, E, PostgresDb>) =>
		atPinnedTime(program.pipe(Effect.provide(PostgresDbLive(db))))

	it.effect('links a session that committed on the branch as committed and credits it with the pull request', () =>
		withDb(
			Effect.gen(function* () {
				const sessionId = yield* createSession()
				const branch = 'feat/committed'
				yield* observeBranch({ sessionId, branch })
				yield* commitOnBranch({ sessionId, branch })

				const recorded = yield* record({ branch, number: 101 })
				expect(recorded.attributionMethod).toBe('committed')

				expect(yield* recordedPullRequest(101)).toMatchObject({
					session_id: sessionId,
					resource_owner_user_id: OWNER,
					attribution_method: 'committed',
				})
				expect(yield* linkedSessions(101)).toMatchObject([
					{ session_id: sessionId, user_id: OWNER, tier: 'committed' },
				])
			}),
		),
	)

	it.effect('links every session on the branch at its own tier and keeps the strongest on the pull request', () =>
		withDb(
			Effect.gen(function* () {
				const committer = yield* createSession()
				const observer = yield* createSession()
				const branch = 'feat/two-sessions'
				// The committer is the OLDER observation: the pull request must still follow the
				// strongest tier, not whoever had the branch checked out last.
				yield* observeBranch({ sessionId: committer, branch, lastSeenAt: NOW - 2 * MINUTE })
				yield* commitOnBranch({ sessionId: committer, branch, at: NOW - 2 * MINUTE })
				yield* observeBranch({ sessionId: observer, branch, lastSeenAt: NOW - MINUTE })

				yield* record({ branch, number: 102 })

				expect(yield* recordedPullRequest(102)).toMatchObject({
					session_id: committer,
					attribution_method: 'committed',
				})
				const tiers = new Map((yield* linkedSessions(102)).map((row) => [row.session_id, row.tier]))
				expect(tiers).toEqual(
					new Map([
						[committer, 'committed'],
						[observer, 'observed'],
					]),
				)
			}),
		),
	)

	it.effect('advances a tier and never walks it back when the evidence disappears', () =>
		withDb(
			Effect.gen(function* () {
				const sessionId = yield* createSession()
				const branch = 'feat/advance-only'
				yield* observeBranch({ sessionId, branch })

				yield* record({ branch, number: 103 })
				expect(yield* recordedPullRequest(103)).toMatchObject({ attribution_method: 'observed' })

				const commitId = yield* commitOnBranch({ sessionId, branch })
				yield* record({ branch, number: 103 })
				expect(yield* recordedPullRequest(103)).toMatchObject({ attribution_method: 'committed' })

				yield* Effect.promise(() => db.delete(commits).where(eq(commits.id, commitId)))
				yield* record({ branch, number: 103 })
				expect(yield* recordedPullRequest(103)).toMatchObject({ attribution_method: 'committed' })
				expect(yield* linkedSessions(103)).toMatchObject([{ session_id: sessionId, tier: 'committed' }])
			}),
		),
	)

	it.effect('keeps the task the pull request already had when a taskless session takes the credit', () =>
		withDb(
			Effect.gen(function* () {
				const taskId = yield* createTask()
				const taskless = yield* createSession()
				const branch = 'feat/keeps-the-task'
				yield* observeBranch({ sessionId: taskless, branch })

				yield* record({ branch, number: 107, owner: { sessionId: null, taskId, resourceOwnerUserId: OWNER } })
				expect(yield* recordedPullRequest(107)).toMatchObject({
					task_id: taskId,
					attribution_method: 'observed',
				})

				yield* commitOnBranch({ sessionId: taskless, branch })
				yield* record({ branch, number: 107 })

				expect(yield* recordedPullRequest(107)).toMatchObject({
					task_id: taskId,
					session_id: taskless,
					attribution_method: 'committed',
				})
			}),
		),
	)

	it.effect('keeps the session a row already named against one that only checked the branch out', () =>
		withDb(
			Effect.gen(function* () {
				const author = yield* createSession()
				const reviewer = yield* createSession()
				const branch = 'feat/legacy-row'
				yield* Effect.promise(() =>
					db.insert(pullRequests).values({
						organization_id: organizationId,
						session_id: author,
						resource_owner_user_id: OWNER,
						repo_full_name: REPO,
						number: 104,
						url: `https://github.com/${REPO}/pull/104`,
						title: 'captured before tiers existed',
						state: 'open',
						head_ref: branch,
						source: 'daemon',
					}),
				)
				yield* observeBranch({ sessionId: reviewer, branch })

				yield* record({ branch, number: 104 })

				expect(yield* recordedPullRequest(104)).toMatchObject({
					session_id: author,
					attribution_method: 'observed',
				})
				expect(yield* linkedSessions(104)).toMatchObject([{ session_id: reviewer, tier: 'observed' }])
			}),
		),
	)

	it.effect('links a session with the branch in two checkouts once, at its strongest evidence', () =>
		withDb(
			Effect.gen(function* () {
				const sessionId = yield* createSession()
				const branch = 'feat/two-checkouts'
				yield* observeBranch({ sessionId, branch, localPath: '/repo', lastSeenAt: NOW })
				yield* observeBranch({
					sessionId,
					branch,
					localPath: '/repo/.worktrees/x',
					lastSeenAt: NOW - MINUTE,
				})
				yield* commitOnBranch({ sessionId, branch, at: NOW - MINUTE })

				yield* record({ branch, number: 105 })

				expect(yield* recordedPullRequest(105)).toMatchObject({
					session_id: sessionId,
					attribution_method: 'committed',
				})
				expect(yield* linkedSessions(105)).toMatchObject([{ session_id: sessionId, tier: 'committed' }])
			}),
		),
	)

	/**
	 * A subagent working in its own `git worktree` inherits the session env, so its commits carry
	 * the session trailer and land in the ledger, but the checkout observer only probes the
	 * session's workspace, so the branch it pushes is never in session_repositories. The ledger
	 * stamps those commits with the branch the workspace surfaced them on, which is the stacked
	 * integration branch, not the head branch of the pull request the subagent opens.
	 */
	it.effect('links a session whose subagent pushed a stacked branch from a worktree the observer never saw', () =>
		withDb(
			Effect.gen(function* () {
				const taskId = yield* createTask()
				const sessionId = yield* createSession({ taskId })
				const workspace = '/workspaces/syncopate'
				const observedBranch = 'github-attention-branches-installed'
				const integrationBranch = 'github-attention-screenshots'
				const worktreeBranch = 'github-attention-tab-skeleton'
				const worktreeHeadSha = 'aeec13ed0000000000000000000000000000abcd'
				yield* observeBranch({
					sessionId,
					taskId,
					branch: observedBranch,
					localPath: workspace,
					lastSeenAt: NOW - 2 * MINUTE,
				})
				yield* observeBranch({
					sessionId,
					taskId,
					branch: integrationBranch,
					localPath: workspace,
					lastSeenAt: NOW - MINUTE,
				})
				yield* commitOnBranch({ sessionId, branch: integrationBranch, sha: worktreeHeadSha, at: NOW - MINUTE })

				const recorded = yield* record({ branch: worktreeBranch, number: 108, headSha: worktreeHeadSha })
				expect(recorded.attributionMethod).toBe('committed')

				expect(yield* recordedPullRequest(108)).toMatchObject({
					session_id: sessionId,
					task_id: taskId,
					resource_owner_user_id: OWNER,
					attribution_method: 'committed',
				})
				expect(yield* linkedSessions(108)).toMatchObject([
					{ session_id: sessionId, task_id: taskId, user_id: OWNER, tier: 'committed' },
				])
			}),
		),
	)

	it.effect('does not link a session that last saw the branch over 30 days ago', () =>
		withDb(
			Effect.gen(function* () {
				const sessionId = yield* createSession()
				const branch = 'feat/stale-observation'
				yield* observeBranch({ sessionId, branch, lastSeenAt: NOW - 31 * DAY })
				yield* commitOnBranch({ sessionId, branch, at: NOW - 31 * DAY })

				yield* record({ branch, number: 106 })

				expect(yield* recordedPullRequest(106)).toMatchObject({ session_id: null, attribution_method: null })
				expect(yield* linkedSessions(106)).toEqual([])
			}),
		),
	)
})
