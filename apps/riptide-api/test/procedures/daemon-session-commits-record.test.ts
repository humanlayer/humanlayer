import { randomBytes, randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'

import { commits } from '@humanlayer/db/tables/commits'
import { organizations } from '@humanlayer/db/tables/organizations'
import { sessions } from '@humanlayer/db/tables/sessions'
import { taskUserAcl } from '@humanlayer/db/tables/task-user-acl'
import { tasks } from '@humanlayer/db/tables/tasks'
import { call } from '@orpc/server'
import { asc, eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { recordCommitsProcedure as liveRecordCommitsProcedure } from '../../src/orpc/daemon/sessions/commits/record.effect'
import { createMockDaemonAuth, createMockDaemonContext } from '../mocks'
import { bindProcedureToRuntime, createRuntimeWithTestPostgresLayer } from '../utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('daemon/sessions/commits/record', async () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let effectRuntime: ReturnType<typeof createRuntimeWithTestPostgresLayer> | undefined
	let recordCommitsProcedure: typeof liveRecordCommitsProcedure
	let organizationId: string
	const userId = 'user_daemon_commits_record'
	const hostId = randomUUID()

	beforeAll(async () => {
		const testDb = await createTestDb('daemon_session_commits_record')
		cleanupTestDb = testDb.cleanup
		db = testDb.db
		effectRuntime = createRuntimeWithTestPostgresLayer(db)
		recordCommitsProcedure = bindProcedureToRuntime(liveRecordCommitsProcedure, effectRuntime)

		const [org] = await db
			.insert(organizations)
			.values({ name: 'Commits Record Org', workos_organization_id: `workos-org-${randomUUID()}` })
			.returning()

		if (!org) throw new Error('Unable to insert organization for setup')
		organizationId = org.id
	}, 30000)

	afterAll(async () => {
		await effectRuntime?.dispose()
		await cleanupTestDb?.()
	}, 30000)

	const createSession = async (overrides: Partial<typeof sessions.$inferInsert> = {}) => {
		const [session] = await db
			.insert(sessions)
			.values({
				organization_id: organizationId,
				resource_owner_user_id: userId,
				created_by: userId,
				host_id: hostId,
				title: 'commits record session',
				working_directory: tmpdir(),
				coding_agent: 'claude',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissions_mode: 'default',
				status: 'running',
				...overrides,
			})
			.returning()

		if (!session) throw new Error('Unable to insert session for setup')
		return session
	}

	const createDaemonContext = (authOverrides: Partial<{ hostId: string; organizationId: string }> = {}) => ({
		context: createMockDaemonContext({
			auth: createMockDaemonAuth({
				userId,
				organizationId: authOverrides.organizationId ?? organizationId,
				hostId: authOverrides.hostId ?? hostId,
			}),
			services: {
				db,
				dbReadReplica: db,
			},
		}),
	})

	const commitInput = (
		overrides: Partial<{
			sha: string
			parentShas: string[]
			branch: string
			repoFullName: string
			repoRemoteUrl: string
			subject: string
			body: string
			committedAt: number
			additions: number
			deletions: number
			filesChanged: number
			fileStats: Array<{ path: string; additions: number; deletions: number; binary?: boolean }>
			coAuthoredByAgent: boolean
			captureAlgorithmVersion: number
		}> = {},
	) => ({
		sha: randomBytes(20).toString('hex'),
		parentShas: [],
		branch: 'main',
		subject: 'feat: add commit tracking',
		body: 'Detailed body of the commit.',
		committedAt: Date.now(),
		additions: 12,
		deletions: 4,
		filesChanged: 2,
		fileStats: [
			{ path: 'src/foo.ts', additions: 10, deletions: 3 },
			{ path: 'src/bar.ts', additions: 2, deletions: 1 },
		],
		coAuthoredByAgent: true,
		captureAlgorithmVersion: 1,
		...overrides,
	})

	test('inserts commits with denormalized session attribution', async () => {
		const session = await createSession({ task_id: null })
		const commit = commitInput()

		const result = await call(
			recordCommitsProcedure,
			{ sessionId: session.id, commits: [commit] },
			createDaemonContext(),
		)
		expect(result).toEqual({ recorded: 1 })

		const rows = await db.select().from(commits).where(eq(commits.session_id, session.id))
		expect(rows).toHaveLength(1)

		const row = rows[0]
		expect(row).toMatchObject({
			organization_id: organizationId,
			session_id: session.id,
			task_id: null,
			resource_owner_user_id: userId,
			coding_agent: 'claude',
			commit_sha: commit.sha,
			branch: 'main',
			subject: commit.subject,
			body: commit.body,
			additions: 12,
			deletions: 4,
			files_changed: 2,
			co_authored_by_agent: true,
			capture_algorithm_version: 1,
		})
		expect(row?.file_stats).toEqual(commit.fileStats)
		expect(row?.committed_at).toBe(BigInt(commit.committedAt))
	})

	test('lowercases repo_full_name server-side so the pull_requests join matches', async () => {
		const session = await createSession({ task_id: null })
		// pull_requests.repo_full_name is lowercased in the PR upsert; commits must
		// agree on casing or the documented commits<->pull_requests join finds nothing.
		const commit = commitInput({ repoFullName: 'HumanLayer/Syncopate' })

		const result = await call(
			recordCommitsProcedure,
			{ sessionId: session.id, commits: [commit] },
			createDaemonContext(),
		)
		expect(result).toEqual({ recorded: 1 })

		const rows = await db.select().from(commits).where(eq(commits.commit_sha, commit.sha))
		expect(rows[0]?.repo_full_name).toBe('humanlayer/syncopate')
	})

	test('SHA dedupe on replay inserts nothing and returns recorded: 0', async () => {
		const session = await createSession()
		const commit = commitInput()
		const input = { sessionId: session.id, commits: [commit] }

		const first = await call(recordCommitsProcedure, input, createDaemonContext())
		expect(first).toEqual({ recorded: 1 })

		// Same payload again — the oRPC retry-plugin scenario
		const replay = await call(recordCommitsProcedure, input, createDaemonContext())
		expect(replay).toEqual({ recorded: 0 })

		const rows = await db.select({ id: commits.id }).from(commits).where(eq(commits.commit_sha, commit.sha))
		expect(rows).toHaveLength(1)
	})

	test('cross-session dedupe within the same org keeps first-writer attribution', async () => {
		const firstSession = await createSession()
		const secondSession = await createSession()
		const commit = commitInput()

		const first = await call(
			recordCommitsProcedure,
			{ sessionId: firstSession.id, commits: [commit] },
			createDaemonContext(),
		)
		expect(first).toEqual({ recorded: 1 })

		// Same SHA observed again from a different session in the same org (e.g. a
		// shared worktree) — org-wide unique(org, sha) means the second writer loses.
		const second = await call(
			recordCommitsProcedure,
			{ sessionId: secondSession.id, commits: [commit] },
			createDaemonContext(),
		)
		expect(second).toEqual({ recorded: 0 })

		const rows = await db.select().from(commits).where(eq(commits.commit_sha, commit.sha))
		expect(rows).toHaveLength(1)
		expect(rows[0]?.session_id).toBe(firstSession.id)
	})

	test('rejects when the daemon is not running the session (host mismatch)', async () => {
		const session = await createSession()

		await expect(
			call(
				recordCommitsProcedure,
				{ sessionId: session.id, commits: [commitInput()] },
				createDaemonContext({ hostId: randomUUID() }),
			),
		).rejects.toMatchObject({ code: 'FORBIDDEN' })
	})

	test('rejects a session from another organization as NOT_FOUND', async () => {
		const [otherOrg] = await db
			.insert(organizations)
			.values({ name: 'Other Org', workos_organization_id: `workos-org-${randomUUID()}` })
			.returning()
		if (!otherOrg) throw new Error('Unable to insert organization for setup')

		const session = await createSession()

		await expect(
			call(
				recordCommitsProcedure,
				{ sessionId: session.id, commits: [commitInput()] },
				createDaemonContext({ organizationId: otherOrg.id }),
			),
		).rejects.toMatchObject({ code: 'NOT_FOUND' })
	})
	const createTask = async (ownerUserId: string) => {
		const [task] = await db
			.insert(tasks)
			.values({
				organization_id: organizationId,
				name: 'commits record task',
				resource_owner_user_id: ownerUserId,
				created_by: ownerUserId,
				default_working_directory: tmpdir(),
			})
			.returning()

		if (!task) throw new Error('Unable to insert task for setup')
		return task
	}

	test('rejects when the daemon user is not the session creator', async () => {
		// The host check is `host_id !== hostId || created_by !== userId`. The host half is
		// covered above; this pins the created_by half so splitting the condition is caught.
		const session = await createSession({ created_by: `${userId}_other` })

		await expect(
			call(recordCommitsProcedure, { sessionId: session.id, commits: [commitInput()] }, createDaemonContext()),
		).rejects.toMatchObject({ code: 'FORBIDDEN' })
	})

	test('rejects when the task ACL grants no access to the session task', async () => {
		// Session is the daemon's (host + creator match), but its parent task belongs to
		// another user with no ACL entry — canWriteTaskForSession is the only gate left.
		const task = await createTask(`${userId}_task_owner`)
		const session = await createSession({ task_id: task.id })

		await expect(
			call(recordCommitsProcedure, { sessionId: session.id, commits: [commitInput()] }, createDaemonContext()),
		).rejects.toMatchObject({ code: 'FORBIDDEN' })

		const rows = await db.select({ id: commits.id }).from(commits).where(eq(commits.session_id, session.id))
		expect(rows).toHaveLength(0)
	})

	test('rejects when the task ACL grants read but not edit', async () => {
		// `effectivePermission !== 'edit'` — read access is not enough to write the ledger.
		const task = await createTask(`${userId}_task_owner`)
		await db.insert(taskUserAcl).values({
			organization_id: organizationId,
			task_id: task.id,
			subject_user_id: userId,
			resource_owner_user_id: task.resource_owner_user_id,
			permission_level: 'read',
			granted_by: task.resource_owner_user_id,
		})
		const session = await createSession({ task_id: task.id })

		await expect(
			call(recordCommitsProcedure, { sessionId: session.id, commits: [commitInput()] }, createDaemonContext()),
		).rejects.toMatchObject({ code: 'FORBIDDEN' })
	})

	test('accepts when the task ACL grants edit', async () => {
		// The positive side of the same gate: an edit ACL on someone else's task records.
		const task = await createTask(`${userId}_task_owner`)
		await db.insert(taskUserAcl).values({
			organization_id: organizationId,
			task_id: task.id,
			subject_user_id: userId,
			resource_owner_user_id: task.resource_owner_user_id,
			permission_level: 'edit',
			granted_by: task.resource_owner_user_id,
		})
		const session = await createSession({ task_id: task.id })
		const commit = commitInput()

		const result = await call(
			recordCommitsProcedure,
			{ sessionId: session.id, commits: [commit] },
			createDaemonContext(),
		)
		expect(result).toEqual({ recorded: 1 })

		const rows = await db.select().from(commits).where(eq(commits.commit_sha, commit.sha))
		expect(rows[0]?.task_id).toBe(task.id)
	})
})
