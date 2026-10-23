import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'

import { organizationSettings } from '@humanlayer/db/tables/organization-settings'
import { organizations } from '@humanlayer/db/tables/organizations'
import { sessionUsageEvents } from '@humanlayer/db/tables/session-usage-events'
import type { SessionLabel } from '@humanlayer/db/tables/sessions'
import { sessions } from '@humanlayer/db/tables/sessions'
import { tasks } from '@humanlayer/db/tables/tasks'
import { call } from '@orpc/server'
import { eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { userModeSpendProcedure as liveUserModeSpendProcedure } from '../../src/orpc/api/metrics/userModeSpend.effect'
import { userStageSpendProcedure as liveUserStageSpendProcedure } from '../../src/orpc/api/metrics/userStageSpend.effect'
import { apiRouter } from '../../src/orpc/router'
import { createMockApiAuth, createMockApiContext } from '../mocks'
import { bindProcedureToRuntime, createRuntimeWithTestPostgresLayer } from '../utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../utils/external-test-services'
import { metricsRange } from '../utils/metrics-range'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('metrics/userStageSpend + metrics/userModeSpend', async () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	// The two cross-tabs are Effect procedures, so they resolve PersonSpendAnalytics
	// and the read-replica pool from a runtime rather than from context.services.
	// Binding them to a runtime built over the test database is what points them
	// at the rows this file inserts. Their non-Effect siblings
	// (stageSpendTrend/modeSpendTrend) still read context.services.dbReadReplica,
	// so they keep being called through apiRouter.
	let effectRuntime: ReturnType<typeof createRuntimeWithTestPostgresLayer> | undefined
	let userStageSpendProcedure: typeof liveUserStageSpendProcedure
	let userModeSpendProcedure: typeof liveUserModeSpendProcedure
	let organizationId: string
	let otherOrgId: string
	const hostId = randomUUID()

	const ALICE = `user_alice_${randomUUID()}`
	const BOB = `user_bob_${randomUUID()}`
	const CARLA = `user_carla_${randomUUID()}`
	const OUTSIDER = `user_outsider_${randomUUID()}`

	const callContext = (overrides: { organizationId?: string; role?: 'admin' | 'member' } = {}) => ({
		context: createMockApiContext({
			auth: createMockApiAuth({
				userId: 'user_admin_cross_tab',
				organizationId: overrides.organizationId ?? organizationId,
				workosOrganizationId: 'workos-org-cross-tab',
				role: overrides.role ?? 'admin',
			}),
			services: { db, dbReadReplica: db },
		}),
	})

	const createSession = async (
		orgId: string,
		ownerUserId: string,
		labels: SessionLabel[],
		taskId?: string,
		createdBy: string = ownerUserId,
	) => {
		const [session] = await db
			.insert(sessions)
			.values({
				organization_id: orgId,
				task_id: taskId,
				resource_owner_user_id: ownerUserId,
				created_by: createdBy,
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

	const createUsage = async (
		orgId: string,
		sessionId: string,
		ownerUserId: string,
		costUsd: number | null,
		occurredAt: number,
		createdBy: string = ownerUserId,
	) => {
		await db.insert(sessionUsageEvents).values({
			session_id: sessionId,
			organization_id: orgId,
			resource_owner_user_id: ownerUserId,
			session_creator_user_id: createdBy,
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
		const testDb = await createTestDb('metrics_user_cross_tab')
		cleanupTestDb = testDb.cleanup
		db = testDb.db
		effectRuntime = createRuntimeWithTestPostgresLayer(db)
		userStageSpendProcedure = bindProcedureToRuntime(liveUserStageSpendProcedure, effectRuntime)
		userModeSpendProcedure = bindProcedureToRuntime(liveUserModeSpendProcedure, effectRuntime)

		const [org] = await db
			.insert(organizations)
			.values({ name: 'Cross Tab Org', workos_organization_id: `workos-org-${randomUUID()}` })
			.returning()
		if (!org) throw new Error('Unable to insert organization for setup')
		organizationId = org.id
		const [otherOrg] = await db
			.insert(organizations)
			.values({ name: 'Other Cross Tab Org', workos_organization_id: `workos-org-${randomUUID()}` })
			.returning()
		if (!otherOrg) throw new Error('Unable to insert organization for setup')
		otherOrgId = otherOrg.id

		const now = Date.now()
		const dayMs = 24 * 60 * 60 * 1000
		const inRange = now - 5 * dayMs
		const outOfRange = now - 60 * dayMs

		const [oneshotTask] = await db
			.insert(tasks)
			.values({
				organization_id: organizationId,
				name: 'oneshot task',
				created_by: ALICE,
				resource_owner_user_id: ALICE,
				workflow_type: 'oneshot',
			})
			.returning()
		if (!oneshotTask) throw new Error('Unable to insert task for setup')

		// Alice: implementation on the oneshot task, plus unlabeled/task-less
		// work — so she is split across two stages AND two modes.
		const aliceImpl = await createSession(
			organizationId,
			ALICE,
			[{ name: 'rpi:implementation', title: 'implementation' }],
			oneshotTask.id,
		)
		await createUsage(organizationId, aliceImpl.id, ALICE, 3.0, inRange)
		// Out-of-window spend on the same session must not count.
		await createUsage(organizationId, aliceImpl.id, ALICE, 99.0, outOfRange)

		const aliceAdHoc = await createSession(organizationId, ALICE, [])
		await createUsage(organizationId, aliceAdHoc.id, ALICE, 1.0, inRange)

		// Bob owns both research sessions, but Carla launched the second one on
		// his task — the split must follow who RAN the session, not who owns it.
		const bobSession = await createSession(organizationId, BOB, [{ name: 'rpi:research', title: 'research' }])
		await createUsage(organizationId, bobSession.id, BOB, 2.0, inRange)
		const carlaOnBobsTask = await createSession(
			organizationId,
			BOB,
			[{ name: 'rpi:research', title: 'research' }],
			undefined,
			CARLA,
		)
		await createUsage(organizationId, carlaOnBobsTask.id, BOB, 0.25, inRange, CARLA)

		// A null cost must read as zero, not drop the person or poison the sum.
		const nullCostSession = await createSession(organizationId, CARLA, [])
		await createUsage(organizationId, nullCostSession.id, CARLA, null, inRange)

		const outsiderSession = await createSession(otherOrgId, OUTSIDER, [])
		await createUsage(otherOrgId, outsiderSession.id, OUTSIDER, 50.0, inRange)
	}, 30000)

	afterAll(async () => {
		await effectRuntime?.dispose()
		await cleanupTestDb?.()
	}, 30000)

	const sum = (data: Array<{ costUsd: number }>) => data.reduce((total, row) => total + row.costUsd, 0)
	const cell = (data: Array<Record<string, unknown>>, userId: string, key: string, bucket: string) =>
		data
			.filter((row) => row.userId === userId && row[key] === bucket)
			.reduce((total, row) => total + Number(row.costUsd), 0)

	test('userStageSpend cross-tabs by person and most-progressed label', async () => {
		const result = await call(userStageSpendProcedure, metricsRange(), callContext())

		expect(cell(result.data, ALICE, 'stage', 'rpi:implementation')).toBeCloseTo(3.0)
		expect(cell(result.data, ALICE, 'stage', 'no_stage')).toBeCloseTo(1.0)
		expect(cell(result.data, BOB, 'stage', 'rpi:research')).toBeCloseTo(2.0)
		// Carla's 0.25 was spent on a session Bob owns — attribution follows the
		// session creator, so it lands on Carla under research, not Bob.
		expect(cell(result.data, CARLA, 'stage', 'rpi:research')).toBeCloseTo(0.25)
		expect(result.data.some((row) => row.userId === OUTSIDER)).toBe(false)
	})

	test('userModeSpend cross-tabs by person and task workflow type', async () => {
		const result = await call(userModeSpendProcedure, metricsRange(), callContext())

		expect(cell(result.data, ALICE, 'mode', 'oneshot')).toBeCloseTo(3.0)
		expect(cell(result.data, ALICE, 'mode', 'freeform')).toBeCloseTo(1.0)
		expect(cell(result.data, BOB, 'mode', 'freeform')).toBeCloseTo(2.0)
		expect(cell(result.data, CARLA, 'mode', 'freeform')).toBeCloseTo(0.25)
	})

	test('every split of the Workflow tab totals the same dollars', async () => {
		// The invariant the whole tab rests on: four GROUP BYs over one set of
		// usage rows. The two ranked cards on top and the two cross-tabs below
		// must agree, or one of them is joining wrong.
		const range = metricsRange()
		const [byUserStage, byUserMode, byStage, byMode] = await Promise.all([
			call(userStageSpendProcedure, range, callContext()),
			call(userModeSpendProcedure, range, callContext()),
			call(apiRouter.metrics.stageSpendTrend, range, callContext()),
			call(apiRouter.metrics.modeSpendTrend, range, callContext()),
		])

		expect(sum(byUserStage.data)).toBeCloseTo(6.25)
		expect(sum(byUserMode.data)).toBeCloseTo(6.25)
		expect(sum(byStage.data)).toBeCloseTo(6.25)
		expect(sum(byMode.data)).toBeCloseTo(6.25)
	})

	test('a cross-tab column rolls up to the ranking above it', async () => {
		// What lets a reader drop from "research is X% of the org" straight to
		// "and here is who took it there".
		const range = metricsRange()
		const [byUserStage, byStage] = await Promise.all([
			call(userStageSpendProcedure, range, callContext()),
			call(apiRouter.metrics.stageSpendTrend, range, callContext()),
		])

		const columnTotal = byUserStage.data
			.filter((row) => row.stage === 'rpi:research')
			.reduce((total, row) => total + row.costUsd, 0)
		const rankedTotal = byStage.data
			.filter((row) => row.stage === 'rpi:research')
			.reduce((total, row) => total + row.costUsd, 0)

		expect(columnTotal).toBeCloseTo(rankedTotal)
		expect(columnTotal).toBeCloseTo(2.25)
	})

	test('cross-org spend never leaks', async () => {
		const theirs = await call(userStageSpendProcedure, metricsRange(), callContext({ organizationId: otherOrgId }))
		expect(sum(theirs.data)).toBeCloseTo(50.0)
		expect(theirs.data.every((row) => row.userId === OUTSIDER)).toBe(true)
	})

	test('a non-admin cannot read either procedure', async () => {
		// Per-person spend is the most sensitive split on the page; both are
		// gated by effectOrpcBaseForAdvancedMetrics, and an org that has not opted in
		// keeps them to its admins.
		const range = metricsRange()
		const member = callContext({ role: 'member' })
		await expect(call(userStageSpendProcedure, range, member)).rejects.toMatchObject({ code: 'FORBIDDEN' })
		await expect(call(userModeSpendProcedure, range, member)).rejects.toMatchObject({ code: 'FORBIDDEN' })
		await expect(call(apiRouter.metrics.stageSpendTrend, range, member)).rejects.toMatchObject({
			code: 'FORBIDDEN',
		})
	})

	test('a non-admin reads both once the org shares metrics with every member', async () => {
		const range = metricsRange()
		await db
			.insert(organizationSettings)
			.values({ organization_id: organizationId, advanced_metrics_visible_to_all_members: true })
			.onConflictDoUpdate({
				target: organizationSettings.organization_id,
				set: { advanced_metrics_visible_to_all_members: true },
			})

		try {
			const stage = await call(userStageSpendProcedure, range, callContext({ role: 'member' }))
			const mode = await call(userModeSpendProcedure, range, callContext({ role: 'member' }))
			expect(stage.data.length).toBeGreaterThan(0)
			expect(mode.data.length).toBeGreaterThan(0)

			// The classic and Effect bases mirror each other by hand, so the opt-in is asserted on
			// one procedure from each; a divergence between them would show up right here.
			const classic = await call(apiRouter.metrics.stageSpendTrend, range, callContext({ role: 'member' }))
			expect(classic).toBeDefined()
		} finally {
			await db
				.update(organizationSettings)
				.set({ advanced_metrics_visible_to_all_members: false })
				.where(eq(organizationSettings.organization_id, organizationId))
		}
	})
})
