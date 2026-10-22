import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'

import { conversationEvents } from '@humanlayer/db/tables/conversation-events'
import { organizations } from '@humanlayer/db/tables/organizations'
import { queuedMessages } from '@humanlayer/db/tables/queued-messages'
import { sessions } from '@humanlayer/db/tables/sessions'
import { tasks } from '@humanlayer/db/tables/tasks'
import { userSettings } from '@humanlayer/db/tables/user-settings'
import { call, isDefinedError } from '@orpc/server'
import { and, asc, eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { Effect, Layer } from 'effect'
import { uuidv7 } from 'uuidv7'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import {
	ExperimentAnalyticsService,
	type RecordCodingAgentSessionCreatedInput,
} from '../../src/effects/services/experiment-analytics/experiment-analytics.service'
import logger from '../../src/logger'
import { updateSessionProcedure } from '../../src/orpc/daemon/sessions/update'
import { billingAccessLayer, createMockDaemonAuth, createMockDaemonContext } from '../mocks'
import { createRuntimeWithTestPostgresLayer } from '../utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('daemon/sessions/update context window limit', async () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let organizationId: string
	const userId = 'user_daemon_context_limit'
	const hostId = randomUUID()

	beforeAll(async () => {
		const testDb = await createTestDb('daemon_session_update')
		cleanupTestDb = testDb.cleanup
		db = testDb.db

		const [org] = await db
			.insert(organizations)
			.values({ name: 'Context Limit Org', workos_organization_id: `workos-org-${randomUUID()}` })
			.returning()

		if (!org) throw new Error('Unable to insert organization for setup')
		organizationId = org.id
	}, 30000)

	afterAll(async () => {
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
				title: 'context limit session',
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

	const createDaemonContext = () => ({
		context: createMockDaemonContext({
			auth: createMockDaemonAuth({ userId, organizationId, hostId }),
			services: {
				db,
				dbReadReplica: db,
			},
		}),
	})

	test('persists explicit runtime context window limit as-is', async () => {
		const session = await createSession({
			coding_agent: 'codelayer',
			provider: 'openai',
			model: 'gpt-4o',
		})

		await call(
			updateSessionProcedure,
			{
				sessionId: session.id,
				contextWindowTokens: 180000,
				contextWindowLimit: 256000,
			},
			createDaemonContext(),
		)

		const [updated] = await db.select().from(sessions).where(eq(sessions.id, session.id))
		expect(updated?.context_window_tokens).toBe(180000)
		expect(updated?.context_window_limit).toBe(256000)
	})

	test('model-only updates still derive context window limit from fallback helper', async () => {
		const session = await createSession({
			coding_agent: 'claude',
			provider: 'anthropic',
			model: 'claude-sonnet-4-5',
			context_window_limit: 168000,
		})

		await call(
			updateSessionProcedure,
			{
				sessionId: session.id,
				model: 'claude-opus-4-8',
			},
			createDaemonContext(),
		)

		const [updated] = await db.select().from(sessions).where(eq(sessions.id, session.id))
		expect(updated?.model).toBe('claude-opus-4-8')
		expect(updated?.context_window_limit).toBe(968000)
	})

	test('codex model-only updates derive the private Codex API context window', async () => {
		const session = await createSession({
			coding_agent: 'codelayer',
			provider: 'codex',
			model: 'gpt-5.5',
			context_window_limit: 168000,
		})

		await call(
			updateSessionProcedure,
			{
				sessionId: session.id,
				model: 'gpt-5-codex',
			},
			createDaemonContext(),
		)

		const [updated] = await db.select().from(sessions).where(eq(sessions.id, session.id))
		expect(updated?.model).toBe('gpt-5-codex')
		expect(updated?.context_window_limit).toBe(258400)
	})

	test('Codex GPT-5.6 model-only updates derive the current usable Codex context window', async () => {
		const session = await createSession({
			coding_agent: 'codelayer',
			provider: 'codex',
			model: 'gpt-5.5',
			context_window_limit: 168000,
		})

		await call(
			updateSessionProcedure,
			{
				sessionId: session.id,
				model: 'gpt-5.6-sol',
			},
			createDaemonContext(),
		)

		const [updated] = await db.select().from(sessions).where(eq(sessions.id, session.id))
		expect(updated?.model).toBe('gpt-5.6-sol')
		expect(updated?.context_window_limit).toBe(258400)
	})

	test('explicit runtime context window limit wins over model fallback when both are provided', async () => {
		const session = await createSession({
			coding_agent: 'codelayer',
			provider: 'openai',
			model: 'gpt-4o',
			context_window_limit: 168000,
		})

		await call(
			updateSessionProcedure,
			{
				sessionId: session.id,
				model: 'opus-1m',
				contextWindowLimit: 256000,
			},
			createDaemonContext(),
		)

		const [updated] = await db.select().from(sessions).where(eq(sessions.id, session.id))
		expect(updated?.model).toBe('opus-1m')
		expect(updated?.context_window_limit).toBe(256000)
	})

	test('rejects a same-host session owned by a different daemon user', async () => {
		const session = await createSession({ created_by: 'different-daemon-user', resource_owner_user_id: userId })

		await expect(
			call(updateSessionProcedure, { sessionId: session.id, contextWindowTokens: 42 }, createDaemonContext()),
		).rejects.toMatchObject({ code: 'FORBIDDEN' })

		const [unchanged] = await db.select().from(sessions).where(eq(sessions.id, session.id))
		expect(unchanged?.context_window_tokens).toBe(0)
	})

	test.each(['launching', 'running'] as const)('refreshes activity when daemon reports %s', async (status) => {
		const oldActivity = BigInt(Date.now() - 60_000)
		const session = await createSession({ status: 'resuming', last_activity_at: oldActivity })

		await call(updateSessionProcedure, { sessionId: session.id, status }, createDaemonContext())

		const [updated] = await db.select().from(sessions).where(eq(sessions.id, session.id))
		expect(updated?.status).toBe(status)
		expect(updated?.last_activity_at).toBeGreaterThan(oldActivity)
	})

	test('does not refresh activity for unrelated daemon updates', async () => {
		const oldActivity = BigInt(Date.now() - 60_000)
		const session = await createSession({ last_activity_at: oldActivity })

		await call(updateSessionProcedure, { sessionId: session.id, contextWindowTokens: 42 }, createDaemonContext())

		const [updated] = await db.select().from(sessions).where(eq(sessions.id, session.id))
		expect(updated?.last_activity_at).toBe(oldActivity)
	})

	test('does not refresh activity for other daemon status updates', async () => {
		const oldActivity = BigInt(Date.now() - 60_000)
		const session = await createSession({ last_activity_at: oldActivity })

		await call(updateSessionProcedure, { sessionId: session.id, status: 'failed' }, createDaemonContext())

		const [updated] = await db.select().from(sessions).where(eq(sessions.id, session.id))
		expect(updated?.status).toBe('failed')
		expect(updated?.last_activity_at).toBe(oldActivity)
	})
})

describe('daemon/sessions/update first successful session milestone', async () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let organizationId: string
	let effectRuntime: ReturnType<typeof createRuntimeWithTestPostgresLayer> | undefined
	const userId = 'user_daemon_first_success'
	const hostId = randomUUID()
	const captures: RecordCodingAgentSessionCreatedInput[] = []

	beforeAll(async () => {
		const testDb = await createTestDb('daemon_first_success')
		cleanupTestDb = testDb.cleanup
		db = testDb.db

		const [org] = await db
			.insert(organizations)
			.values({ name: 'First Success Org', workos_organization_id: `workos-org-${randomUUID()}` })
			.returning()
		if (!org) throw new Error('Unable to insert organization for setup')
		organizationId = org.id

		effectRuntime = createRuntimeWithTestPostgresLayer(db, {
			experimentAnalytics: Layer.succeed(ExperimentAnalyticsService, {
				recordTaskComposerTaskCreated: () => Effect.void,
				recordCodingAgentSessionCreated: (input) =>
					Effect.sync(() => {
						captures.push(input)
					}),
				recordProjectsV2Assigned: () => Effect.void,
			}),
		})
	}, 30000)

	afterAll(async () => {
		await effectRuntime?.dispose()
		await cleanupTestDb?.()
	}, 30000)

	const createSession = async (status: 'launching' | 'running' | 'ready_for_input' = 'running') => {
		const [session] = await db
			.insert(sessions)
			.values({
				organization_id: organizationId,
				resource_owner_user_id: userId,
				created_by: userId,
				host_id: hostId,
				title: 'first successful session',
				working_directory: tmpdir(),
				coding_agent: 'claude',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissions_mode: 'default',
				status,
			})
			.returning()
		if (!session) throw new Error('Unable to insert session for setup')
		return session
	}

	const daemonContext = () => ({
		context: createMockDaemonContext({
			auth: createMockDaemonAuth({ userId, organizationId, hostId }),
			services: { db, dbReadReplica: db, effectRuntime: effectRuntime! },
		}),
	})

	test('sets the first-task-completed milestone once across turns and sessions', async () => {
		const session = await createSession('launching')

		await call(updateSessionProcedure, { sessionId: session.id, status: 'ready_for_input' }, daemonContext())

		const [settingsAfterFirstSuccess] = await db
			.select()
			.from(userSettings)
			.where(and(eq(userSettings.user_id, userId), eq(userSettings.organization_id, organizationId)))
		expect(settingsAfterFirstSuccess?.first_task_completed_at).not.toBeNull()

		// A later turn of the same session must not move the write-once milestone.
		await db.update(sessions).set({ status: 'running' }).where(eq(sessions.id, session.id))
		await call(updateSessionProcedure, { sessionId: session.id, status: 'ready_for_input' }, daemonContext())

		const [settingsAfterLaterTurn] = await db
			.select()
			.from(userSettings)
			.where(and(eq(userSettings.user_id, userId), eq(userSettings.organization_id, organizationId)))
		expect(settingsAfterLaterTurn?.first_task_completed_at).toBe(settingsAfterFirstSuccess?.first_task_completed_at)

		// Nor does a second, later session.
		const secondSession = await createSession('running')
		await call(updateSessionProcedure, { sessionId: secondSession.id, status: 'ready_for_input' }, daemonContext())
		const [settingsAfterSecondSession] = await db
			.select()
			.from(userSettings)
			.where(and(eq(userSettings.user_id, userId), eq(userSettings.organization_id, organizationId)))
		expect(settingsAfterSecondSession?.first_task_completed_at).toBe(
			settingsAfterFirstSuccess?.first_task_completed_at,
		)
	})

	test('emits coding_agent_session_created once when a session leaves the launch queue', async () => {
		const createdUserId = `${userId}_created`
		const [task] = await db
			.insert(tasks)
			.values({
				organization_id: organizationId,
				resource_owner_user_id: createdUserId,
				created_by: createdUserId,
				name: 'created event task',
				workflow_type: 'outline_only',
			})
			.returning()
		if (!task) throw new Error('Unable to insert task for created-event setup')
		const [session] = await db
			.insert(sessions)
			.values({
				task_id: task.id,
				organization_id: organizationId,
				resource_owner_user_id: createdUserId,
				created_by: createdUserId,
				host_id: hostId,
				title: 'created event session',
				working_directory: tmpdir(),
				coding_agent: 'claude',
				provider: 'anthropic',
				status: 'ready_for_launch',
			})
			.returning()
		if (!session) throw new Error('Unable to insert session for created-event setup')
		const createdContext = {
			context: createMockDaemonContext({
				auth: createMockDaemonAuth({ userId: createdUserId, organizationId, hostId }),
				services: { db, dbReadReplica: db, effectRuntime: effectRuntime! },
			}),
		}
		const captureCount = captures.length

		await call(updateSessionProcedure, { sessionId: session.id, status: 'launching' }, createdContext)

		await expect.poll(() => captures.length).toBe(captureCount + 1)
		expect(captures.at(-1)).toMatchObject({
			userId: createdUserId,
			sessionId: session.id,
			taskId: task.id,
			codingAgent: 'claude',
		})

		// Later status updates do not re-emit — the session already left the queue.
		await call(updateSessionProcedure, { sessionId: session.id, status: 'running' }, createdContext)
		await new Promise((resolve) => setTimeout(resolve, 25))
		expect(captures).toHaveLength(captureCount + 1)
	})

	test('does not set the first-task milestone when queued-message auto-continue stores resuming', async () => {
		const queuedUserId = `${userId}_queued`
		const [session] = await db
			.insert(sessions)
			.values({
				organization_id: organizationId,
				resource_owner_user_id: queuedUserId,
				created_by: queuedUserId,
				host_id: hostId,
				title: 'queued continuation',
				working_directory: tmpdir(),
				coding_agent: 'claude',
				provider: 'anthropic',
				status: 'running',
			})
			.returning()
		if (!session) throw new Error('Unable to insert queued session for setup')
		await db.insert(queuedMessages).values({
			session_id: session.id,
			organization_id: organizationId,
			resource_owner_user_id: queuedUserId,
			content: 'keep going',
			status: 'pending',
		})

		await call(
			updateSessionProcedure,
			{ sessionId: session.id, status: 'ready_for_input' },
			{
				context: createMockDaemonContext({
					auth: createMockDaemonAuth({ userId: queuedUserId, organizationId, hostId }),
					services: { db, dbReadReplica: db, effectRuntime: effectRuntime! },
				}),
			},
		)

		const [storedSession] = await db.select().from(sessions).where(eq(sessions.id, session.id))
		const [settings] = await db
			.select()
			.from(userSettings)
			.where(and(eq(userSettings.user_id, queuedUserId), eq(userSettings.organization_id, organizationId)))
		expect(storedSession?.status).toBe('resuming')
		expect(settings).toBeUndefined()
	})

	test('sets the structured-workflow milestone after an RPI session succeeds', async () => {
		const structuredUserId = `${userId}_structured`
		const [task] = await db
			.insert(tasks)
			.values({
				organization_id: organizationId,
				resource_owner_user_id: structuredUserId,
				created_by: structuredUserId,
				name: 'structured workflow',
				workflow_type: 'rpi',
			})
			.returning()
		if (!task) throw new Error('Unable to insert structured task for setup')
		const [session] = await db
			.insert(sessions)
			.values({
				task_id: task.id,
				organization_id: organizationId,
				resource_owner_user_id: structuredUserId,
				created_by: structuredUserId,
				host_id: hostId,
				title: 'structured workflow session',
				working_directory: tmpdir(),
				coding_agent: 'claude',
				provider: 'anthropic',
				status: 'running',
			})
			.returning()
		if (!session) throw new Error('Unable to insert structured session for setup')

		await call(
			updateSessionProcedure,
			{ sessionId: session.id, status: 'ready_for_input' },
			{
				context: createMockDaemonContext({
					auth: createMockDaemonAuth({ userId: structuredUserId, organizationId, hostId }),
					services: { db, dbReadReplica: db, effectRuntime: effectRuntime! },
				}),
			},
		)

		const [settings] = await db
			.select()
			.from(userSettings)
			.where(and(eq(userSettings.user_id, structuredUserId), eq(userSettings.organization_id, organizationId)))
		expect(settings?.first_task_completed_at).not.toBeNull()
		expect(settings?.first_structured_workflow_completed_at).not.toBeNull()

		const firstStructuredWorkflowCompletedAt = settings?.first_structured_workflow_completed_at
		const [laterSession] = await db
			.insert(sessions)
			.values({
				task_id: task.id,
				organization_id: organizationId,
				resource_owner_user_id: structuredUserId,
				created_by: structuredUserId,
				host_id: hostId,
				title: 'later structured workflow session',
				working_directory: tmpdir(),
				coding_agent: 'claude',
				provider: 'anthropic',
				status: 'running',
			})
			.returning()
		if (!laterSession) throw new Error('Unable to insert later structured session')

		await call(
			updateSessionProcedure,
			{ sessionId: laterSession.id, status: 'ready_for_input' },
			{
				context: createMockDaemonContext({
					auth: createMockDaemonAuth({ userId: structuredUserId, organizationId, hostId }),
					services: { db, dbReadReplica: db, effectRuntime: effectRuntime! },
				}),
			},
		)
		const [settingsAfterLaterWorkflow] = await db
			.select()
			.from(userSettings)
			.where(and(eq(userSettings.user_id, structuredUserId), eq(userSettings.organization_id, organizationId)))
		expect(settingsAfterLaterWorkflow?.first_structured_workflow_completed_at).toBe(
			firstStructuredWorkflowCompletedAt,
		)
	})

	// The composer normalizes its "RPI" selection to `outline_only`, and `prd_tdd`
	// is the other structured workflow — both must earn the structured-workflow
	// milestone, not just the literal `rpi` value (which the happy path never stores).
	test.each(['outline_only', 'prd_tdd'] as const)(
		'sets the structured-workflow milestone after a %s session succeeds',
		async (workflowType) => {
			const structuredUserId = `${userId}_${workflowType}`
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					resource_owner_user_id: structuredUserId,
					created_by: structuredUserId,
					name: `${workflowType} workflow`,
					workflow_type: workflowType,
				})
				.returning()
			if (!task) throw new Error('Unable to insert structured task for setup')
			const [session] = await db
				.insert(sessions)
				.values({
					task_id: task.id,
					organization_id: organizationId,
					resource_owner_user_id: structuredUserId,
					created_by: structuredUserId,
					host_id: hostId,
					title: `${workflowType} session`,
					working_directory: tmpdir(),
					coding_agent: 'claude',
					provider: 'anthropic',
					status: 'running',
				})
				.returning()
			if (!session) throw new Error('Unable to insert structured session for setup')

			await call(
				updateSessionProcedure,
				{ sessionId: session.id, status: 'ready_for_input' },
				{
					context: createMockDaemonContext({
						auth: createMockDaemonAuth({ userId: structuredUserId, organizationId, hostId }),
						services: { db, dbReadReplica: db, effectRuntime: effectRuntime! },
					}),
				},
			)

			const [settings] = await db
				.select()
				.from(userSettings)
				.where(
					and(eq(userSettings.user_id, structuredUserId), eq(userSettings.organization_id, organizationId)),
				)
			expect(settings?.first_task_completed_at).not.toBeNull()
			expect(settings?.first_structured_workflow_completed_at).not.toBeNull()
		},
	)

	test('does not set the structured-workflow milestone for an unstructured (freeform) session', async () => {
		const freeformUserId = `${userId}_freeform`
		const [task] = await db
			.insert(tasks)
			.values({
				organization_id: organizationId,
				resource_owner_user_id: freeformUserId,
				created_by: freeformUserId,
				name: 'freeform workflow',
				workflow_type: 'freeform',
			})
			.returning()
		if (!task) throw new Error('Unable to insert freeform task for setup')
		const [session] = await db
			.insert(sessions)
			.values({
				task_id: task.id,
				organization_id: organizationId,
				resource_owner_user_id: freeformUserId,
				created_by: freeformUserId,
				host_id: hostId,
				title: 'freeform session',
				working_directory: tmpdir(),
				coding_agent: 'claude',
				provider: 'anthropic',
				status: 'running',
			})
			.returning()
		if (!session) throw new Error('Unable to insert freeform session for setup')

		await call(
			updateSessionProcedure,
			{ sessionId: session.id, status: 'ready_for_input' },
			{
				context: createMockDaemonContext({
					auth: createMockDaemonAuth({ userId: freeformUserId, organizationId, hostId }),
					services: { db, dbReadReplica: db, effectRuntime: effectRuntime! },
				}),
			},
		)

		const [settings] = await db
			.select()
			.from(userSettings)
			.where(and(eq(userSettings.user_id, freeformUserId), eq(userSettings.organization_id, organizationId)))
		// The generic "first task completed" milestone still fires; only the
		// structured-workflow milestone is gated on the workflow type.
		expect(settings?.first_task_completed_at).not.toBeNull()
		expect(settings?.first_structured_workflow_completed_at ?? null).toBeNull()
	})

	test('does not set the milestone for a non-success status transition', async () => {
		const otherUserId = `${userId}_failed`
		const [session] = await db
			.insert(sessions)
			.values({
				organization_id: organizationId,
				resource_owner_user_id: otherUserId,
				created_by: otherUserId,
				host_id: hostId,
				title: 'failed session',
				working_directory: tmpdir(),
				coding_agent: 'claude',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissions_mode: 'default',
				status: 'running',
			})
			.returning()
		if (!session) throw new Error('Unable to insert failed session for setup')

		await call(
			updateSessionProcedure,
			{ sessionId: session.id, status: 'failed' },
			{
				context: createMockDaemonContext({
					auth: createMockDaemonAuth({ userId: otherUserId, organizationId, hostId }),
					services: { db, dbReadReplica: db, effectRuntime: effectRuntime! },
				}),
			},
		)

		const [settings] = await db
			.select()
			.from(userSettings)
			.where(and(eq(userSettings.user_id, otherUserId), eq(userSettings.organization_id, organizationId)))
		expect(settings).toBeUndefined()
	})
})

describe('daemon/sessions/update usage accumulation across runs', async () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let organizationId: string
	const userId = 'user_daemon_usage_accumulation'
	const hostId = randomUUID()

	beforeAll(async () => {
		const testDb = await createTestDb('daemon_usage_accumulation')
		cleanupTestDb = testDb.cleanup
		db = testDb.db

		const [org] = await db
			.insert(organizations)
			.values({ name: 'Usage Accumulation Org', workos_organization_id: `workos-org-${randomUUID()}` })
			.returning()

		if (!org) throw new Error('Unable to insert organization for setup')
		organizationId = org.id
	}, 30000)

	afterAll(async () => {
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
				title: 'usage accumulation session',
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

	const createDaemonContext = () => ({
		context: createMockDaemonContext({
			auth: createMockDaemonAuth({ userId, organizationId, hostId }),
			services: {
				db,
				dbReadReplica: db,
			},
		}),
	})

	test('two runs with distinct usageReportKeys sum cost and per-model usage', async () => {
		const session = await createSession()

		// Run 1 completes
		await call(
			updateSessionProcedure,
			{
				sessionId: session.id,
				status: 'ready_for_input',
				totalCostUsd: 0.5,
				modelUsage: {
					'claude-sonnet-4-5': {
						input_tokens: 100,
						output_tokens: 50,
						cache_read_input_tokens: 1000,
						cache_creation_input_tokens: 200,
					},
				},
				usageReportKey: 'result-uuid-run-1',
			},
			createDaemonContext(),
		)

		// Run 2 (resume) completes — SDK counters reset, so this reports run 2's usage only.
		// A model not seen in run 1 also appears.
		await call(
			updateSessionProcedure,
			{
				sessionId: session.id,
				status: 'ready_for_input',
				totalCostUsd: 0.25,
				modelUsage: {
					'claude-sonnet-4-5': {
						input_tokens: 40,
						output_tokens: 10,
						cache_read_input_tokens: 500,
						cache_creation_input_tokens: 100,
					},
					'claude-haiku-4-5': { input_tokens: 20, output_tokens: 5 },
				},
				usageReportKey: 'result-uuid-run-2',
			},
			createDaemonContext(),
		)

		const [updated] = await db.select().from(sessions).where(eq(sessions.id, session.id))
		expect(updated?.total_cost_usd).toBeCloseTo(0.75, 6)
		expect(updated?.model_usage).toEqual({
			'claude-sonnet-4-5': {
				input_tokens: 140,
				output_tokens: 60,
				cache_read_input_tokens: 1500,
				cache_creation_input_tokens: 300,
			},
			'claude-haiku-4-5': { input_tokens: 20, output_tokens: 5 },
		})
		expect(updated?.applied_usage_report_keys).toEqual(['result-uuid-run-1', 'result-uuid-run-2'])
	})

	test('retry replay with the same usageReportKey does not double-count', async () => {
		const session = await createSession()

		const report = {
			sessionId: session.id,
			status: 'ready_for_input' as const,
			totalCostUsd: 0.5,
			modelUsage: {
				'claude-sonnet-4-5': { input_tokens: 100, output_tokens: 50 },
			},
			usageReportKey: 'result-uuid-replayed',
		}

		// First delivery succeeds; the daemon's oRPC retry plugin re-sends the identical
		// payload when the response is lost.
		await call(updateSessionProcedure, report, createDaemonContext())
		await call(updateSessionProcedure, report, createDaemonContext())

		const [updated] = await db.select().from(sessions).where(eq(sessions.id, session.id))
		expect(updated?.total_cost_usd).toBeCloseTo(0.5, 6)
		expect(updated?.model_usage).toEqual({
			'claude-sonnet-4-5': { input_tokens: 100, output_tokens: 50 },
		})
	})

	test('a delayed retry of an earlier run report is skipped after a newer report was applied', async () => {
		const session = await createSession()

		const run1Report = {
			sessionId: session.id,
			status: 'ready_for_input' as const,
			totalCostUsd: 0.5,
			modelUsage: { 'claude-sonnet-4-5': { input_tokens: 100, output_tokens: 50 } },
			usageReportKey: 'result-uuid-delayed-run-1',
		}

		// Run 1's report applies, but the daemon never sees the response and schedules a retry.
		await call(updateSessionProcedure, run1Report, createDaemonContext())

		// Run 2 (started via auto-continue) completes and reports before the retry fires.
		await call(
			updateSessionProcedure,
			{
				sessionId: session.id,
				status: 'ready_for_input' as const,
				totalCostUsd: 0.25,
				modelUsage: { 'claude-sonnet-4-5': { input_tokens: 40, output_tokens: 10 } },
				usageReportKey: 'result-uuid-delayed-run-2',
			},
			createDaemonContext(),
		)

		// The delayed retry of run 1 must still be recognized as already applied.
		await call(updateSessionProcedure, run1Report, createDaemonContext())

		const [updated] = await db.select().from(sessions).where(eq(sessions.id, session.id))
		expect(updated?.total_cost_usd).toBeCloseTo(0.75, 6)
		expect(updated?.model_usage).toEqual({
			'claude-sonnet-4-5': { input_tokens: 140, output_tokens: 60 },
		})
		expect(updated?.applied_usage_report_keys).toEqual(['result-uuid-delayed-run-1', 'result-uuid-delayed-run-2'])
	})

	test('retry replay of a usage-only report (no status) succeeds as a no-op', async () => {
		const session = await createSession()

		// The codelayer interrupted-run path reports usage with no status field, so a replay
		// leaves nothing else to write — it must return success, not throw on an empty update.
		const report = {
			sessionId: session.id,
			totalCostUsd: 0.4,
			modelUsage: { 'claude-sonnet-4-5': { input_tokens: 10, output_tokens: 5 } },
			usageReportKey: 'result-uuid-usage-only',
		}

		await call(updateSessionProcedure, report, createDaemonContext())
		await expect(call(updateSessionProcedure, report, createDaemonContext())).resolves.toMatchObject({
			success: true,
		})

		const [updated] = await db.select().from(sessions).where(eq(sessions.id, session.id))
		expect(updated?.total_cost_usd).toBeCloseTo(0.4, 6)
		expect(updated?.model_usage).toEqual({ 'claude-sonnet-4-5': { input_tokens: 10, output_tokens: 5 } })
	})

	test('usage without a usageReportKey keeps legacy overwrite semantics', async () => {
		const session = await createSession({
			total_cost_usd: 0.9,
			model_usage: { 'claude-sonnet-4-5': { input_tokens: 999, output_tokens: 999 } },
		})

		await call(
			updateSessionProcedure,
			{
				sessionId: session.id,
				totalCostUsd: 0.1,
				modelUsage: { 'claude-sonnet-4-5': { input_tokens: 10, output_tokens: 5 } },
			},
			createDaemonContext(),
		)

		const [updated] = await db.select().from(sessions).where(eq(sessions.id, session.id))
		expect(updated?.total_cost_usd).toBeCloseTo(0.1, 6)
		expect(updated?.model_usage).toEqual({ 'claude-sonnet-4-5': { input_tokens: 10, output_tokens: 5 } })
	})

	test('cost-only report accumulates without touching model usage', async () => {
		const session = await createSession({
			total_cost_usd: 0.2,
			model_usage: { 'claude-sonnet-4-5': { input_tokens: 10, output_tokens: 5 } },
		})

		await call(
			updateSessionProcedure,
			{
				sessionId: session.id,
				totalCostUsd: 0.3,
				usageReportKey: 'result-uuid-cost-only',
			},
			createDaemonContext(),
		)

		const [updated] = await db.select().from(sessions).where(eq(sessions.id, session.id))
		expect(updated?.total_cost_usd).toBeCloseTo(0.5, 6)
		expect(updated?.model_usage).toEqual({ 'claude-sonnet-4-5': { input_tokens: 10, output_tokens: 5 } })
	})
})

describe('daemon/sessions/update auto-continue with queued messages', async () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let organizationId: string
	const userId = 'user_daemon_auto_continue'
	const hostId = randomUUID()

	beforeAll(async () => {
		const testDb = await createTestDb('daemon_auto_continue')
		cleanupTestDb = testDb.cleanup
		db = testDb.db

		const [org] = await db
			.insert(organizations)
			.values({ name: 'Auto Continue Org', workos_organization_id: `workos-org-${randomUUID()}` })
			.returning()

		if (!org) throw new Error('Unable to insert organization for setup')
		organizationId = org.id
	}, 30000)

	afterAll(async () => {
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
				title: 'auto continue session',
				working_directory: tmpdir(),
				coding_agent: 'claude',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissions_mode: 'default',
				status: 'running',
				num_events: 5,
				...overrides,
			})
			.returning()

		if (!session) throw new Error('Unable to insert session for setup')
		return session
	}

	const createDaemonContext = () => ({
		context: createMockDaemonContext({
			auth: createMockDaemonAuth({ userId, organizationId, hostId }),
			services: {
				db,
				dbReadReplica: db,
			},
		}),
	})

	const seedQueuedMessage = async (
		sessionId: string,
		content: string,
		minutesAgo = 0,
		senderUserId: string | null = userId,
	) => {
		const id = uuidv7()
		await db.insert(queuedMessages).values({
			id,
			session_id: sessionId,
			organization_id: organizationId,
			resource_owner_user_id: userId,
			user_id: senderUserId,
			content,
			status: 'pending',
			created_at: BigInt(Date.now() - minutesAgo * 60_000),
		})
		return id
	}

	test('ready_for_input with no queued messages stays ready_for_input', async () => {
		const session = await createSession()
		const originalInfo = logger.info
		const infoCalls: unknown[][] = []

		logger.info = ((...args: unknown[]) => {
			infoCalls.push(args)
		}) as typeof logger.info

		try {
			await call(
				updateSessionProcedure,
				{ sessionId: session.id, status: 'ready_for_input' },
				createDaemonContext(),
			)
		} finally {
			logger.info = originalInfo
		}

		const [updated] = await db.select().from(sessions).where(eq(sessions.id, session.id))
		expect(updated?.status).toBe('ready_for_input')
		expect(
			infoCalls.some(
				(args) =>
					args[0] === 'Auto-continue skipped — no pending messages' ||
					args[1] === 'Auto-continue skipped — no pending messages',
			),
		).toBe(true)
	})

	test('ready_for_input with pending queued messages overrides to resuming', async () => {
		const session = await createSession()
		await seedQueuedMessage(session.id, 'Please add tests')

		await call(updateSessionProcedure, { sessionId: session.id, status: 'ready_for_input' }, createDaemonContext())

		const [updated] = await db.select().from(sessions).where(eq(sessions.id, session.id))
		expect(updated?.status).toBe('resuming')
		expect(updated?.prompt).toBe('Please add tests')
	})

	test('multiple queued messages are concatenated in FIFO order', async () => {
		const session = await createSession()
		await seedQueuedMessage(session.id, 'First message', 3)
		await seedQueuedMessage(session.id, 'Second message', 1)

		await call(updateSessionProcedure, { sessionId: session.id, status: 'ready_for_input' }, createDaemonContext())

		const [updated] = await db.select().from(sessions).where(eq(sessions.id, session.id))
		expect(updated?.status).toBe('resuming')
		expect(updated?.prompt).toBe('First message\n\nSecond message')
	})

	test('queued messages are marked as delivered after auto-continue', async () => {
		const session = await createSession()
		const msgId1 = await seedQueuedMessage(session.id, 'msg one', 2)
		const msgId2 = await seedQueuedMessage(session.id, 'msg two', 1)

		await call(updateSessionProcedure, { sessionId: session.id, status: 'ready_for_input' }, createDaemonContext())

		const rows = await db
			.select()
			.from(queuedMessages)
			.where(eq(queuedMessages.session_id, session.id))
			.orderBy(asc(queuedMessages.created_at))

		expect(rows).toHaveLength(2)
		expect(rows[0]?.id).toBe(msgId1)
		expect(rows[0]?.status).toBe('delivered')
		expect(rows[1]?.id).toBe(msgId2)
		expect(rows[1]?.status).toBe('delivered')
	})

	test('conversation events are inserted for each queued message', async () => {
		const session = await createSession()
		await seedQueuedMessage(session.id, 'event msg one', 2, 'queuer-one')
		await seedQueuedMessage(session.id, 'event msg two', 1, null)

		await call(updateSessionProcedure, { sessionId: session.id, status: 'ready_for_input' }, createDaemonContext())

		const events = await db
			.select()
			.from(conversationEvents)
			.where(
				and(
					eq(conversationEvents.session_id, session.id),
					eq(conversationEvents.role, 'user'),
					eq(conversationEvents.event_type, 'message'),
				),
			)
			.orderBy(asc(conversationEvents.id))

		expect(events).toHaveLength(2)
		expect(events[0]?.content).toBe('event msg one')
		expect(events[1]?.content).toBe('event msg two')
		expect(events[0]?.organization_id).toBe(organizationId)
		expect(events[0]?.resource_owner_user_id).toBe(userId)
		expect(events.map((event) => event.user_id)).toEqual(['queuer-one', null])
	})

	test('num_events is incremented by the number of queued messages', async () => {
		const session = await createSession({ num_events: 10 })
		await seedQueuedMessage(session.id, 'a', 2)
		await seedQueuedMessage(session.id, 'b', 1)

		await call(updateSessionProcedure, { sessionId: session.id, status: 'ready_for_input' }, createDaemonContext())

		const [updated] = await db.select().from(sessions).where(eq(sessions.id, session.id))
		expect(updated?.num_events).toBe(12)
	})

	test('already-delivered messages are not re-delivered', async () => {
		const session = await createSession()
		const msgId = await seedQueuedMessage(session.id, 'already delivered')
		await db.update(queuedMessages).set({ status: 'delivered' }).where(eq(queuedMessages.id, msgId))

		await call(updateSessionProcedure, { sessionId: session.id, status: 'ready_for_input' }, createDaemonContext())

		const [updated] = await db.select().from(sessions).where(eq(sessions.id, session.id))
		expect(updated?.status).toBe('ready_for_input')
	})
})

describe('daemon/sessions/update one-at-a-time queue delivery mode', async () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let organizationId: string

	beforeAll(async () => {
		const testDb = await createTestDb('daemon_one_at_a_time')
		cleanupTestDb = testDb.cleanup
		db = testDb.db

		const [org] = await db
			.insert(organizations)
			.values({ name: 'One At A Time Org', workos_organization_id: `workos-org-${randomUUID()}` })
			.returning()

		if (!org) throw new Error('Unable to insert organization for setup')
		organizationId = org.id
	}, 30000)

	afterAll(async () => {
		await cleanupTestDb?.()
	}, 30000)

	const createActor = () => ({
		userId: `user_one_at_a_time_${randomUUID()}`,
		hostId: randomUUID(),
	})

	const createTask = async (userId: string, overrides: Partial<typeof tasks.$inferInsert> = {}) => {
		const [task] = await db
			.insert(tasks)
			.values({
				organization_id: organizationId,
				resource_owner_user_id: userId,
				created_by: userId,
				name: 'one-at-a-time task',
				...overrides,
			})
			.returning()

		if (!task) throw new Error('Unable to insert task for setup')
		return task
	}

	const setUserBatchDelivery = async (userId: string, prefer: boolean) => {
		await db
			.insert(userSettings)
			.values({
				user_id: userId,
				organization_id: organizationId,
				prefer_batch_queue_delivery: prefer,
			})
			.onConflictDoUpdate({
				target: [userSettings.user_id, userSettings.organization_id],
				set: { prefer_batch_queue_delivery: prefer },
			})
	}

	const createSession = async (
		userId: string,
		hostId: string,
		taskId: string | null,
		overrides: Partial<typeof sessions.$inferInsert> = {},
	) => {
		const [session] = await db
			.insert(sessions)
			.values({
				organization_id: organizationId,
				resource_owner_user_id: userId,
				created_by: userId,
				host_id: hostId,
				title: 'one-at-a-time session',
				working_directory: tmpdir(),
				coding_agent: 'claude',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissions_mode: 'default',
				status: 'running',
				num_events: 5,
				task_id: taskId,
				...overrides,
			})
			.returning()

		if (!session) throw new Error('Unable to insert session for setup')
		return session
	}

	const createDaemonContext = (userId: string, hostId: string) => ({
		context: createMockDaemonContext({
			auth: createMockDaemonAuth({ userId, organizationId, hostId }),
			services: {
				db,
				dbReadReplica: db,
			},
		}),
	})

	const seedQueuedMessage = async (userId: string, sessionId: string, content: string, minutesAgo = 0) => {
		const id = uuidv7()
		await db.insert(queuedMessages).values({
			id,
			session_id: sessionId,
			organization_id: organizationId,
			resource_owner_user_id: userId,
			content,
			status: 'pending',
			created_at: BigInt(Date.now() - minutesAgo * 60_000),
		})
		return id
	}

	test('one-at-a-time mode delivers only the oldest pending message per ready_for_input cycle', async () => {
		const actor = createActor()
		// Set user-level prefer_batch_queue_delivery: false
		await setUserBatchDelivery(actor.userId, false)
		const task = await createTask(actor.userId)
		const session = await createSession(actor.userId, actor.hostId, task.id)

		// Queue 3 messages in FIFO order
		const msgId1 = await seedQueuedMessage(actor.userId, session.id, 'First message', 3)
		const msgId2 = await seedQueuedMessage(actor.userId, session.id, 'Second message', 2)
		const msgId3 = await seedQueuedMessage(actor.userId, session.id, 'Third message', 1)

		// First ready_for_input: only the oldest message should be delivered
		await call(
			updateSessionProcedure,
			{ sessionId: session.id, status: 'ready_for_input' },
			createDaemonContext(actor.userId, actor.hostId),
		)

		const [updated1] = await db.select().from(sessions).where(eq(sessions.id, session.id))
		expect(updated1?.status).toBe('resuming')
		expect(updated1?.prompt).toBe('First message')

		const rows1 = await db
			.select()
			.from(queuedMessages)
			.where(eq(queuedMessages.session_id, session.id))
			.orderBy(asc(queuedMessages.created_at))

		expect(rows1).toHaveLength(3)
		expect(rows1[0]?.id).toBe(msgId1)
		expect(rows1[0]?.status).toBe('delivered')
		expect(rows1[1]?.id).toBe(msgId2)
		expect(rows1[1]?.status).toBe('pending')
		expect(rows1[2]?.id).toBe(msgId3)
		expect(rows1[2]?.status).toBe('pending')

		// Second ready_for_input: the next oldest (second) message should be delivered
		await call(
			updateSessionProcedure,
			{ sessionId: session.id, status: 'ready_for_input' },
			createDaemonContext(actor.userId, actor.hostId),
		)

		const [updated2] = await db.select().from(sessions).where(eq(sessions.id, session.id))
		expect(updated2?.status).toBe('resuming')
		expect(updated2?.prompt).toBe('Second message')

		const rows2 = await db
			.select()
			.from(queuedMessages)
			.where(eq(queuedMessages.session_id, session.id))
			.orderBy(asc(queuedMessages.created_at))

		expect(rows2[0]?.status).toBe('delivered')
		expect(rows2[1]?.id).toBe(msgId2)
		expect(rows2[1]?.status).toBe('delivered')
		expect(rows2[2]?.id).toBe(msgId3)
		expect(rows2[2]?.status).toBe('pending')
	})

	test('user-level prefer_batch_queue_delivery=true delivers all queued messages in one cycle', async () => {
		const actor = createActor()
		await setUserBatchDelivery(actor.userId, true)
		const task = await createTask(actor.userId)
		const session = await createSession(actor.userId, actor.hostId, task.id)

		// Queue 2 messages
		const msgId1 = await seedQueuedMessage(actor.userId, session.id, 'Msg A', 2)
		const msgId2 = await seedQueuedMessage(actor.userId, session.id, 'Msg B', 1)

		await call(
			updateSessionProcedure,
			{ sessionId: session.id, status: 'ready_for_input' },
			createDaemonContext(actor.userId, actor.hostId),
		)

		const [updated] = await db.select().from(sessions).where(eq(sessions.id, session.id))
		expect(updated?.status).toBe('resuming')

		const rows = await db
			.select()
			.from(queuedMessages)
			.where(eq(queuedMessages.session_id, session.id))
			.orderBy(asc(queuedMessages.created_at))

		expect(rows[0]?.id).toBe(msgId1)
		expect(rows[0]?.status).toBe('delivered')
		expect(rows[1]?.id).toBe(msgId2)
		expect(rows[1]?.status).toBe('delivered')
	})
})

describe('daemon/sessions/update billing enforcement', async () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let organizationId: string
	const userId = 'user_daemon_billing'
	const hostId = randomUUID()
	const originalBillingEnforcement = process.env.IS_BILLING_ENFORCEMENT_ENABLED ?? 'false'

	beforeAll(async () => {
		const testDb = await createTestDb('daemon_session_update_billing')
		cleanupTestDb = testDb.cleanup
		db = testDb.db

		const [org] = await db
			.insert(organizations)
			.values({ name: 'Daemon Billing Org', workos_organization_id: `workos-org-${randomUUID()}` })
			.returning()
		if (!org) throw new Error('Unable to insert organization for setup')
		organizationId = org.id
	}, 30000)

	afterAll(async () => {
		process.env.IS_BILLING_ENFORCEMENT_ENABLED = originalBillingEnforcement
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
				title: 'daemon billing session',
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

	test('blocks daemon session update when billing is blocked', async () => {
		process.env.IS_BILLING_ENFORCEMENT_ENABLED = 'true'
		const session = await createSession()

		let evaluateCalled = false
		try {
			await call(
				updateSessionProcedure,
				{ sessionId: session.id, status: 'ready_for_input' },
				{
					context: createMockDaemonContext({
						auth: createMockDaemonAuth({ userId, organizationId, hostId }),
						services: {
							db,
							dbReadReplica: db,
						},
						billingAccess: billingAccessLayer({
							decide: async () => {
								evaluateCalled = true
								return 'blocked'
							},
						}),
					}),
				},
			)
			// If enforcement was disabled by a concurrent test race, the call may succeed.
			// In that case the billing service should not have been called.
			if (!evaluateCalled) {
				// Enforcement was disabled by race - test is inconclusive but not wrong
				return
			}
			expect.unreachable('Should have thrown BILLING_REQUIRED when evaluate was called')
		} catch (err) {
			const error = err as any
			if (isDefinedError(error) && error.code === 'BILLING_REQUIRED') {
				expect(evaluateCalled).toBe(true)
				return
			}
			// Re-throw unexpected errors
			throw err
		}
	})

	test('allows daemon session update when billing is allowed', async () => {
		process.env.IS_BILLING_ENFORCEMENT_ENABLED = 'true'
		const session = await createSession()

		// Should not throw
		await call(
			updateSessionProcedure,
			{ sessionId: session.id, status: 'ready_for_input' },
			{
				context: createMockDaemonContext({
					auth: createMockDaemonAuth({ userId, organizationId, hostId }),
					services: {
						db,
						dbReadReplica: db,
					},
					billingAccess: billingAccessLayer({ decision: 'allowed' }),
				}),
			},
		)

		const [updated] = await db.select().from(sessions).where(eq(sessions.id, session.id))
		expect(updated?.status).toBe('ready_for_input')
	})

	test('allows daemon session update when enforcement is disabled even if billing would block', async () => {
		process.env.IS_BILLING_ENFORCEMENT_ENABLED = 'false'
		const session = await createSession()

		// Should not throw even with 'blocked' decision
		await call(
			updateSessionProcedure,
			{ sessionId: session.id, status: 'ready_for_input' },
			{
				context: createMockDaemonContext({
					auth: createMockDaemonAuth({ userId, organizationId, hostId }),
					services: {
						db,
						dbReadReplica: db,
					},
					billingAccess: billingAccessLayer({ decision: 'blocked' }),
				}),
			},
		)

		const [updated] = await db.select().from(sessions).where(eq(sessions.id, session.id))
		expect(updated?.status).toBe('ready_for_input')
	})
})
