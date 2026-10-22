import { randomUUID } from 'node:crypto'

import { conversationEvents } from '@humanlayer/db/tables/conversation-events'
import { organizations } from '@humanlayer/db/tables/organizations'
import { sessions } from '@humanlayer/db/tables/sessions'
import { tasks } from '@humanlayer/db/tables/tasks'
import { AutomationRunPrepareInputSchema } from '@humanlayer/riptide-api-contract/api/automation/run-prepare'
import { call } from '@orpc/server'
import { eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { exportPKCS8, generateKeyPair } from 'jose'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { lockActiveTaskSlugAllocation } from '../../src/db/task-slug-allocation'
import { automationRunPrepareProcedure as liveAutomationRunPrepareProcedure } from '../../src/orpc/api/automation-run-prepare.effect'
import { createMockApiAuth, createMockApiContext } from '../mocks'
import { bindProcedureToRuntime, createRuntimeWithTestPostgresLayer } from '../utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('automation.run.prepare', () => {
	let db: PostgresJsDatabase
	let cleanup: (() => Promise<void>) | undefined
	let effectRuntime: ReturnType<typeof createRuntimeWithTestPostgresLayer> | undefined
	let automationRunPrepareProcedure: typeof liveAutomationRunPrepareProcedure
	let organizationId: string
	const userId = 'automation-user'

	beforeAll(async () => {
		const testDb = await createTestDb('automation_prepare')
		db = testDb.db
		cleanup = testDb.cleanup
		effectRuntime = createRuntimeWithTestPostgresLayer(db)
		automationRunPrepareProcedure = bindProcedureToRuntime(liveAutomationRunPrepareProcedure, effectRuntime)
		const [organization] = await db
			.insert(organizations)
			.values({ name: 'Automation test', workos_organization_id: 'workos-automation-test' })
			.returning()
		if (!organization) throw new Error('Failed to create test organization')
		organizationId = organization.id

		const { privateKey } = await generateKeyPair('RS256', { extractable: true })
		process.env.RIPTIDE_DAEMON_TOKEN_PRIVATE_KEY = Buffer.from(await exportPKCS8(privateKey)).toString('base64')
	}, 60_000)

	afterAll(async () => {
		await effectRuntime?.dispose()
		await cleanup?.()
	}, 30_000)

	function context(actorUserId = userId) {
		return createMockApiContext({
			auth: createMockApiAuth({
				userId: actorUserId,
				organizationId,
				workosOrganizationId: 'workos-automation-test',
			}),
			services: { db, dbReadReplica: db },
		})
	}

	function ensureInput(slug: string, name: string) {
		return {
			taskMode: 'ensure' as const,
			slug,
			task: { name, workflowType: 'freeform' as const, worktreeTiming: 'never' as const },
			hostId: randomUUID(),
			sessionName: `Run ${name}`,
			prompt: `Implement ${name}`,
			workingDirectory: '/checkout',
			codingAgent: 'codelayer' as const,
			provider: 'anthropic',
			model: 'opus',
			permissionsMode: 'bypass' as const,
		}
	}

	test('concurrent ensures converge on one task and create distinct sessions', async () => {
		const slug = `concurrent-${randomUUID()}`
		const [first, second] = await Promise.all([
			call(automationRunPrepareProcedure, ensureInput(slug, 'First name'), { context: context() }),
			call(automationRunPrepareProcedure, ensureInput(slug, 'Ignored name'), { context: context() }),
		])

		expect(second.taskId).toBe(first.taskId)
		expect(second.sessionId).not.toBe(first.sessionId)
		const [task] = await db.select().from(tasks).where(eq(tasks.id, first.taskId))
		expect(task).toMatchObject({
			name: 'First name',
			workflow_type: 'freeform',
			worktree_timing: 'never',
		})
		expect(await db.select().from(sessions).where(eq(sessions.task_id, first.taskId))).toHaveLength(2)
	})

	test('creates the initial event atomically', async () => {
		const prepared = await call(automationRunPrepareProcedure, ensureInput(`event-${randomUUID()}`, 'Event task'), {
			context: context(),
		})

		const events = await db
			.select()
			.from(conversationEvents)
			.where(eq(conversationEvents.session_id, prepared.sessionId))
		expect(events).toEqual([
			expect.objectContaining({ role: 'user', content: 'Implement Event task', task_id: prepared.taskId }),
		])
	})

	test.each(['gpt-6-sol', 'gpt-6-luna'])('prepares a CodeLayer Codex %s automation run', async (model) => {
		const prepared = await call(
			automationRunPrepareProcedure,
			{
				...ensureInput(`codex-${model}-${randomUUID()}`, `Codex ${model}`),
				provider: 'codex',
				model,
				effort: 'max',
				fastMode: true,
			},
			{ context: context() },
		)

		const [session] = await db.select().from(sessions).where(eq(sessions.id, prepared.sessionId))
		expect(session).toMatchObject({ model, provider: 'codex', effort: 'max', fast_mode: true })
	})

	test('use selects an existing task without modifying it', async () => {
		const ensured = await call(
			automationRunPrepareProcedure,
			ensureInput(`use-${randomUUID()}`, 'Preserved task'),
			{ context: context() },
		)
		const used = await call(
			automationRunPrepareProcedure,
			{
				taskMode: 'use',
				taskIdOrSlug: ensured.taskId,
				hostId: randomUUID(),
				sessionName: 'Use run',
				prompt: 'Continue work',
				workingDirectory: '/checkout',
				codingAgent: 'codelayer',
				provider: 'anthropic',
				model: 'opus',
				permissionsMode: 'bypass',
			},
			{ context: context() },
		)

		expect(used.taskId).toBe(ensured.taskId)
		const [task] = await db.select().from(tasks).where(eq(tasks.id, ensured.taskId))
		expect(task?.name).toBe('Preserved task')
	})

	test('ensure preserves every existing task configuration field', async () => {
		const slug = `preserve-${randomUUID()}`
		const original = await call(
			automationRunPrepareProcedure,
			{
				...ensureInput(slug, 'Original task'),
				task: {
					name: 'Original task',
					workflowType: 'rpi',
					worktreeTiming: 'later',
					autoAdvanceResearchToDesign: true,
				},
			},
			{ context: context() },
		)
		await call(
			automationRunPrepareProcedure,
			{
				...ensureInput(slug, 'Replacement task'),
				task: {
					name: 'Replacement task',
					workflowType: 'freeform',
					worktreeTiming: 'never',
					autoAdvanceResearchToDesign: false,
				},
			},
			{ context: context() },
		)

		const [task] = await db.select().from(tasks).where(eq(tasks.id, original.taskId))
		expect(task).toMatchObject({
			name: 'Original task',
			workflow_type: 'rpi',
			worktree_timing: 'later',
			auto_advance_research_to_design: true,
		})
	})

	test('workspace specs materialize with effective now timing', async () => {
		const input = ensureInput(`workspace-${randomUUID()}`, 'Workspace task')
		const prepared = await call(
			automationRunPrepareProcedure,
			{
				...input,
				task: {
					name: 'Workspace task',
					workspaceSpec: {
						directory: 'workspace',
						workspaceBaseDirectory: '/tmp/workspaces',
						setupBlocksFirstSession: false,
						repos: [
							{
								localPath: '.',
								targetPath: 'repo',
								branch: 'main',
								sourceRef: 'main',
								copyGlobs: [],
								primary: true,
							},
						],
					},
				},
			},
			{ context: context() },
		)

		const [task] = await db.select().from(tasks).where(eq(tasks.id, prepared.taskId))
		expect(task?.worktree_timing).toBe('now')
		expect(task?.workspace_spec).not.toBeNull()
	})

	test('contract rejects workspace specs with incompatible worktree timing', () => {
		const parsed = AutomationRunPrepareInputSchema.safeParse({
			...ensureInput(`invalid-workspace-${randomUUID()}`, 'Invalid workspace'),
			task: {
				name: 'Invalid workspace',
				worktreeTiming: 'never',
				workspaceSpec: {
					directory: 'workspace',
					workspaceBaseDirectory: '/tmp/workspaces',
					setupBlocksFirstSession: false,
					repos: [
						{
							localPath: '.',
							targetPath: 'repo',
							branch: 'main',
							sourceRef: 'main',
							copyGlobs: [],
							primary: true,
						},
					],
				},
			},
		})

		expect(parsed.success).toBe(false)
	})

	test('maps a five-second advisory lock timeout to a retryable busy error', async () => {
		const slug = `busy-${randomUUID()}`
		let releaseLock!: () => void
		let lockAcquired!: () => void
		const release = new Promise<void>((resolve) => {
			releaseLock = resolve
		})
		const acquired = new Promise<void>((resolve) => {
			lockAcquired = resolve
		})
		const holder = db.transaction(async (tx) => {
			await lockActiveTaskSlugAllocation(tx, { organizationId, slug })
			lockAcquired()
			await release
		})

		await acquired
		try {
			await call(automationRunPrepareProcedure, ensureInput(slug, 'Busy task'), { context: context() })
			throw new Error('Expected preparation to time out waiting for the advisory lock')
		} catch (error) {
			expect(error).toMatchObject({
				code: 'AUTOMATION_PREPARATION_BUSY',
				status: 503,
				data: { retryAfterSeconds: 1 },
			})
		} finally {
			releaseLock()
			await holder
		}
	})
})
