import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'

import { commits } from '@humanlayer/db/tables/commits'
import { organizations } from '@humanlayer/db/tables/organizations'
import { pullRequests } from '@humanlayer/db/tables/pull-requests'
import { sessionUsageEvents } from '@humanlayer/db/tables/session-usage-events'
import { sessions } from '@humanlayer/db/tables/sessions'
import { addDays, RANGE_HISTORY_DAYS, TRAILING_LEAD_IN_DAYS } from '@humanlayer/riptide-api-contract/api/metrics/range'
import { call } from '@orpc/server'
import { eq, inArray } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { apiRouter } from '../../src/orpc/router'
import { createMockApiAuth, createMockApiContext } from '../mocks'
import { requireExternalTestServices } from '../utils/external-test-services'
import { dailyMetricsRange, metricsRange } from '../utils/metrics-range'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('metrics/usersScatter', async () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let organizationId: string
	let otherOrgId: string
	const hostId = randomUUID()
	const fullUser = `user_scatter_full_${randomUUID()}`
	const usageOnlyUser = `user_scatter_usage_only_${randomUUID()}`
	// Mixed coding agents and repos across usage/commits/PRs — exercises the
	// agents and repos filters without disturbing the other users' aggregates.
	const mixedUser = `user_scatter_mixed_${randomUUID()}`

	const callContext = (overrides: { organizationId?: string } = {}) => ({
		context: createMockApiContext({
			auth: createMockApiAuth({
				userId: 'user_admin_scatter',
				organizationId: overrides.organizationId ?? organizationId,
				workosOrganizationId: 'workos-org-scatter',
				role: 'admin',
			}),
			services: { db, dbReadReplica: db },
		}),
	})

	const createSession = async (orgId: string, userId: string) => {
		const [session] = await db
			.insert(sessions)
			.values({
				organization_id: orgId,
				resource_owner_user_id: userId,
				created_by: userId,
				host_id: hostId,
				working_directory: tmpdir(),
				coding_agent: 'claude',
				status: 'ready_for_input',
			})
			.returning()
		if (!session) throw new Error('Unable to insert session for setup')
		return session
	}

	beforeAll(async () => {
		const testDb = await createTestDb('metrics_users_scatter')
		cleanupTestDb = testDb.cleanup
		db = testDb.db

		const [org] = await db
			.insert(organizations)
			.values({ name: 'Scatter Org', workos_organization_id: `workos-org-${randomUUID()}` })
			.returning()
		if (!org) throw new Error('Unable to insert organization for setup')
		organizationId = org.id

		const [otherOrg] = await db
			.insert(organizations)
			.values({ name: 'Other Scatter Org', workos_organization_id: `workos-org-${randomUUID()}` })
			.returning()
		if (!otherOrg) throw new Error('Unable to insert organization for setup')
		otherOrgId = otherOrg.id

		const now = Date.now()
		const dayMs = 24 * 60 * 60 * 1000
		const inRange = now - 5 * dayMs
		const outOfRange = now - 60 * dayMs // outside the 4-week window

		const fullUserSession = await createSession(organizationId, fullUser)
		const usageOnlySession = await createSession(organizationId, usageOnlyUser)
		const mixedUserSession = await createSession(organizationId, mixedUser)
		const otherOrgSession = await createSession(otherOrgId, fullUser) // same user id, different org

		await db.insert(sessionUsageEvents).values([
			{
				session_id: fullUserSession.id,
				organization_id: organizationId,
				resource_owner_user_id: fullUser,
				session_creator_user_id: fullUser,
				coding_agent: 'claude',
				source: 'claude_sdk_result',
				report_key: `report-full-${randomUUID()}`,
				model: 'claude-sonnet-4-5',
				tokens: { input_tokens: 1000, output_tokens: 500 },
				input_tokens: 1000,
				output_tokens: 500,
				cost_usd: 1.5,
				occurred_at: BigInt(inRange),
			},
			{
				session_id: usageOnlySession.id,
				organization_id: organizationId,
				resource_owner_user_id: usageOnlyUser,
				session_creator_user_id: usageOnlyUser,
				coding_agent: 'claude',
				source: 'claude_sdk_result',
				report_key: `report-usage-only-${randomUUID()}`,
				model: 'claude-haiku-4-5',
				tokens: { input_tokens: 200, output_tokens: 100 },
				input_tokens: 200,
				output_tokens: 100,
				cost_usd: 0.25,
				occurred_at: BigInt(inRange),
			},
			// Second model for fullUser — lets the model filter narrow their usage
			// while leaving their commits/PRs (which have no model) untouched.
			{
				session_id: fullUserSession.id,
				organization_id: organizationId,
				resource_owner_user_id: fullUser,
				session_creator_user_id: fullUser,
				coding_agent: 'claude',
				source: 'claude_sdk_result',
				report_key: `report-full-haiku-${randomUUID()}`,
				model: 'claude-haiku-4-5',
				tokens: { input_tokens: 300, output_tokens: 150 },
				input_tokens: 300,
				output_tokens: 150,
				cost_usd: 0.5,
				occurred_at: BigInt(inRange),
			},
			// Out-of-range row for fullUser — must not be included in the 4-week window.
			{
				session_id: fullUserSession.id,
				organization_id: organizationId,
				resource_owner_user_id: fullUser,
				session_creator_user_id: fullUser,
				coding_agent: 'claude',
				source: 'claude_sdk_result',
				report_key: `report-out-of-range-${randomUUID()}`,
				model: 'claude-sonnet-4-5',
				tokens: { input_tokens: 9999, output_tokens: 9999 },
				input_tokens: 9999,
				output_tokens: 9999,
				cost_usd: 99,
				occurred_at: BigInt(outOfRange),
			},
			// Same user, different org — must not leak into organizationId's aggregates.
			{
				session_id: otherOrgSession.id,
				organization_id: otherOrgId,
				resource_owner_user_id: fullUser,
				session_creator_user_id: fullUser,
				coding_agent: 'claude',
				source: 'claude_sdk_result',
				report_key: `report-other-org-${randomUUID()}`,
				model: 'claude-sonnet-4-5',
				tokens: { input_tokens: 555, output_tokens: 555 },
				input_tokens: 555,
				output_tokens: 555,
				cost_usd: 55,
				occurred_at: BigInt(inRange),
			},
			// mixedUser: one usage row per coding agent — the agents filter must
			// narrow cost/tokens to the selected agent's rows.
			{
				session_id: mixedUserSession.id,
				organization_id: organizationId,
				resource_owner_user_id: mixedUser,
				session_creator_user_id: mixedUser,
				coding_agent: 'claude',
				source: 'claude_sdk_result',
				report_key: `report-mixed-claude-${randomUUID()}`,
				model: 'claude-sonnet-4-5',
				tokens: { input_tokens: 100, output_tokens: 50 },
				input_tokens: 100,
				output_tokens: 50,
				cost_usd: 3,
				occurred_at: BigInt(inRange),
			},
			{
				session_id: mixedUserSession.id,
				organization_id: organizationId,
				resource_owner_user_id: mixedUser,
				session_creator_user_id: mixedUser,
				coding_agent: 'codelayer',
				source: 'claude_sdk_result',
				report_key: `report-mixed-codelayer-${randomUUID()}`,
				model: 'claude-sonnet-4-5',
				tokens: { input_tokens: 700, output_tokens: 70 },
				input_tokens: 700,
				output_tokens: 70,
				cost_usd: 7,
				occurred_at: BigInt(inRange),
			},
		])

		await db.insert(commits).values([
			{
				organization_id: organizationId,
				session_id: fullUserSession.id,
				resource_owner_user_id: fullUser,
				commit_sha: `sha-${randomUUID()}`,
				subject: 'test commit',
				committed_at: BigInt(inRange),
				additions: 40,
				deletions: 10,
				files_changed: 2,
				capture_algorithm_version: 1,
			},
			// Known-HUMAN commit for fullUser — must never reach the LOC/commit
			// aggregates: the spend numerator is agent-only, so counting these
			// lines would divide agent dollars by human output. The huge
			// additions make a leak unmissable in the assertions below.
			{
				organization_id: organizationId,
				session_id: null,
				resource_owner_user_id: fullUser,
				commit_sha: `sha-${randomUUID()}`,
				subject: 'human commit',
				committed_at: BigInt(inRange),
				additions: 77_777,
				deletions: 7_777,
				files_changed: 4,
				capture_algorithm_version: 2,
				attribution_method: 'human',
				repo_full_name: 'acme/humans-only',
			},
			// mixedUser commits: one per (agent, repo) combination plus one with a
			// NULL coding_agent, which the agents filter must exclude.
			{
				organization_id: organizationId,
				session_id: mixedUserSession.id,
				resource_owner_user_id: mixedUser,
				commit_sha: `sha-${randomUUID()}`,
				subject: 'claude commit in acme/repo',
				committed_at: BigInt(inRange),
				additions: 100,
				deletions: 20,
				files_changed: 3,
				capture_algorithm_version: 1,
				coding_agent: 'claude',
				repo_full_name: 'acme/repo',
			},
			{
				organization_id: organizationId,
				session_id: mixedUserSession.id,
				resource_owner_user_id: mixedUser,
				commit_sha: `sha-${randomUUID()}`,
				subject: 'codelayer commit in acme/other',
				committed_at: BigInt(inRange),
				additions: 9,
				deletions: 1,
				files_changed: 1,
				capture_algorithm_version: 1,
				coding_agent: 'codelayer',
				repo_full_name: 'acme/other',
			},
			{
				organization_id: organizationId,
				session_id: mixedUserSession.id,
				resource_owner_user_id: mixedUser,
				commit_sha: `sha-${randomUUID()}`,
				subject: 'agentless commit in acme/repo',
				committed_at: BigInt(inRange),
				additions: 5,
				deletions: 5,
				files_changed: 1,
				capture_algorithm_version: 1,
				repo_full_name: 'acme/repo',
			},
		])

		await db.insert(pullRequests).values([
			{
				organization_id: organizationId,
				resource_owner_user_id: fullUser,
				repo_full_name: 'acme/repo',
				number: 1,
				attribution_method: 'committed',
				url: 'https://github.com/acme/repo/pull/1',
				title: 'merged pr',
				state: 'merged',
				head_ref: 'feature-1',
				author_is_bot: false,
				merged_at: BigInt(inRange),
			},
			// Bot-authored merged PR — must not be counted.
			{
				organization_id: organizationId,
				resource_owner_user_id: fullUser,
				repo_full_name: 'acme/repo',
				number: 2,
				attribution_method: 'committed',
				url: 'https://github.com/acme/repo/pull/2',
				title: 'dependabot pr',
				state: 'merged',
				head_ref: 'dependabot-1',
				author_is_bot: true,
				merged_at: BigInt(inRange),
			},
			// mixedUser: one merged PR per repo — the repos filter must narrow the
			// PR count while leaving usage (which has no repo) untouched.
			{
				organization_id: organizationId,
				resource_owner_user_id: mixedUser,
				repo_full_name: 'acme/repo',
				number: 3,
				attribution_method: 'committed',
				url: 'https://github.com/acme/repo/pull/3',
				title: 'mixed pr in acme/repo',
				state: 'merged',
				head_ref: 'feature-3',
				author_is_bot: false,
				merged_at: BigInt(inRange),
			},
			{
				organization_id: organizationId,
				resource_owner_user_id: mixedUser,
				repo_full_name: 'acme/other',
				number: 4,
				attribution_method: 'committed',
				url: 'https://github.com/acme/other/pull/4',
				title: 'mixed pr in acme/other',
				state: 'merged',
				head_ref: 'feature-4',
				author_is_bot: false,
				merged_at: BigInt(inRange),
			},
			// A branch a session only had checked out, and a PR no session touched: neither counts.
			{
				organization_id: organizationId,
				resource_owner_user_id: fullUser,
				repo_full_name: 'acme/repo',
				number: 5,
				attribution_method: 'observed',
				url: 'https://github.com/acme/repo/pull/5',
				title: 'observed pr',
				state: 'merged',
				head_ref: 'feature-5',
				author_is_bot: false,
				merged_at: BigInt(inRange),
			},
			{
				organization_id: organizationId,
				resource_owner_user_id: fullUser,
				repo_full_name: 'acme/repo',
				number: 6,
				url: 'https://github.com/acme/repo/pull/6',
				title: 'human pr',
				state: 'merged',
				head_ref: 'feature-6',
				author_is_bot: false,
				merged_at: BigInt(inRange),
			},
			// A repo that shows up only through an unattributed merged PR: not a filter option.
			{
				organization_id: organizationId,
				resource_owner_user_id: fullUser,
				repo_full_name: 'acme/unattributed-only',
				number: 7,
				url: 'https://github.com/acme/unattributed-only/pull/7',
				title: 'human pr elsewhere',
				state: 'merged',
				head_ref: 'feature-7',
				author_is_bot: false,
				merged_at: BigInt(inRange),
			},
		])
	}, 30000)

	afterAll(async () => {
		await cleanupTestDb?.()
	}, 30000)

	test('returns per-user aggregates merged across usage, commits, and merged PRs', async () => {
		const result = await call(apiRouter.metrics.usersScatter, metricsRange(), callContext())

		const full = result.data.find((d) => d.userId === fullUser)
		expect(full).toBeDefined()
		expect(full).toMatchObject({
			userId: fullUser,
			// Sonnet (1.5, 1000/500) + haiku (0.5, 300/150) rows summed — no model filter applied.
			costUsd: 2.0,
			inputTokens: 1300,
			outputTokens: 650,
			// The seeded KNOWN-HUMAN commit (77,777 additions) must not be here:
			// only the unattributed 40/10 commit counts. Spend is agent-only, so
			// human lines in the denominator would corrupt every unit-cost ratio.
			locAdded: 40,
			locDeleted: 10,
			commitCount: 1,
			// Bot-authored PR excluded, out-of-range/other-org rows excluded.
			prsMerged: 1,
		})
	})

	test('credits spend, commits, and PRs to whoever ran the session, not the task owner', async () => {
		// Inserted and removed INSIDE this test so the org-wide sums asserted by
		// the trend and coverage tests stay valid in any test order.
		const runner = `user_runner_${randomUUID()}`
		const inRange = Date.now() - 5 * 24 * 60 * 60 * 1000
		const [session] = await db
			.insert(sessions)
			.values({
				organization_id: organizationId,
				resource_owner_user_id: fullUser,
				created_by: runner,
				host_id: hostId,
				working_directory: tmpdir(),
				coding_agent: 'claude',
				status: 'ready_for_input',
			})
			.returning()
		if (!session) throw new Error('Unable to insert session for setup')
		const commitSha = `sha-runner-${randomUUID()}`
		await db.insert(sessionUsageEvents).values({
			session_id: session.id,
			organization_id: organizationId,
			resource_owner_user_id: fullUser,
			session_creator_user_id: runner,
			coding_agent: 'claude',
			source: 'claude_sdk_result',
			report_key: `report-runner-${randomUUID()}`,
			model: 'claude-sonnet-4-5',
			tokens: { input_tokens: 30, output_tokens: 15 },
			input_tokens: 30,
			output_tokens: 15,
			cost_usd: 3,
			occurred_at: BigInt(inRange),
		})
		await db.insert(commits).values({
			organization_id: organizationId,
			session_id: session.id,
			resource_owner_user_id: fullUser,
			commit_sha: commitSha,
			subject: 'commit on a colleague task',
			committed_at: BigInt(inRange),
			additions: 11,
			deletions: 2,
			files_changed: 1,
			capture_algorithm_version: 1,
			repo_full_name: 'acme/repo',
		})
		await db.insert(pullRequests).values({
			organization_id: organizationId,
			session_id: session.id,
			resource_owner_user_id: fullUser,
			repo_full_name: 'acme/repo',
			number: 99,
			attribution_method: 'committed',
			url: 'https://github.com/acme/repo/pull/99',
			title: 'pr on a colleague task',
			state: 'merged',
			head_ref: 'feature-99',
			author_is_bot: false,
			merged_at: BigInt(inRange),
		})
		try {
			const result = await call(apiRouter.metrics.usersScatter, metricsRange(), callContext())
			// Every axis of the dot names the same person: dollars, lines and PRs
			// all belong to the runner, even though the task owner is credited on
			// every captured row.
			expect(result.data.find((d) => d.userId === runner)).toMatchObject({
				costUsd: 3,
				inputTokens: 30,
				outputTokens: 15,
				locAdded: 11,
				locDeleted: 2,
				commitCount: 1,
				prsMerged: 1,
			})
			expect(result.data.find((d) => d.userId === fullUser)).toMatchObject({
				costUsd: 2.0,
				locAdded: 40,
				locDeleted: 10,
				commitCount: 1,
				prsMerged: 1,
			})
		} finally {
			await db.delete(pullRequests).where(eq(pullRequests.session_id, session.id))
			await db.delete(commits).where(eq(commits.commit_sha, commitSha))
			await db.delete(sessions).where(eq(sessions.id, session.id))
		}
	})

	test('known-human commits are excluded from repo options too', async () => {
		const result = await call(apiRouter.metrics.scatterFilterOptions, { timezoneOffset: 0 }, callContext())
		// acme/humans-only exists ONLY via the human-attributed commit — offering
		// it as a filter option would promise data the aggregates never contain.
		expect(result.repos).not.toContain('acme/humans-only')
	})

	test('filter options do NOT move with the range', async () => {
		// The whole point of splitting them out: filters persist across range
		// changes, so an option list that shrank with the range could drop an
		// option the user still had applied, leaving an empty scatter with no
		// visible cause. The endpoint takes no range, so there is nothing to move.
		const a = await call(apiRouter.metrics.scatterFilterOptions, { timezoneOffset: 0 }, callContext())
		const b = await call(apiRouter.metrics.scatterFilterOptions, { timezoneOffset: 0 }, callContext())
		expect(a).toEqual(b)
		expect(a.models).toEqual(['claude-haiku-4-5', 'claude-sonnet-4-5'])
	})

	test('models filter omitted or empty returns unfiltered usage aggregates', async () => {
		const omitted = await call(apiRouter.metrics.usersScatter, metricsRange(), callContext())
		const empty = await call(apiRouter.metrics.usersScatter, { ...metricsRange(), models: [] }, callContext())

		for (const result of [omitted, empty]) {
			const full = result.data.find((d) => d.userId === fullUser)
			expect(full).toMatchObject({ costUsd: 2.0, inputTokens: 1300, outputTokens: 650 })
		}
	})

	test('models filter narrows usage aggregates to the selected model', async () => {
		const result = await call(
			apiRouter.metrics.usersScatter,
			{ ...metricsRange(), models: ['claude-haiku-4-5'] },
			callContext(),
		)

		const full = result.data.find((d) => d.userId === fullUser)
		expect(full).toBeDefined()
		expect(full).toMatchObject({
			userId: fullUser,
			costUsd: 0.5,
			inputTokens: 300,
			outputTokens: 150,
			// Commits/PRs have no model — unaffected by the filter.
			locAdded: 40,
			locDeleted: 10,
			commitCount: 1,
			prsMerged: 1,
		})

		const usageOnly = result.data.find((d) => d.userId === usageOnlyUser)
		expect(usageOnly).toMatchObject({ costUsd: 0.25, inputTokens: 200, outputTokens: 100 })

		// Filtered calls skip the option lists (the UI reads options from its
		// unfiltered query only — see the contract).
	})

	test('a user whose usage is entirely filtered out but who has commits/PRs still appears with zeroed usage', async () => {
		const result = await call(
			apiRouter.metrics.usersScatter,
			{ ...metricsRange(), models: ['claude-sonnet-4-5'] },
			callContext(),
		)

		// fullUser has sonnet usage plus commits/PRs — stays, usage narrowed to sonnet only.
		const full = result.data.find((d) => d.userId === fullUser)
		expect(full).toMatchObject({
			costUsd: 1.5,
			inputTokens: 1000,
			outputTokens: 500,
			locAdded: 40,
			locDeleted: 10,
			commitCount: 1,
			prsMerged: 1,
		})

		// usageOnlyUser has ONLY haiku usage and no commits/PRs — filtered out entirely.
		expect(result.data.find((d) => d.userId === usageOnlyUser)).toBeUndefined()
	})

	test('defaults missing aggregates to zero for a user with only usage events', async () => {
		const result = await call(apiRouter.metrics.usersScatter, metricsRange(), callContext())

		const usageOnly = result.data.find((d) => d.userId === usageOnlyUser)
		expect(usageOnly).toBeDefined()
		expect(usageOnly).toMatchObject({
			userId: usageOnlyUser,
			costUsd: 0.25,
			inputTokens: 200,
			outputTokens: 100,
			locAdded: 0,
			locDeleted: 0,
			commitCount: 0,
			prsMerged: 0,
		})
	})

	test('agents filter narrows usage AND commits (NULL-agent commits excluded) while PRs are unaffected', async () => {
		const unfiltered = await call(apiRouter.metrics.usersScatter, metricsRange(), callContext())
		const mixedUnfiltered = unfiltered.data.find((d) => d.userId === mixedUser)
		expect(mixedUnfiltered).toMatchObject({
			costUsd: 10,
			inputTokens: 800,
			outputTokens: 120,
			locAdded: 114,
			locDeleted: 26,
			commitCount: 3,
			prsMerged: 2,
		})

		const result = await call(
			apiRouter.metrics.usersScatter,
			{ ...metricsRange(), agents: ['claude'] },
			callContext(),
		)
		const mixed = result.data.find((d) => d.userId === mixedUser)
		expect(mixed).toMatchObject({
			// codex usage row dropped.
			costUsd: 3,
			inputTokens: 100,
			outputTokens: 50,
			// codex commit AND the NULL-agent commit dropped.
			locAdded: 100,
			locDeleted: 20,
			commitCount: 1,
			// PRs carry no agent — unaffected.
			prsMerged: 2,
		})
	})

	test('repos filter narrows commits AND merged PRs while usage is unaffected', async () => {
		const result = await call(
			apiRouter.metrics.usersScatter,
			{ ...metricsRange(), repos: ['acme/repo'] },
			callContext(),
		)

		const mixed = result.data.find((d) => d.userId === mixedUser)
		expect(mixed).toMatchObject({
			// Usage has no repo linkage — unaffected.
			costUsd: 10,
			inputTokens: 800,
			outputTokens: 120,
			// acme/other commit dropped; the NULL-agent acme/repo commit stays.
			locAdded: 105,
			locDeleted: 25,
			commitCount: 2,
			// acme/other PR dropped.
			prsMerged: 1,
		})
	})

	test('agents and repos filters compose', async () => {
		const result = await call(
			apiRouter.metrics.usersScatter,
			{ ...metricsRange(), agents: ['claude'], repos: ['acme/repo'] },
			callContext(),
		)

		const mixed = result.data.find((d) => d.userId === mixedUser)
		expect(mixed).toMatchObject({
			costUsd: 3,
			locAdded: 100,
			locDeleted: 20,
			commitCount: 1,
			prsMerged: 1,
		})
	})

	test('filter options are unions across both source tables', async () => {
		const options = await call(apiRouter.metrics.scatterFilterOptions, { timezoneOffset: 0 }, callContext())
		// Agents: union of usage events and commits, NULL coding_agent dropped.
		expect(options.agents).toContain('claude')
		expect(options.agents).not.toContain(null as never)
		// Repos: union of commits and merged PRs, commits with NULL repo dropped.
		expect(options.repos).toContain('acme/repo')
		// A repo whose only merged PR is unattributed offers nothing to filter on.
		expect(options.repos).not.toContain('acme/unattributed-only')
		expect(options.repos.every((repo) => repo.length > 0)).toBe(true)
	})

	test('the options endpoint ignores the scatter filters entirely', async () => {
		// Options must never shrink to the current selection, or a filter could
		// not be widened again once applied. It takes no filters at all, which is
		// the strongest form of that guarantee.
		const options = await call(apiRouter.metrics.scatterFilterOptions, { timezoneOffset: 0 }, callContext())
		expect(options.models.length).toBeGreaterThan(1)
	})

	test('scopes to the caller organization', async () => {
		const otherOrgResult = await call(
			apiRouter.metrics.usersScatter,
			metricsRange(),
			callContext({ organizationId: otherOrgId }),
		)

		const full = otherOrgResult.data.find((d) => d.userId === fullUser)
		expect(full).toBeDefined()
		expect(full).toMatchObject({
			userId: fullUser,
			costUsd: 55,
			inputTokens: 555,
			outputTokens: 555,
			locAdded: 0,
			locDeleted: 0,
			commitCount: 0,
			prsMerged: 0,
		})

		// usageOnlyUser only exists in organizationId, never otherOrgId.
		expect(otherOrgResult.data.find((d) => d.userId === usageOnlyUser)).toBeUndefined()
	})

	test('is forbidden when the org is not entitled by billing — even for an admin', async () => {
		const [unbilledOrg] = await db
			.insert(organizations)
			.values({ name: 'Unbilled Metrics Org', workos_organization_id: `workos-org-${randomUUID()}` })
			.returning()
		if (!unbilledOrg) throw new Error('Unable to insert organization for setup')

		// The suite runs with enforcement off, which makes every org entitled. Turn it on for this
		// one call so the gate is actually exercised rather than short-circuited.
		process.env.IS_BILLING_ENFORCEMENT_ENABLED = 'true'
		try {
			await expect(
				call(apiRouter.metrics.usersScatter, metricsRange(), {
					context: createMockApiContext({
						auth: createMockApiAuth({
							userId: 'user_admin_scatter',
							organizationId: unbilledOrg.id,
							workosOrganizationId: 'workos-org-scatter',
							role: 'admin',
						}),
						services: { db, dbReadReplica: db },
					}),
				}),
			).rejects.toMatchObject({ code: 'FORBIDDEN' })
		} finally {
			process.env.IS_BILLING_ENFORCEMENT_ENABLED = 'false'
		}
	})

	test('non-admin members are forbidden — efficiency/ROI metrics are admin-only', async () => {
		await expect(
			call(apiRouter.metrics.usersScatter, metricsRange(), {
				context: createMockApiContext({
					auth: createMockApiAuth({
						userId: 'user_member_scatter',
						organizationId,
						workosOrganizationId: 'workos-org-scatter',
						role: 'member',
					}),
					services: { db, dbReadReplica: db },
				}),
			}),
		).rejects.toMatchObject({ code: 'FORBIDDEN' })
	})

	// The weekly endpoints share this file's fixtures so their counting rules
	// are asserted against the SAME seeded rows the scatter aggregates use —
	// the point being that card and trend can never drift apart.

	test('unitCostTrend applies the same known-human exclusion as the scatter aggregates', async () => {
		const result = await call(apiRouter.metrics.unitCostTrend, metricsRange(), callContext())

		const totals = result.data.reduce(
			(acc, week) => {
				acc.locChanged += week.locChanged
				acc.commitCount += week.commitCount
				acc.prsMerged += week.prsMerged
				return acc
			},
			{ locChanged: 0, commitCount: 0, prsMerged: 0 },
		)
		// Four non-human commits seeded in-range: 40/10 + 100/20 + 9/1 + 5/5 =
		// 190 changed lines. The 85,554-line known-human commit must be absent.
		expect(totals.locChanged).toBe(190)
		expect(totals.commitCount).toBe(4)
		// Merged PRs 1, 3 and 4 are committed; 2 is the bot's, 5 is only observed, 6 and 7 are
		// unattributed, so the same tier rule as the scatter leaves exactly three.
		expect(totals.prsMerged).toBe(3)
	})

	test('unitCostTrend returns one dense Monday-keyed bucket per week in the range', async () => {
		const result = await call(apiRouter.metrics.unitCostTrend, metricsRange(), callContext())
		expect(result.data).toHaveLength(4)
		for (const bucket of result.data) {
			expect(bucket.bucketStart).toMatch(/^\d{4}-\d{2}-\d{2}$/)
			expect(new Date(`${bucket.bucketStart}T00:00:00Z`).getUTCDay()).toBe(1)
			// A weekly response carries no lead-in: a weekly ratio already divides
			// a whole week of numerator by the same whole week of denominator.
			expect(bucket.inRange).toBe(true)
		}
		// The range is echoed back, so the card captions what it actually plots.
		expect(result.startDate).toBe(result.data[0]?.bucketStart)
	})

	test('unitCostTrend buckets by day and carries a marked trailing lead-in', async () => {
		const range = dailyMetricsRange(14)
		const result = await call(apiRouter.metrics.unitCostTrend, range, callContext())

		const plotted = result.data.filter((bucket) => bucket.inRange)
		const leadIn = result.data.filter((bucket) => !bucket.inRange)

		// 14 plotted days, plus exactly the six days a 7-day trailing ratio needs
		// to make its FIRST plotted point whole.
		expect(plotted).toHaveLength(14)
		expect(leadIn).toHaveLength(TRAILING_LEAD_IN_DAYS)

		// Lead-in comes first and is contiguous with the range, so a client can
		// run one trailing window straight through the array.
		expect(result.data.slice(0, TRAILING_LEAD_IN_DAYS)).toEqual(leadIn)
		expect(leadIn.at(-1)?.bucketStart).toBe(addDays(range.from, -1))
		expect(plotted[0]?.bucketStart).toBe(range.from)
		expect(plotted.at(-1)?.bucketStart).toBe(range.to)

		// startDate/endDate describe the SELECTION, never the wider read — the
		// whole reason the lead-in is flagged rather than silently included.
		expect(result.startDate).toBe(range.from)
		expect(result.endDate).toBe(range.to)
	})

	test('daily and weekly buckets over the same span sum to the same total', async () => {
		// Same seeded rows, two bucket sizes: bucketing changes the shape of the
		// answer, never its magnitude. A drift here means an off-by-one in a
		// range bound, which is invisible on any single chart.
		const weekly = await call(apiRouter.metrics.unitCostTrend, metricsRange({ weeks: 4 }), callContext())
		const daily = await call(apiRouter.metrics.unitCostTrend, dailyMetricsRange(28), callContext())

		const sumInRange = (rows: Array<{ inRange: boolean; locChanged: number }>) =>
			rows.filter((row) => row.inRange).reduce((total, row) => total + row.locChanged, 0)

		// The weekly preset starts on a Monday and the daily range starts 28 days
		// back, so they need not cover identical spans — compare what both cover.
		const sharedFrom = weekly.startDate > daily.startDate ? weekly.startDate : daily.startDate
		const within = (rows: typeof daily.data) => rows.filter((row) => row.bucketStart >= sharedFrom)
		expect(sumInRange(within(daily.data))).toBe(
			within(weekly.data.flatMap((row) => [row])).reduce((total, row) => total + row.locChanged, 0),
		)
	})

	test('a partial weekly bucket is refused at the API boundary', async () => {
		// Wednesday-to-Wednesday. The UI's brush cannot produce this, but a
		// hand-built request must not be able to smuggle it past either — the
		// no-partial-bucket guarantee is a property of the contract, not a habit
		// of the client.
		const range = metricsRange()
		await expect(
			call(apiRouter.metrics.unitCostTrend, { ...range, from: addDays(range.from, 2) }, callContext()),
		).rejects.toMatchObject({ code: 'BAD_REQUEST' })
	})

	test('rangeOverview reports the strip domain and the attribution floor', async () => {
		const result = await call(apiRouter.metrics.rangeOverview, { timezoneOffset: 0 }, callContext())

		// Dense over the whole strip: a quiet day is a zero bar, never a missing
		// one, or every handle position would be a day out.
		expect(result.days).toHaveLength(RANGE_HISTORY_DAYS)
		expect(result.days[0]?.date).toBe(result.earliestDate)
		expect(result.days.at(-1)?.date).toBe(result.latestDate)
		expect(result.earliestDate).toBe(addDays(result.latestDate, -(RANGE_HISTORY_DAYS - 1)))

		// The floor is dated from the earliest NON-HUMAN commit, so the fixture's
		// unattributed (NULL attribution_method) rows count — only positive
		// knowledge that a person wrote it excludes, exactly as every other
		// denominator on the page treats them. It lands on a real day inside the
		// strip, never in the future.
		expect(result.attributionStartDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
		// ISO day keys compare lexicographically, which is the same ordering the
		// brush uses to decide where a handle may go.
		const floor = result.attributionStartDate ?? ''
		expect(floor >= result.earliestDate && floor <= result.latestDate).toBe(true)
	})

	test('rangeOverview reports no floor for an org with no attributed output', async () => {
		// A different org entirely: with nothing to date the boundary from, the
		// brush must get an explicit null rather than a fabricated date, or it
		// would hatch a region that means nothing.
		const [emptyOrg] = await db
			.insert(organizations)
			.values({ name: 'No Attribution Org', workos_organization_id: `workos-org-${randomUUID()}` })
			.returning()
		if (!emptyOrg) throw new Error('Unable to insert organization for setup')

		const result = await call(
			apiRouter.metrics.rangeOverview,
			{ timezoneOffset: 0 },
			callContext({ organizationId: emptyOrg.id }),
		)
		expect(result.attributionStartDate).toBeNull()
		expect(result.days).toHaveLength(RANGE_HISTORY_DAYS)
	})

	test('agentCommitsByRepo counts only confirmed/inferred commits', async () => {
		const result = await call(apiRouter.metrics.agentCommitsByRepo, metricsRange(), callContext())
		// Every seeded commit is either unattributed (NULL) or known-human —
		// neither tier counts, so the adoption chart must be empty rather than
		// leaking legacy or human rows in as "agent commits".
		expect(result.data).toEqual([])
	})

	test('agentCommitsByRepo splits a repo into its confirmed and inferred tiers', async () => {
		// Inserted and removed INSIDE this test so the empty-result assertion
		// above and the trend/coverage line sums stay valid in any test order.
		const confirmedSha = `sha-tiers-confirmed-${randomUUID()}`
		const inferredSha = `sha-tiers-inferred-${randomUUID()}`
		const inRange = Date.now() - 5 * 24 * 60 * 60 * 1000
		await db.insert(commits).values([
			{
				organization_id: organizationId,
				resource_owner_user_id: fullUser,
				commit_sha: confirmedSha,
				subject: 'confirmed tier commit',
				committed_at: BigInt(inRange),
				additions: 3,
				deletions: 1,
				files_changed: 1,
				capture_algorithm_version: 2,
				attribution_method: 'confirmed',
				repo_full_name: 'acme/tiers',
			},
			{
				organization_id: organizationId,
				resource_owner_user_id: fullUser,
				commit_sha: inferredSha,
				subject: 'inferred tier commit',
				committed_at: BigInt(inRange),
				additions: 2,
				deletions: 2,
				files_changed: 1,
				capture_algorithm_version: 2,
				attribution_method: 'inferred',
				repo_full_name: 'acme/tiers',
			},
		])
		try {
			const result = await call(apiRouter.metrics.agentCommitsByRepo, metricsRange(), callContext())
			expect(result.data).toEqual([{ repoFullName: 'acme/tiers', confirmedCount: 1, inferredCount: 1 }])
		} finally {
			await db.delete(commits).where(inArray(commits.commit_sha, [confirmedSha, inferredSha]))
		}
	})

	test('costPerKlocByModel attributes BOTH sides of the ratio at session granularity', async () => {
		const result = await call(apiRouter.metrics.costPerKlocByModel, metricsRange(), callContext())

		const sumByModel = (model: string) =>
			result.data
				.filter((cell) => cell.model === model)
				.reduce(
					(acc, cell) => ({
						costUsd: acc.costUsd + cell.costUsd,
						locChanged: acc.locChanged + cell.locChanged,
						commitCount: acc.commitCount + cell.commitCount,
					}),
					{ costUsd: 0, locChanged: 0, commitCount: 0 },
				)

		// fullUserSession is sonnet-DOMINANT (its sonnet spend outweighs its
		// haiku row), so the session's entire in-window spend — including the
		// $0.50 haiku row — lands under sonnet, as do its 40/10 commit lines.
		// mixedUserSession (all sonnet) adds $10 and the three mixed commits.
		// The known-human commit has no session_id and is structurally absent.
		expect(sumByModel('claude-sonnet-4-5')).toEqual({ costUsd: 12, locChanged: 190, commitCount: 4 })

		// usageOnlySession is genuinely haiku-dominant: only its own $0.25 stays
		// under haiku, and with no commits its cells have no denominator.
		expect(sumByModel('claude-haiku-4-5')).toEqual({ costUsd: 0.25, locChanged: 0, commitCount: 0 })
		for (const cell of result.data.filter((c) => c.model === 'claude-haiku-4-5')) {
			expect(cell.costPerKloc).toBeNull()
		}
	})

	test('costPerKlocByModel coverage is dense over the window and excludes known-human lines from both sides', async () => {
		const result = await call(apiRouter.metrics.costPerKlocByModel, metricsRange(), callContext())
		expect(result.coverage).toHaveLength(4)

		const totals = result.coverage.reduce(
			(acc, week) => ({
				attributed: acc.attributed + week.attributedLocChanged,
				total: acc.total + week.totalLocChanged,
			}),
			{ attributed: 0, total: 0 },
		)
		// All four non-human commits carry a session_id (190 changed lines);
		// the 85,554-line known-human commit must appear in NEITHER count.
		expect(totals).toEqual({ attributed: 190, total: 190 })
		for (const week of result.coverage) {
			expect(week.coverage === null || week.coverage === 1).toBe(true)
		}
	})

	test('the weekly endpoints are forbidden for orgs not entitled by billing', async () => {
		const [unbilledOrg] = await db
			.insert(organizations)
			.values({ name: 'Unbilled Weekly Metrics Org', workos_organization_id: `workos-org-${randomUUID()}` })
			.returning()
		if (!unbilledOrg) throw new Error('Unable to insert organization for setup')
		const context = {
			context: createMockApiContext({
				auth: createMockApiAuth({
					userId: 'user_admin_scatter',
					organizationId: unbilledOrg.id,
					workosOrganizationId: 'workos-org-scatter',
					role: 'admin',
				}),
				services: { db, dbReadReplica: db },
			}),
		}

		process.env.IS_BILLING_ENFORCEMENT_ENABLED = 'true'
		try {
			await expect(call(apiRouter.metrics.unitCostTrend, metricsRange(), context)).rejects.toMatchObject({
				code: 'FORBIDDEN',
			})
			await expect(call(apiRouter.metrics.modelSpendTrend, metricsRange(), context)).rejects.toMatchObject({
				code: 'FORBIDDEN',
			})
			await expect(call(apiRouter.metrics.agentCommitsByRepo, metricsRange(), context)).rejects.toMatchObject({
				code: 'FORBIDDEN',
			})
			await expect(call(apiRouter.metrics.costPerKlocByModel, metricsRange(), context)).rejects.toMatchObject({
				code: 'FORBIDDEN',
			})
		} finally {
			process.env.IS_BILLING_ENFORCEMENT_ENABLED = 'false'
		}
	})
})
