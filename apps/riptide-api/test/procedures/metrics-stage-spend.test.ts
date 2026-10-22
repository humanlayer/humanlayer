import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'

import { organizations } from '@humanlayer/db/tables/organizations'
import { sessionUsageEvents } from '@humanlayer/db/tables/session-usage-events'
import type { SessionLabel } from '@humanlayer/db/tables/sessions'
import { sessions } from '@humanlayer/db/tables/sessions'
import { tasks } from '@humanlayer/db/tables/tasks'
import { call } from '@orpc/server'
import { sql } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { apiRouter } from '../../src/orpc/router'
import { createMockApiAuth, createMockApiContext } from '../mocks'
import { requireExternalTestServices } from '../utils/external-test-services'
import { metricsRange } from '../utils/metrics-range'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('metrics/stageSpendTrend + metrics/modeSpendTrend', async () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let organizationId: string
	let otherOrgId: string
	const hostId = randomUUID()
	const userId = `user_stage_spend_${randomUUID()}`

	const callContext = (overrides: { organizationId?: string } = {}) => ({
		context: createMockApiContext({
			auth: createMockApiAuth({
				userId: 'user_admin_stage_spend',
				organizationId: overrides.organizationId ?? organizationId,
				workosOrganizationId: 'workos-org-stage-spend',
				role: 'admin',
			}),
			services: { db, dbReadReplica: db },
		}),
	})

	const createSession = async (orgId: string, labels: SessionLabel[], taskId?: string) => {
		const [session] = await db
			.insert(sessions)
			.values({
				organization_id: orgId,
				task_id: taskId,
				resource_owner_user_id: userId,
				created_by: userId,
				host_id: hostId,
				working_directory: tmpdir(),
				coding_agent: 'claude',
				status: 'ready_for_input',
				labels,
			})
			.returning()
		if (!session) throw new Error('Unable to insert session for setup')
		return session
	}

	const createUsage = async (orgId: string, sessionId: string, costUsd: number, occurredAt: number) => {
		await db.insert(sessionUsageEvents).values({
			session_id: sessionId,
			organization_id: orgId,
			resource_owner_user_id: userId,
			session_creator_user_id: userId,
			coding_agent: 'claude',
			source: 'claude_sdk_result',
			report_key: `report-${randomUUID()}`,
			model: 'claude-sonnet-4-5',
			tokens: { input_tokens: 100, output_tokens: 50 },
			input_tokens: 100,
			output_tokens: 50,
			cost_usd: costUsd,
			occurred_at: BigInt(occurredAt),
		})
	}

	beforeAll(async () => {
		const testDb = await createTestDb('metrics_stage_spend')
		cleanupTestDb = testDb.cleanup
		db = testDb.db

		const [org] = await db
			.insert(organizations)
			.values({ name: 'Stage Spend Org', workos_organization_id: `workos-org-${randomUUID()}` })
			.returning()
		if (!org) throw new Error('Unable to insert organization for setup')
		organizationId = org.id
		const [otherOrg] = await db
			.insert(organizations)
			.values({ name: 'Other Stage Spend Org', workos_organization_id: `workos-org-${randomUUID()}` })
			.returning()
		if (!otherOrg) throw new Error('Unable to insert organization for setup')
		otherOrgId = otherOrg.id

		const now = Date.now()
		const dayMs = 24 * 60 * 60 * 1000
		const inRange = now - 5 * dayMs
		const outOfRange = now - 60 * dayMs // outside the 4-week window

		const [oneshotTask] = await db
			.insert(tasks)
			.values({
				organization_id: organizationId,
				name: 'oneshot task',
				created_by: userId,
				resource_owner_user_id: userId,
				workflow_type: 'oneshot',
			})
			.returning()
		if (!oneshotTask) throw new Error('Unable to insert task for setup')

		// Single-label session on the oneshot task — the clean 96% case.
		const implementSession = await createSession(
			organizationId,
			[{ name: 'rpi:implementation', title: 'implementation' }],
			oneshotTask.id,
		)
		await createUsage(organizationId, implementSession.id, 3.0, inRange)
		// Out-of-window spend on the same session must not count.
		await createUsage(organizationId, implementSession.id, 99.0, outOfRange)

		// Multi-label session — most-progressed label (implementation) must win
		// over research regardless of array order.
		const multiLabelSession = await createSession(organizationId, [
			{ name: 'rpi:implementation', title: 'implementation' },
			{ name: 'rpi:research', title: 'research' },
		])
		await createUsage(organizationId, multiLabelSession.id, 2.0, inRange)

		// Unlabeled session WITHOUT a task — no_stage spend under mode freeform.
		const unlabeledSession = await createSession(organizationId, [])
		await createUsage(organizationId, unlabeledSession.id, 1.25, inRange)

		// Pre-labels-era row: labels is a scalar jsonb, which jsonb_array_elements
		// would ERROR on without the typeof guard. Must count as no_stage, not crash.
		const scalarLabelsSession = await createSession(organizationId, [])
		await db.execute(sql`UPDATE sessions SET labels = '"legacy"'::jsonb WHERE id = ${scalarLabelsSession.id}`)
		await createUsage(organizationId, scalarLabelsSession.id, 0.5, inRange)

		// Cross-org spend with the same label — must never leak into the org's numbers.
		const otherOrgSession = await createSession(otherOrgId, [
			{ name: 'rpi:implementation', title: 'implementation' },
		])
		await createUsage(otherOrgId, otherOrgSession.id, 50.0, inRange)
	}, 30000)

	afterAll(async () => {
		await cleanupTestDb?.()
	}, 30000)

	const sumByStage = (data: Array<{ stage: string; costUsd: number }>) => {
		const totals = new Map<string, number>()
		for (const row of data) totals.set(row.stage, (totals.get(row.stage) ?? 0) + row.costUsd)
		return totals
	}

	test('stageSpendTrend groups spend by most-progressed label with a no_stage bucket', async () => {
		const result = await call(apiRouter.metrics.stageSpendTrend, metricsRange(), callContext())

		const totals = sumByStage(result.data)
		// 3.0 (single-label) + 2.0 (multi-label tie-break) — never split, never
		// attributed to research, and the 99.0 out-of-window row excluded.
		expect(totals.get('rpi:implementation')).toBeCloseTo(5.0)
		expect(totals.has('rpi:research')).toBe(false)
		// 1.25 (unlabeled) + 0.5 (scalar-labels guard case).
		expect(totals.get('no_stage')).toBeCloseTo(1.75)
	})

	test('modeSpendTrend splits by the task workflow type, task-less spend as freeform', async () => {
		const result = await call(apiRouter.metrics.modeSpendTrend, metricsRange(), callContext())

		const byMode = new Map<string, number>()
		for (const row of result.data) byMode.set(row.mode, (byMode.get(row.mode) ?? 0) + row.costUsd)

		// Only the single-label session sits on the oneshot task.
		expect(byMode.get('oneshot')).toBeCloseTo(3.0)
		// Everything else is task-less: 2.0 multi-label + 1.25 unlabeled + 0.5 scalar-labels.
		expect(byMode.get('freeform')).toBeCloseTo(3.75)
		// Modes partition the same total the stage card splits.
		expect(result.data.reduce((sum, row) => sum + row.costUsd, 0)).toBeCloseTo(6.75)
	})

	test('cross-org spend never leaks', async () => {
		const mine = await call(apiRouter.metrics.stageSpendTrend, metricsRange(), callContext())
		const total = mine.data.reduce((sum, row) => sum + row.costUsd, 0)
		expect(total).toBeCloseTo(6.75)

		const theirs = await call(
			apiRouter.metrics.stageSpendTrend,
			metricsRange(),
			callContext({ organizationId: otherOrgId }),
		)
		expect(theirs.data.reduce((sum, row) => sum + row.costUsd, 0)).toBeCloseTo(50.0)
	})
})
