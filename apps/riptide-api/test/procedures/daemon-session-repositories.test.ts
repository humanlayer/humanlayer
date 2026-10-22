import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'

import { organizations } from '@humanlayer/db/tables/organizations'
import { sessionRepositories } from '@humanlayer/db/tables/session-repositories'
import { sessions } from '@humanlayer/db/tables/sessions'
import { call } from '@orpc/server'
import { asc, eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { reportSessionRepositoriesProcedure as liveReportSessionRepositoriesProcedure } from '../../src/orpc/daemon/sessions/repositories/report.effect'
import { createMockDaemonAuth, createMockDaemonContext } from '../mocks'
import { bindProcedureToRuntime, createRuntimeWithTestPostgresLayer } from '../utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('daemon/sessions/repositories', async () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let effectRuntime: ReturnType<typeof createRuntimeWithTestPostgresLayer> | undefined
	let reportSessionRepositoriesProcedure: typeof liveReportSessionRepositoriesProcedure
	let organizationId: string
	const userId = 'user_daemon_session_repositories'
	const hostId = randomUUID()

	beforeAll(async () => {
		const testDb = await createTestDb('daemon_session_repositories')
		cleanupTestDb = testDb.cleanup
		db = testDb.db
		effectRuntime = createRuntimeWithTestPostgresLayer(db)
		reportSessionRepositoriesProcedure = bindProcedureToRuntime(
			liveReportSessionRepositoriesProcedure,
			effectRuntime,
		)

		const [org] = await db
			.insert(organizations)
			.values({ name: 'Session Repositories Org', workos_organization_id: `workos-org-${randomUUID()}` })
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
				title: 'repo session',
				working_directory: tmpdir(),
				coding_agent: 'claude',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissions_mode: 'default',
				status: 'running',
				task_id: null,
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
			services: { db, dbReadReplica: db },
		}),
	})

	const rowsForSession = (sessionId: string) =>
		db
			.select()
			.from(sessionRepositories)
			.where(eq(sessionRepositories.session_id, sessionId))
			.orderBy(asc(sessionRepositories.first_seen_at), asc(sessionRepositories.id))

	test('fresh report inserts one head row per repository with a server-parsed repo name', async () => {
		const session = await createSession()

		const result = await call(
			reportSessionRepositoriesProcedure,
			{
				sessionId: session.id,
				repositories: [
					{
						localPath: '/home/dev/acme',
						remoteUrl: 'git@github.com:Acme/Repo.git',
						branch: 'feature-a',
					},
				],
			},
			createDaemonContext(),
		)

		expect(result).toEqual({ recorded: 1 })

		const rows = await rowsForSession(session.id)
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({
			organization_id: organizationId,
			session_id: session.id,
			task_id: null,
			host_id: hostId,
			local_path: '/home/dev/acme',
			remote_url: 'git@github.com:Acme/Repo.git',
			repo_full_name: 'acme/repo', // parsed + lowercased server-side
			branch: 'feature-a',
			is_head: true,
		})
	})

	test('a new branch on the same path demotes the old row and keeps its first_seen_at', async () => {
		const session = await createSession()
		const localPath = '/home/dev/switcher'

		await call(
			reportSessionRepositoriesProcedure,
			{
				sessionId: session.id,
				repositories: [{ localPath, remoteUrl: 'https://github.com/acme/switcher.git', branch: 'main' }],
			},
			createDaemonContext(),
		)

		const [firstRow] = await rowsForSession(session.id)
		if (!firstRow) throw new Error('Expected the first observation to be recorded')

		await call(
			reportSessionRepositoriesProcedure,
			{
				sessionId: session.id,
				repositories: [
					{ localPath, remoteUrl: 'https://github.com/acme/switcher.git', branch: 'agent-branch' },
				],
			},
			createDaemonContext(),
		)

		const rows = await rowsForSession(session.id)
		expect(rows).toHaveLength(2)

		const byBranch = new Map(rows.map((row) => [row.branch, row]))
		expect(byBranch.get('main')?.is_head).toBe(false)
		expect(byBranch.get('agent-branch')?.is_head).toBe(true)

		// The row keeps its age: only last_seen_at moves.
		await call(
			reportSessionRepositoriesProcedure,
			{
				sessionId: session.id,
				repositories: [{ localPath, remoteUrl: 'https://github.com/acme/switcher.git', branch: 'main' }],
			},
			createDaemonContext(),
		)

		const [mainAgain] = await db.select().from(sessionRepositories).where(eq(sessionRepositories.id, firstRow.id))
		expect(mainAgain?.first_seen_at).toBe(firstRow.first_seen_at)
		expect(mainAgain?.is_head).toBe(true)
		expect(mainAgain!.last_seen_at >= firstRow.last_seen_at).toBe(true)
	})

	test('a path missing from the snapshot keeps its state', async () => {
		const session = await createSession()

		await call(
			reportSessionRepositoriesProcedure,
			{
				sessionId: session.id,
				repositories: [
					{ localPath: '/home/dev/one', remoteUrl: 'https://github.com/acme/one.git', branch: 'main' },
					{ localPath: '/home/dev/two', remoteUrl: 'https://github.com/acme/two.git', branch: 'main' },
				],
			},
			createDaemonContext(),
		)

		// The daemon could not probe /home/dev/two this cycle; that row must not be demoted.
		await call(
			reportSessionRepositoriesProcedure,
			{
				sessionId: session.id,
				repositories: [
					{ localPath: '/home/dev/one', remoteUrl: 'https://github.com/acme/one.git', branch: 'main' },
				],
			},
			createDaemonContext(),
		)

		const rows = await rowsForSession(session.id)
		const byPath = new Map(rows.map((row) => [row.local_path, row]))
		expect(byPath.get('/home/dev/one')?.is_head).toBe(true)
		expect(byPath.get('/home/dev/two')?.is_head).toBe(true)
	})

	test('a detached HEAD records one branchless row and stays unique on repeat', async () => {
		const session = await createSession()

		await call(
			reportSessionRepositoriesProcedure,
			{
				sessionId: session.id,
				repositories: [{ localPath: '/home/dev/detached', remoteUrl: 'https://github.com/acme/detached.git' }],
			},
			createDaemonContext(),
		)
		await call(
			reportSessionRepositoriesProcedure,
			{
				sessionId: session.id,
				repositories: [{ localPath: '/home/dev/detached', remoteUrl: 'https://github.com/acme/detached.git' }],
			},
			createDaemonContext(),
		)

		const rows = await rowsForSession(session.id)
		expect(rows).toHaveLength(1)
		expect(rows[0]?.branch).toBeNull()
		expect(rows[0]?.is_head).toBe(true)
	})

	test('a non-github remote and a missing remote both record a null repo_full_name', async () => {
		const session = await createSession()

		await call(
			reportSessionRepositoriesProcedure,
			{
				sessionId: session.id,
				repositories: [
					{
						localPath: '/home/dev/gitlab',
						remoteUrl: 'git@gitlab.com:acme/internal.git',
						branch: 'main',
					},
					{ localPath: '/home/dev/local-only', branch: 'main' },
				],
			},
			createDaemonContext(),
		)

		const rows = await rowsForSession(session.id)
		const byPath = new Map(rows.map((row) => [row.local_path, row]))
		expect(byPath.get('/home/dev/gitlab')).toMatchObject({
			remote_url: 'git@gitlab.com:acme/internal.git',
			repo_full_name: null,
		})
		expect(byPath.get('/home/dev/local-only')).toMatchObject({ remote_url: null, repo_full_name: null })
	})

	test('report rejects host mismatch (FORBIDDEN) and cross-org (NOT_FOUND)', async () => {
		const session = await createSession()
		const repositories = [
			{ localPath: '/home/dev/authz', remoteUrl: 'https://github.com/acme/authz.git', branch: 'main' },
		]

		await expect(
			call(
				reportSessionRepositoriesProcedure,
				{ sessionId: session.id, repositories },
				createDaemonContext({ hostId: randomUUID() }),
			),
		).rejects.toMatchObject({ code: 'FORBIDDEN' })

		const [otherOrg] = await db
			.insert(organizations)
			.values({ name: 'Other Repositories Org', workos_organization_id: `workos-org-${randomUUID()}` })
			.returning()
		if (!otherOrg) throw new Error('Unable to insert org')

		await expect(
			call(
				reportSessionRepositoriesProcedure,
				{ sessionId: session.id, repositories },
				createDaemonContext({ organizationId: otherOrg.id }),
			),
		).rejects.toMatchObject({ code: 'NOT_FOUND' })

		expect(await rowsForSession(session.id)).toHaveLength(0)
	})
})
