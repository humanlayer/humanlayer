import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'

import { organizations } from '@humanlayer/db/tables/organizations'
import { sessionUsageEvents } from '@humanlayer/db/tables/session-usage-events'
import { sessions } from '@humanlayer/db/tables/sessions'
import { tasks } from '@humanlayer/db/tables/tasks'
import type { CodingAgent } from '@humanlayer/schemas/coding-agent'
import type { TaskWorkflowType } from '@humanlayer/schemas/effect/taskconfiguration/task-configuration'
import { call } from '@orpc/server'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { apiRouter } from '../../src/orpc/router'
import { createMockApiAuth, createMockApiContext } from '../mocks'
import { requireExternalTestServices } from '../utils/external-test-services'
import { metricsRange } from '../utils/metrics-range'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('metrics/tokenUseByTask + taskFanOut', async () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let organizationId: string
	let otherOrgId: string
	const hostId = randomUUID()
	const owner = `user_token_use_owner_${randomUUID()}`
	const secondPerson = `user_token_use_other_${randomUUID()}`

	const callContext = (overrides: { organizationId?: string } = {}) => ({
		context: createMockApiContext({
			auth: createMockApiAuth({
				userId: 'user_admin_token_use',
				organizationId: overrides.organizationId ?? organizationId,
				workosOrganizationId: 'workos-org-token-use',
				role: 'admin',
			}),
			services: { db, dbReadReplica: db },
		}),
	})

	const createTask = async (
		orgId: string,
		name: string,
		createdBy: string,
		ticketId?: string,
		// 'rpi' is the column default AND a real legacy value, so the tasks that
		// do not care about mode still assert something worth asserting.
		workflowType: TaskWorkflowType = 'rpi',
	) => {
		const [task] = await db
			.insert(tasks)
			.values({
				organization_id: orgId,
				name,
				created_by: createdBy,
				resource_owner_user_id: createdBy,
				ticket_id: ticketId,
				workflow_type: workflowType,
			})
			.returning()
		if (!task) throw new Error('Unable to insert task for setup')
		return task
	}

	/**
	 * `stages` are raw RPI label names. They go in as `{ name, title }` objects
	 * because that is the shape the daemon appends and the shape
	 * `mostProgressedStageSql` unnests — a bare string array reads as no stage
	 * at all. Only `name` is read by the SQL; `title` is carried to match the
	 * stored shape.
	 */
	const createSession = async (
		orgId: string,
		taskId: string,
		ownerId: string,
		stages: string[] = [],
		createdBy: string = ownerId,
	) => {
		const [session] = await db
			.insert(sessions)
			.values({
				organization_id: orgId,
				task_id: taskId,
				resource_owner_user_id: ownerId,
				created_by: createdBy,
				host_id: hostId,
				working_directory: tmpdir(),
				coding_agent: 'claude',
				status: 'ready_for_input',
				labels: stages.map((name) => ({ name, title: name.replace(/^rpi:/, '') })),
			})
			.returning()
		if (!session) throw new Error('Unable to insert session for setup')
		return session
	}

	/** One usage event. `tokens` is split across the four counters on purpose. */
	const createUsage = async (options: {
		orgId: string
		sessionId: string
		taskId: string
		ownerId: string
		createdBy?: string
		agent: CodingAgent
		model: string
		tokens: number
		costUsd: number
		occurredAt: number
	}) => {
		const input = Math.floor(options.tokens / 4)
		const output = Math.floor(options.tokens / 4)
		const cacheRead = Math.floor(options.tokens / 4)
		const cacheCreation = options.tokens - input - output - cacheRead
		await db.insert(sessionUsageEvents).values({
			session_id: options.sessionId,
			organization_id: options.orgId,
			resource_owner_user_id: options.ownerId,
			session_creator_user_id: options.createdBy ?? options.ownerId,
			task_id: options.taskId,
			coding_agent: options.agent,
			source: 'claude_sdk_result',
			report_key: `report-${randomUUID()}`,
			model: options.model,
			tokens: { input_tokens: input, output_tokens: output },
			input_tokens: input,
			output_tokens: output,
			cache_read_tokens: cacheRead,
			cache_creation_tokens: cacheCreation,
			cost_usd: options.costUsd,
			occurred_at: BigInt(options.occurredAt),
		})
	}

	beforeAll(async () => {
		const testDb = await createTestDb('metrics_token_use')
		cleanupTestDb = testDb.cleanup
		db = testDb.db

		const [org] = await db
			.insert(organizations)
			.values({ name: 'Token Use Org', workos_organization_id: `workos-org-${randomUUID()}` })
			.returning()
		if (!org) throw new Error('Unable to insert organization for setup')
		organizationId = org.id
		const [otherOrg] = await db
			.insert(organizations)
			.values({ name: 'Other Token Use Org', workos_organization_id: `workos-org-${randomUUID()}` })
			.returning()
		if (!otherOrg) throw new Error('Unable to insert organization for setup')
		otherOrgId = otherOrg.id

		const now = Date.now()
		const dayMs = 24 * 60 * 60 * 1000
		const inRange = now - 5 * dayMs
		const outOfRange = now - 60 * dayMs

		// HEAVY: most tokens, cheap per token. Two agents, two models, one person —
		// and TWO sessions carrying DIFFERENT RPI stages, which is what makes a
		// per-task stage split meaningful rather than a single 100% band. Its two
		// in-range events are deliberately one per session: splitting them this way
		// changes the stage mix without moving the task's totals, so every existing
		// assertion (and taskFanOut's token total) still holds.
		const heavy = await createTask(organizationId, '[ENG-1] heavy task', owner, 'ENG-1', 'prd_tdd')
		const heavySession = await createSession(organizationId, heavy.id, owner, [
			'rpi:research',
			'rpi:implementation',
		])
		const heavyResearchSession = await createSession(organizationId, heavy.id, owner, ['rpi:research'])
		await createUsage({
			orgId: organizationId,
			sessionId: heavySession.id,
			taskId: heavy.id,
			ownerId: owner,
			agent: 'codelayer',
			model: 'gpt-5.6',
			tokens: 8_000_000,
			costUsd: 4,
			occurredAt: inRange,
		})
		await createUsage({
			orgId: organizationId,
			sessionId: heavyResearchSession.id,
			taskId: heavy.id,
			ownerId: owner,
			agent: 'claude',
			model: 'claude-opus-5',
			tokens: 2_000_000,
			costUsd: 2,
			occurredAt: inRange,
		})
		// Out-of-window usage on the same task must never count.
		await createUsage({
			orgId: organizationId,
			sessionId: heavySession.id,
			taskId: heavy.id,
			ownerId: owner,
			agent: 'claude',
			model: 'claude-opus-5',
			tokens: 99_000_000,
			costUsd: 999,
			occurredAt: outOfRange,
		})

		// DEAR: fewer tokens than HEAVY but more money — the case that makes the
		// two rankings different populations rather than one list re-sorted.
		const dear = await createTask(organizationId, 'dear task', owner, undefined, 'oneshot')
		const dearSession = await createSession(organizationId, dear.id, owner, ['rpi:describe-pr'])
		await createUsage({
			orgId: organizationId,
			sessionId: dearSession.id,
			taskId: dear.id,
			ownerId: owner,
			agent: 'claude',
			model: 'claude-opus-5',
			tokens: 3_000_000,
			costUsd: 30,
			occurredAt: inRange,
		})

		// SHARED: owned by `owner`, every session launched by `secondPerson` → 2
		// contributors, and the spend belongs to the person who ran it.
		//
		// Its cost is split across two events that sum to a value float64 cannot
		// represent: 0.1 + 0.2 is 0.30000000000000004, and cost_usd is `double
		// precision`, so that is exactly what the driver hands back. It sits third
		// of four by cost, so the value becomes a real page cursor rather than a
		// terminal row — which is what makes it a regression test for the cursor
		// format rather than a decorative fixture.
		const shared = await createTask(organizationId, 'shared task', owner)
		const sharedSession = await createSession(organizationId, shared.id, owner, [], secondPerson)
		for (const costUsd of [0.1, 0.2]) {
			await createUsage({
				orgId: organizationId,
				sessionId: sharedSession.id,
				taskId: shared.id,
				ownerId: owner,
				createdBy: secondPerson,
				agent: 'codelayer',
				model: 'gpt-5.6',
				tokens: 500_000,
				costUsd,
				occurredAt: inRange,
			})
		}

		// TINY: one session, small enough to sit in a low histogram bin.
		const tiny = await createTask(organizationId, 'tiny task', owner)
		const tinySession = await createSession(organizationId, tiny.id, owner)
		await createUsage({
			orgId: organizationId,
			sessionId: tinySession.id,
			taskId: tiny.id,
			ownerId: owner,
			agent: 'codelayer',
			model: 'gpt-5.6',
			tokens: 10_000,
			costUsd: 0.05,
			occurredAt: inRange,
		})

		// Cross-org usage that must never leak into this org's numbers.
		const theirTask = await createTask(otherOrgId, 'their task', owner)
		const theirSession = await createSession(otherOrgId, theirTask.id, owner)
		await createUsage({
			orgId: otherOrgId,
			sessionId: theirSession.id,
			taskId: theirTask.id,
			ownerId: owner,
			agent: 'claude',
			model: 'claude-opus-5',
			tokens: 50_000_000,
			costUsd: 500,
			occurredAt: inRange,
		})
	}, 30000)

	afterAll(async () => {
		await cleanupTestDb?.()
	}, 30000)

	test('ranks by tokens, sums the four counters, and excludes out-of-window usage', async () => {
		const result = await call(
			apiRouter.metrics.tokenUseByTask,
			{ ...metricsRange(), measure: 'tokens', limit: 12 },
			callContext(),
		)

		expect(result.data[0]?.name).toBe('[ENG-1] heavy task')
		// 8M + 2M in range; the 99M out-of-window row is not counted.
		expect(result.data[0]?.tokens).toBe(10_000_000)
		expect(result.data[0]?.costUsd).toBeCloseTo(6)
		expect(result.data.map((row) => row.name)).toEqual([
			'[ENG-1] heavy task',
			'dear task',
			'shared task',
			'tiny task',
		])
	})

	test('the cost ranking is a different order, not the token list re-sorted', async () => {
		const byCost = await call(
			apiRouter.metrics.tokenUseByTask,
			{ ...metricsRange(), measure: 'cost', limit: 12 },
			callContext(),
		)

		// 'dear task' has a third of HEAVY's tokens and five times its cost.
		expect(byCost.data[0]?.name).toBe('dear task')
		expect(byCost.data[1]?.name).toBe('[ENG-1] heavy task')
	})

	test('reports the whole matched set, not the page', async () => {
		const result = await call(
			apiRouter.metrics.tokenUseByTask,
			{ ...metricsRange(), measure: 'tokens', limit: 1 },
			callContext(),
		)

		expect(result.data).toHaveLength(1)
		// The page is one row, but the totals still describe all four tasks:
		// heavy (10M) + dear (3M) + shared (1M) + tiny (10K).
		expect(result.matched.taskCount).toBe(4)
		expect(result.matched.tokens).toBe(14_010_000)
		// The bar scale is the range leader, so it survives paging.
		expect(result.maxValue).toBe(10_000_000)
	})

	test('paging walks the whole range exactly once and then stops', async () => {
		const seen: string[] = []
		let cursor: { value: number; taskId: string } | undefined

		// A page size of 1 forces four round trips, which is the point: it is the
		// tie-break and the cursor that are under test, not the LIMIT.
		for (let page = 0; page < 10; page++) {
			const result = await call(
				apiRouter.metrics.tokenUseByTask,
				{ ...metricsRange(), measure: 'tokens', limit: 1, ...(cursor ? { cursor } : {}) },
				callContext(),
			)
			seen.push(...result.data.map((row) => row.name))
			if (!result.nextCursor) break
			cursor = result.nextCursor
		}

		// Every task, in rank order, with nothing repeated and nothing dropped.
		expect(seen).toEqual(['[ENG-1] heavy task', 'dear task', 'shared task', 'tiny task'])
		expect(new Set(seen).size).toBe(seen.length)
	})

	test('a short page ends the scroll', async () => {
		const result = await call(
			apiRouter.metrics.tokenUseByTask,
			{ ...metricsRange(), measure: 'tokens', limit: 12 },
			callContext(),
		)

		expect(result.data).toHaveLength(4)
		expect(result.nextCursor).toBeNull()
	})

	test('a malformed cursor is rejected by the contract, not passed to Postgres', async () => {
		// Both halves have to be checked at the edge. A non-uuid id and a value
		// that does not fit the rank column each reach the query as a cast error
		// otherwise, which surfaces as a 500 rather than a bad request.
		const bad = [
			{ value: 100, taskId: 'not-a-uuid' },
			{ value: Number.NaN, taskId: randomUUID() },
			// Past the safe-integer range, so it could overflow the bigint cast.
			{ value: 1e30, taskId: randomUUID() },
		]

		for (const cursor of bad) {
			await expect(
				call(
					apiRouter.metrics.tokenUseByTask,
					{ ...metricsRange(), measure: 'tokens', limit: 1, cursor },
					callContext(),
				),
			).rejects.toThrow()
		}
	})

	test('a cost cursor survives a value that is not exactly representable', async () => {
		// cost_usd is double precision, so a sum of ordinary per-event costs lands
		// on values like 0.30000000000000004. An earlier revision shipped the
		// cursor as String(sum) behind a 10-decimal pattern, so the server minted
		// cursors its own contract rejected and the page 500'd on output
		// validation. This walks the whole cost ranking to prove it does not.
		const seen: string[] = []
		let cursor: { value: number; taskId: string } | undefined

		for (let page = 0; page < 10; page++) {
			const result = await call(
				apiRouter.metrics.tokenUseByTask,
				{ ...metricsRange(), measure: 'cost', limit: 1, ...(cursor ? { cursor } : {}) },
				callContext(),
			)
			seen.push(...result.data.map((row) => row.name))
			if (!result.nextCursor) break
			expect(typeof result.nextCursor.value).toBe('number')
			cursor = result.nextCursor
		}

		// Ranked by cost, not by tokens: 'dear task' has a third of HEAVY's
		// tokens and five times its cost.
		expect(seen).toEqual(['dear task', '[ENG-1] heavy task', 'shared task', 'tiny task'])
		expect(new Set(seen).size).toBe(seen.length)

		// The fixture really does produce the awkward value this guards against.
		const shared = await call(
			apiRouter.metrics.tokenUseByTask,
			{ ...metricsRange(), measure: 'cost', limit: 12, search: 'shared' },
			callContext(),
		)
		expect(String(shared.data[0]?.costUsd)).toBe('0.30000000000000004')
	})

	test('the search box is matched literally, not as a LIKE pattern', async () => {
		// Unescaped, '%' matches every task and '_' matches any character, so a
		// filter for a literal '100%' or 'a_b' would quietly return the wrong set.
		const wildcard = await call(
			apiRouter.metrics.tokenUseByTask,
			{ ...metricsRange(), measure: 'tokens', limit: 12, search: '%' },
			callContext(),
		)
		expect(wildcard.data).toEqual([])

		const underscore = await call(
			apiRouter.metrics.tokenUseByTask,
			{ ...metricsRange(), measure: 'tokens', limit: 12, search: 'dea_ task' },
			callContext(),
		)
		expect(underscore.data).toEqual([])
	})

	test('search matches the task name and the ticket id, over the whole range', async () => {
		const byName = await call(
			apiRouter.metrics.tokenUseByTask,
			{ ...metricsRange(), measure: 'tokens', limit: 12, search: 'DEAR' },
			callContext(),
		)
		expect(byName.data.map((row) => row.name)).toEqual(['dear task'])
		// The totals follow the filter, so the footer's "N of M" counts matches.
		expect(byName.matched.taskCount).toBe(1)
		expect(byName.matched.tokens).toBe(3_000_000)
		// …and so does the bar scale, or the one matching row would draw as a stub.
		expect(byName.maxValue).toBe(3_000_000)

		const byTicket = await call(
			apiRouter.metrics.tokenUseByTask,
			{ ...metricsRange(), measure: 'tokens', limit: 12, search: 'eng-1' },
			callContext(),
		)
		expect(byTicket.data.map((row) => row.name)).toEqual(['[ENG-1] heavy task'])
	})

	test('a search that matches nothing is empty, not an error', async () => {
		const result = await call(
			apiRouter.metrics.tokenUseByTask,
			{ ...metricsRange(), measure: 'tokens', limit: 12, search: 'zzzz-no-such-task' },
			callContext(),
		)

		expect(result.data).toEqual([])
		expect(result.nextCursor).toBeNull()
		expect(result.matched.taskCount).toBe(0)
		expect(result.maxValue).toBe(0)
	})

	test('splits a task by coding agent and reports its model count', async () => {
		const result = await call(
			apiRouter.metrics.tokenUseByTask,
			{ ...metricsRange(), measure: 'tokens', limit: 12 },
			callContext(),
		)

		const heavy = result.data.find((row) => row.name === '[ENG-1] heavy task')
		expect(heavy?.modelCount).toBe(2)
		expect(heavy?.agents).toEqual([
			{ agent: 'codelayer', tokens: 8_000_000, costUsd: 4 },
			{ agent: 'claude', tokens: 2_000_000, costUsd: 2 },
		])
	})

	test('splits a task by model, heaviest first', async () => {
		const result = await call(
			apiRouter.metrics.tokenUseByTask,
			{ ...metricsRange(), measure: 'tokens', limit: 12 },
			callContext(),
		)

		const heavy = result.data.find((row) => row.name === '[ENG-1] heavy task')
		expect(heavy?.models).toEqual([
			{ model: 'gpt-5.6', tokens: 8_000_000, costUsd: 4 },
			{ model: 'claude-opus-5', tokens: 2_000_000, costUsd: 2 },
		])
		// The per-model split partitions the same total the row reports.
		expect(heavy?.models.reduce((sum, entry) => sum + entry.tokens, 0)).toBe(heavy?.tokens)
	})

	test('the model split is not capped server-side, so the client can fold it', async () => {
		const result = await call(
			apiRouter.metrics.tokenUseByTask,
			{ ...metricsRange(), measure: 'tokens', limit: 12 },
			callContext(),
		)

		for (const row of result.data) {
			expect(row.models.length).toBe(row.modelCount)
		}
	})

	test('counts the task creator as a contributor alongside the session creator', async () => {
		const result = await call(
			apiRouter.metrics.tokenUseByTask,
			{ ...metricsRange(), measure: 'tokens', limit: 12 },
			callContext(),
		)

		// Created by `owner`, every session run by `secondPerson`.
		expect(result.data.find((row) => row.name === 'shared task')?.contributorCount).toBe(2)
		expect(result.data.find((row) => row.name === 'dear task')?.contributorCount).toBe(1)
	})

	/**
	 * This procedure USED to guarantee it returned no user identifier at all, and
	 * a test here pinned that. The by-person split needs per-person totals, so
	 * the ids now travel — under the same admin + Advanced Metrics gate that has
	 * served `userStageSpend` and `userModeSpend` since they shipped. What is
	 * asserted below is the boundary that replaced it, not the absence of one.
	 */
	test('contributors carry per-person totals that sum to the task', async () => {
		const result = await call(
			apiRouter.metrics.tokenUseByTask,
			{ ...metricsRange(), measure: 'tokens', limit: 12 },
			callContext(),
		)

		// Created by `owner`, every session run by `secondPerson`: the COUNT is 2
		// because it includes the creator, but only one person ever billed a
		// token, so there is exactly one contributor row.
		const shared = result.data.find((row) => row.name === 'shared task')
		expect(shared?.contributorCount).toBe(2)
		expect(shared?.contributors).toEqual([expect.objectContaining({ userId: secondPerson, tokens: 1_000_000 })])

		// Every task's split reconstructs its own total, so the bands of a bar
		// always fill it.
		for (const row of result.data) {
			expect(row.contributors.reduce((sum, entry) => sum + entry.tokens, 0)).toBe(row.tokens)
		}
	})

	test('taskFanOut still returns no user identifier', async () => {
		// The fan-out lens reports distributions, never people. Nothing about the
		// by-person split changes that.
		const result = await call(apiRouter.metrics.taskFanOut, metricsRange(), callContext())
		const payload = JSON.stringify(result)
		expect(payload).not.toContain(owner)
		expect(payload).not.toContain(secondPerson)
	})

	test('splits a task by RPI stage, most-progressed label per session', async () => {
		const result = await call(
			apiRouter.metrics.tokenUseByTask,
			{ ...metricsRange(), measure: 'tokens', limit: 12 },
			callContext(),
		)

		// Two sessions, two stages. The first carries BOTH 'rpi:research' and
		// 'rpi:implementation' and must resolve to the more progressed of the two,
		// which is what puts its 8M under implementation rather than research.
		const heavy = result.data.find((row) => row.name === '[ENG-1] heavy task')
		expect(heavy?.stages).toEqual([
			expect.objectContaining({ stage: 'rpi:implementation', tokens: 8_000_000 }),
			expect.objectContaining({ stage: 'rpi:research', tokens: 2_000_000 }),
		])

		// A session with no RPI label reports the sentinel rather than vanishing —
		// unattributed spend stays visible.
		const shared = result.data.find((row) => row.name === 'shared task')
		expect(shared?.stages).toEqual([expect.objectContaining({ stage: 'no_stage', tokens: 1_000_000 })])

		// Same whole-bar invariant as the contributor split.
		for (const row of result.data) {
			expect(row.stages.reduce((sum, entry) => sum + entry.tokens, 0)).toBe(row.tokens)
		}
	})

	test('carries the task mode through unmapped', async () => {
		const result = await call(
			apiRouter.metrics.tokenUseByTask,
			{ ...metricsRange(), measure: 'tokens', limit: 12 },
			callContext(),
		)

		expect(result.data.find((row) => row.name === '[ENG-1] heavy task')?.mode).toBe('prd_tdd')
		expect(result.data.find((row) => row.name === 'dear task')?.mode).toBe('oneshot')
		// The column default, and a real value in the wild — not an empty string.
		expect(result.data.find((row) => row.name === 'tiny task')?.mode).toBe('rpi')
	})

	test('taskFanOut buckets tasks by contributors, agents and models', async () => {
		const result = await call(apiRouter.metrics.taskFanOut, metricsRange(), callContext())

		expect(result.taskCount).toBe(4)
		expect(result.contributors).toEqual([
			expect.objectContaining({ count: 1, taskCount: 3 }),
			expect.objectContaining({ count: 2, taskCount: 1 }),
		])
		expect(result.agents).toEqual([
			expect.objectContaining({ count: 1, taskCount: 3 }),
			expect.objectContaining({ count: 2, taskCount: 1 }),
		])
		// Every dimension partitions the same tasks.
		expect(result.models.reduce((sum, bucket) => sum + bucket.taskCount, 0)).toBe(4)
		expect(result.tokens).toBe(14_010_000)
	})

	test('taskFanOut returns no user identifier either', async () => {
		const result = await call(apiRouter.metrics.taskFanOut, metricsRange(), callContext())
		const payload = JSON.stringify(result)
		expect(payload).not.toContain(owner)
		expect(payload).not.toContain(secondPerson)
	})

	test('cross-org usage never leaks', async () => {
		const mine = await call(
			apiRouter.metrics.tokenUseByTask,
			{ ...metricsRange(), measure: 'tokens', limit: 12 },
			callContext(),
		)
		expect(mine.data.map((row) => row.name)).not.toContain('their task')

		const theirs = await call(
			apiRouter.metrics.tokenUseByTask,
			{ ...metricsRange(), measure: 'tokens', limit: 12 },
			callContext({ organizationId: otherOrgId }),
		)
		expect(theirs.data).toHaveLength(1)
		expect(theirs.data[0]?.tokens).toBe(50_000_000)
	})
})
