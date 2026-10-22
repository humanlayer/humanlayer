import { randomBytes, randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'

import { commitWatchWatermarks } from '@humanlayer/db/tables/commit-watch-watermarks'
import { commits } from '@humanlayer/db/tables/commits'
import { organizations } from '@humanlayer/db/tables/organizations'
import { sessions } from '@humanlayer/db/tables/sessions'
import { call } from '@orpc/server'
import { eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { recordObservedCommitsProcedure as liveRecordObservedCommitsProcedure } from '../../src/orpc/daemon/commits/record-observed.effect'
import {
	getCommitWatermarksProcedure as liveGetCommitWatermarksProcedure,
	setCommitWatermarkProcedure as liveSetCommitWatermarkProcedure,
} from '../../src/orpc/daemon/commits/watermark.effect'
import { createMockDaemonAuth, createMockDaemonContext } from '../mocks'
import { bindProcedureToRuntime, createRuntimeWithTestPostgresLayer } from '../utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('daemon/commits/record-observed + watermark', async () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let effectRuntime: ReturnType<typeof createRuntimeWithTestPostgresLayer> | undefined
	let recordObservedCommitsProcedure: typeof liveRecordObservedCommitsProcedure
	let getCommitWatermarksProcedure: typeof liveGetCommitWatermarksProcedure
	let setCommitWatermarkProcedure: typeof liveSetCommitWatermarkProcedure
	let organizationId: string
	const userId = 'user_daemon_commits_observed'
	const hostId = randomUUID()

	beforeAll(async () => {
		const testDb = await createTestDb('daemon_commits_record_observed')
		cleanupTestDb = testDb.cleanup
		db = testDb.db
		effectRuntime = createRuntimeWithTestPostgresLayer(db)
		recordObservedCommitsProcedure = bindProcedureToRuntime(liveRecordObservedCommitsProcedure, effectRuntime)
		getCommitWatermarksProcedure = bindProcedureToRuntime(liveGetCommitWatermarksProcedure, effectRuntime)
		setCommitWatermarkProcedure = bindProcedureToRuntime(liveSetCommitWatermarkProcedure, effectRuntime)

		const [org] = await db
			.insert(organizations)
			.values({ name: 'Observed Commits Org', workos_organization_id: `workos-org-${randomUUID()}` })
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
				resource_owner_user_id: `owner_${randomUUID()}`,
				created_by: userId,
				host_id: hostId,
				title: 'observed commits session',
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

	const observedCommit = (
		overrides: Partial<{
			sha: string
			attributionMethod: 'confirmed' | 'inferred' | 'human'
			attributedSessionId: string
			aiConfidence: number
			aiAttributedLines: number
			attributionAlgorithmVersion: number
			subject: string
		}> = {},
	) => ({
		sha: randomBytes(20).toString('hex'),
		parentShas: [],
		branch: 'main',
		subject: 'feat: observed commit',
		body: 'Detailed body of the observed commit.',
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
		attributionMethod: 'human' as const,
		aiConfidence: 0,
		attributionAlgorithmVersion: 1,
		...overrides,
	})

	test('records a human commit owned by the daemon user with null session/task/agent', async () => {
		const commit = observedCommit({ attributionMethod: 'human', aiConfidence: 0 })

		const result = await call(recordObservedCommitsProcedure, { commits: [commit] }, createDaemonContext())
		expect(result).toEqual({ recorded: 1 })

		const rows = await db.select().from(commits).where(eq(commits.commit_sha, commit.sha))
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({
			organization_id: organizationId,
			session_id: null,
			task_id: null,
			resource_owner_user_id: userId,
			coding_agent: null,
			attribution_method: 'human',
			ai_confidence: 0,
			attribution_algorithm_version: 1,
		})
	})

	test('records an attributed commit denormalizing owner/task/agent from the session', async () => {
		const taskOwner = `owner_${randomUUID()}`
		const session = await createSession({ resource_owner_user_id: taskOwner, task_id: null })
		const commit = observedCommit({
			attributionMethod: 'confirmed',
			attributedSessionId: session.id,
			aiConfidence: 1,
			aiAttributedLines: 10,
		})

		const result = await call(recordObservedCommitsProcedure, { commits: [commit] }, createDaemonContext())
		expect(result).toEqual({ recorded: 1 })

		const rows = await db.select().from(commits).where(eq(commits.commit_sha, commit.sha))
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({
			session_id: session.id,
			resource_owner_user_id: taskOwner,
			coding_agent: 'claude',
			attribution_method: 'confirmed',
			ai_confidence: 1,
			ai_attributed_lines: 10,
		})
	})

	test('SHA dedupe on replay inserts nothing and returns recorded: 0', async () => {
		const commit = observedCommit()
		const input = { commits: [commit] }

		const first = await call(recordObservedCommitsProcedure, input, createDaemonContext())
		expect(first).toEqual({ recorded: 1 })

		const replay = await call(recordObservedCommitsProcedure, input, createDaemonContext())
		expect(replay).toEqual({ recorded: 0 })

		const rows = await db.select({ id: commits.id }).from(commits).where(eq(commits.commit_sha, commit.sha))
		expect(rows).toHaveLength(1)
	})

	test('downgrades a commit attributed to another organization’s session instead of failing the batch', async () => {
		// The trailer rides world-readable commit messages (public/forked repos), so a foreign
		// session reference is expected in the wild. Failing the batch would wedge the daemon's
		// watermark loop — the commit must land, unattributed.
		const [otherOrg] = await db
			.insert(organizations)
			.values({ name: 'Other Observed Org', workos_organization_id: `workos-org-${randomUUID()}` })
			.returning()
		if (!otherOrg) throw new Error('Unable to insert organization for setup')

		const session = await createSession()
		const commit = observedCommit({
			attributionMethod: 'confirmed',
			attributedSessionId: session.id,
			aiConfidence: 1,
			aiAttributedLines: 10,
		})

		const result = await call(
			recordObservedCommitsProcedure,
			{ commits: [commit] },
			createDaemonContext({ organizationId: otherOrg.id }),
		)
		expect(result).toEqual({ recorded: 1 })

		const rows = await db.select().from(commits).where(eq(commits.commit_sha, commit.sha))
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({
			organization_id: otherOrg.id,
			session_id: null,
			task_id: null,
			resource_owner_user_id: userId,
			coding_agent: null,
			attribution_method: 'human',
			ai_confidence: 0,
			ai_attributed_lines: 0,
		})
	})

	test('downgrades a commit attributed to a nonexistent session (e.g. deleted) instead of failing', async () => {
		const commit = observedCommit({
			attributionMethod: 'confirmed',
			attributedSessionId: randomUUID(),
			aiConfidence: 1,
			aiAttributedLines: 3,
		})

		const result = await call(recordObservedCommitsProcedure, { commits: [commit] }, createDaemonContext())
		expect(result).toEqual({ recorded: 1 })

		const rows = await db.select().from(commits).where(eq(commits.commit_sha, commit.sha))
		expect(rows[0]).toMatchObject({
			session_id: null,
			attribution_method: 'human',
			ai_confidence: 0,
			ai_attributed_lines: 0,
		})
	})

	test('a downgraded row is insert-only: re-submitting the sha after the session exists does not upgrade it', async () => {
		// The ledger is insert-only (onConflictDoNothing): once a commit lands downgraded,
		// a later replay — even after the referenced session becomes resolvable — must not
		// rewrite the row. Re-attribution is a versioned backfill concern, not a replay one.
		const sessionId = randomUUID()
		const commit = observedCommit({ attributionMethod: 'confirmed', attributedSessionId: sessionId })

		const first = await call(recordObservedCommitsProcedure, { commits: [commit] }, createDaemonContext())
		expect(first).toEqual({ recorded: 1 })

		await createSession({ id: sessionId })
		const replay = await call(recordObservedCommitsProcedure, { commits: [commit] }, createDaemonContext())
		expect(replay).toEqual({ recorded: 0 })

		const rows = await db.select().from(commits).where(eq(commits.commit_sha, commit.sha))
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({ session_id: null, attribution_method: 'human' })
	})

	test('a mixed batch keeps valid attributions while downgrading only the unresolvable one', async () => {
		const session = await createSession()
		const attributed = observedCommit({
			attributionMethod: 'confirmed',
			attributedSessionId: session.id,
			aiConfidence: 1,
			aiAttributedLines: 5,
		})
		const foreign = observedCommit({ attributionMethod: 'inferred', attributedSessionId: randomUUID() })

		const result = await call(
			recordObservedCommitsProcedure,
			{ commits: [attributed, foreign] },
			createDaemonContext(),
		)
		expect(result).toEqual({ recorded: 2 })

		const attributedRows = await db.select().from(commits).where(eq(commits.commit_sha, attributed.sha))
		expect(attributedRows[0]).toMatchObject({ session_id: session.id, attribution_method: 'confirmed' })

		const foreignRows = await db.select().from(commits).where(eq(commits.commit_sha, foreign.sha))
		expect(foreignRows[0]).toMatchObject({ session_id: null, attribution_method: 'human' })
	})

	test('watermark set-then-get round trip, scoped to (host, org, repo)', async () => {
		const repoDirectory = `/repos/${randomUUID()}`
		const sha = randomBytes(20).toString('hex')

		// Absent watermark reads back as null.
		const before = await call(
			getCommitWatermarksProcedure,
			{ repoDirectories: [repoDirectory] },
			createDaemonContext(),
		)
		expect(before).toEqual({ watermarks: [{ repoDirectory, lastSeenSha: null }] })

		const setResult = await call(
			setCommitWatermarkProcedure,
			{ repoDirectory, lastSeenSha: sha },
			createDaemonContext(),
		)
		expect(setResult).toEqual({ ok: true })

		const after = await call(
			getCommitWatermarksProcedure,
			{ repoDirectories: [repoDirectory] },
			createDaemonContext(),
		)
		expect(after).toEqual({ watermarks: [{ repoDirectory, lastSeenSha: sha }] })

		// Second set overwrites (upsert on the unique index).
		const nextSha = randomBytes(20).toString('hex')
		await call(setCommitWatermarkProcedure, { repoDirectory, lastSeenSha: nextSha }, createDaemonContext())

		const rows = await db
			.select()
			.from(commitWatchWatermarks)
			.where(eq(commitWatchWatermarks.repo_directory, repoDirectory))
		expect(rows).toHaveLength(1)
		expect(rows[0]?.last_seen_sha).toBe(nextSha)
	})
})
