import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'

import { organizations } from '@humanlayer/db/tables/organizations'
import { pullRequests } from '@humanlayer/db/tables/pull-requests'
import { sessions } from '@humanlayer/db/tables/sessions'
import { userIdentities } from '@humanlayer/db/tables/user-identities'
import { call } from '@orpc/server'
import { and, eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { listOpenPullRequestsForHostProcedure as liveListOpenPullRequestsForHostProcedure } from '../../src/orpc/daemon/pull-requests/list-open-for-host.effect'
import { refreshPullRequestStatusProcedure as liveRefreshPullRequestStatusProcedure } from '../../src/orpc/daemon/pull-requests/refresh-status.effect'
import { upsertSessionPullRequestProcedure as liveUpsertSessionPullRequestProcedure } from '../../src/orpc/daemon/sessions/pull-requests/upsert.effect'
import { setGithubIdentityProcedure as liveSetGithubIdentityProcedure } from '../../src/orpc/daemon/users/set-github-identity.effect'
import { createMockDaemonAuth, createMockDaemonContext } from '../mocks'
import { bindProcedureToRuntime, createRuntimeWithTestPostgresLayer } from '../utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

/**
 * The daemon's own pull request routes are retired: the server discovers pull requests from
 * branch events and the GitHub App. A daemon from before that still calls them after a run and
 * on its refresh sweep, so they stay as accepting no-ops for one release.
 */
describe('daemon/pull-requests', async () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let effectRuntime: ReturnType<typeof createRuntimeWithTestPostgresLayer> | undefined
	let listOpenPullRequestsForHostProcedure: typeof liveListOpenPullRequestsForHostProcedure
	let refreshPullRequestStatusProcedure: typeof liveRefreshPullRequestStatusProcedure
	let upsertSessionPullRequestProcedure: typeof liveUpsertSessionPullRequestProcedure
	let setGithubIdentityProcedure: typeof liveSetGithubIdentityProcedure
	let organizationId: string
	let sessionId: string
	const userId = 'user_daemon_pull_requests'
	const hostId = randomUUID()

	beforeAll(async () => {
		const testDb = await createTestDb('daemon_pull_requests')
		cleanupTestDb = testDb.cleanup
		db = testDb.db
		effectRuntime = createRuntimeWithTestPostgresLayer(db)
		listOpenPullRequestsForHostProcedure = bindProcedureToRuntime(
			liveListOpenPullRequestsForHostProcedure,
			effectRuntime,
		)
		refreshPullRequestStatusProcedure = bindProcedureToRuntime(liveRefreshPullRequestStatusProcedure, effectRuntime)
		upsertSessionPullRequestProcedure = bindProcedureToRuntime(liveUpsertSessionPullRequestProcedure, effectRuntime)
		setGithubIdentityProcedure = bindProcedureToRuntime(liveSetGithubIdentityProcedure, effectRuntime)

		const [org] = await db
			.insert(organizations)
			.values({ name: 'Daemon Pull Requests Org', workos_organization_id: `workos-org-${randomUUID()}` })
			.returning()
		if (!org) throw new Error('Unable to insert organization for setup')
		organizationId = org.id

		const [session] = await db
			.insert(sessions)
			.values({
				organization_id: organizationId,
				resource_owner_user_id: userId,
				created_by: userId,
				host_id: hostId,
				title: 'pull request session',
				working_directory: tmpdir(),
				coding_agent: 'claude',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissions_mode: 'default',
				status: 'running',
				task_id: null,
			})
			.returning({ id: sessions.id })
		if (!session) throw new Error('Unable to insert session for setup')
		sessionId = session.id
	}, 30000)

	afterAll(async () => {
		await effectRuntime?.dispose()
		await cleanupTestDb?.()
	}, 30000)

	const createDaemonContext = () => ({
		context: createMockDaemonContext({
			auth: createMockDaemonAuth({ userId, organizationId, hostId }),
			services: { db, dbReadReplica: db },
		}),
	})

	test('a post-run report is accepted and writes nothing', async () => {
		const result = await call(
			upsertSessionPullRequestProcedure,
			{
				sessionId,
				repoFullName: 'Acme/Repo',
				number: 7,
				url: 'https://github.com/acme/repo/pull/7',
				title: 'Add feature',
				state: 'open',
				isDraft: false,
				headRef: 'feature-branch',
				captureVersion: 1,
			},
			createDaemonContext(),
		)
		expect(result).toEqual({ pullRequestId: null })

		const rows = await db
			.select({ id: pullRequests.id })
			.from(pullRequests)
			.where(and(eq(pullRequests.organization_id, organizationId), eq(pullRequests.repo_full_name, 'acme/repo')))
		expect(rows).toEqual([])
	})

	test('the refresh sweep finds nothing to do and its report changes nothing', async () => {
		const [seeded] = await db
			.insert(pullRequests)
			.values({
				organization_id: organizationId,
				session_id: sessionId,
				resource_owner_user_id: userId,
				repo_full_name: 'acme/sweep',
				number: 1,
				url: 'https://github.com/acme/sweep/pull/1',
				title: 'Open for the sweep',
				state: 'open',
				head_ref: 'feature-sweep',
				source: 'daemon',
			})
			.returning({ id: pullRequests.id })
		if (!seeded) throw new Error('Unable to insert pull request for setup')

		const listed = await call(listOpenPullRequestsForHostProcedure, { limit: 50 }, createDaemonContext())
		expect(listed).toEqual({ pullRequests: [] })

		const refreshed = await call(
			refreshPullRequestStatusProcedure,
			{
				updates: [{ pullRequestId: seeded.id, state: 'merged', isDraft: false, mergedAt: 1_700_000_000_000 }],
				failedPullRequestIds: [],
			},
			createDaemonContext(),
		)
		expect(refreshed).toEqual({ updated: 0, failedMarked: 0 })

		const [row] = await db.select().from(pullRequests).where(eq(pullRequests.id, seeded.id))
		expect(row).toMatchObject({ state: 'open', merged_at: null, last_checked_at: null })
	})

	test('set-github-identity upserts and a changed external_id overwrites', async () => {
		const first = await call(
			setGithubIdentityProcedure,
			{ login: 'octocat', externalId: '583231', email: 'octo@example.com' },
			createDaemonContext(),
		)
		expect(first).toEqual({ ok: true })

		const rowsAfterFirst = await db
			.select()
			.from(userIdentities)
			.where(
				and(
					eq(userIdentities.organization_id, organizationId),
					eq(userIdentities.provider, 'github'),
					eq(userIdentities.user_id, userId),
				),
			)
		expect(rowsAfterFirst).toHaveLength(1)
		expect(rowsAfterFirst[0]).toMatchObject({
			external_id: '583231',
			external_login: 'octocat',
			source: 'daemon_gh_cli',
		})

		// Re-auth as a different GitHub account overwrites in place.
		await call(setGithubIdentityProcedure, { login: 'octocat-two', externalId: '999999' }, createDaemonContext())

		const rowsAfterSecond = await db
			.select()
			.from(userIdentities)
			.where(
				and(
					eq(userIdentities.organization_id, organizationId),
					eq(userIdentities.provider, 'github'),
					eq(userIdentities.user_id, userId),
				),
			)
		expect(rowsAfterSecond).toHaveLength(1)
		expect(rowsAfterSecond[0]).toMatchObject({ external_id: '999999', external_login: 'octocat-two' })
	})
})
