// File: apps/riptide-api/test/procedures/events-create-status-advance.test.ts

import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'

import { conversationEvents } from '@humanlayer/db/tables/conversation-events'
import { organizations } from '@humanlayer/db/tables/organizations'
import { sessions, type SessionStatus } from '@humanlayer/db/tables/sessions'
import { tasks } from '@humanlayer/db/tables/tasks'
import { call } from '@orpc/server'
import * as Sentry from '@sentry/node'
import { eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'

import { createEventProcedure } from '../../src/orpc/daemon/sessions/events/create'
import { createMockDaemonAuth, createMockDaemonContext } from '../mocks'
import { createMockLinearService } from '../mocks/linear-service.mock'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

// Make the Sentry namespace mockable (ESM namespaces are otherwise non-configurable,
// so a plain vi.spyOn cannot redefine captureException).
vi.mock('@sentry/node', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@sentry/node')>()
	return {
		...actual,
		captureException: vi.fn(() => 'event-id'),
	}
})

await requireExternalTestServices()

describe('Events create: Linear status auto-advance', async () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let organizationId: string
	const userId = 'user_status_advance'
	const hostId = randomUUID()

	beforeAll(async () => {
		const testDb = await createTestDb('events_create_status_advance')
		cleanupTestDb = testDb.cleanup
		db = testDb.db

		const [org] = await db
			.insert(organizations)
			.values({
				name: 'test organization status advance',
				workos_organization_id: 'org_status_advance_test',
			})
			.returning()
		if (!org) throw new Error('Unable to insert organization for setup')
		organizationId = org.id
	}, 30000)

	afterEach(() => {
		vi.mocked(Sentry.captureException).mockClear()
	})

	async function createTaskAndSession(opts: {
		ticketId: string | null
		ticketProvider: 'linear' | 'jira' | null
		name: string
		status?: SessionStatus
		errorMessage?: string
	}) {
		const [task] = await db
			.insert(tasks)
			.values({
				organization_id: organizationId,
				name: opts.name,
				slug: opts.name,
				resource_owner_user_id: userId,
				created_by: userId,
				default_working_directory: tmpdir(),
				setup_status: 'completed',
				ticket_id: opts.ticketId,
				ticket_provider: opts.ticketProvider,
			})
			.returning()

		const [session] = await db
			.insert(sessions)
			.values({
				organization_id: organizationId,
				resource_owner_user_id: userId,
				created_by: userId,
				host_id: hostId,
				task_id: task!.id,
				title: opts.name,
				working_directory: tmpdir(),
				coding_agent: 'claude',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissions_mode: 'default',
				status: opts.status ?? 'ready_for_input',
				error_message: opts.errorMessage,
			})
			.returning()

		return { task: task!, session: session! }
	}

	test.each([
		{ eventType: 'message' as const, role: 'assistant' as const },
		{ eventType: 'thinking' as const, role: 'assistant' as const },
		{ eventType: 'tool_call' as const, role: 'assistant' as const },
		{ eventType: 'tool_result' as const, role: 'user' as const },
	])('$eventType/$role restores every repairable session state to running', async ({ eventType, role }) => {
		const repairableStatuses: SessionStatus[] = [
			'lost',
			'failed',
			'interrupted',
			'ready_for_input',
			'launching',
			'resuming',
		]
		for (const status of repairableStatuses) {
			const { session } = await createTaskAndSession({
				ticketId: null,
				ticketProvider: null,
				name: `repair-${eventType}-${status}-${randomUUID()}`,
				status,
				errorMessage: 'stale warning',
			})
			const previousActivity = session.last_activity_at

			await call(
				createEventProcedure,
				{
					sessionId: session.id,
					codingAgentSessionId: 'repair-agent-session',
					eventType,
					role,
					...(eventType === 'tool_call' ? { toolCallId: randomUUID(), toolName: 'Bash' } : {}),
					...(eventType === 'tool_result'
						? { toolResultForId: randomUUID(), toolResultContent: 'done' }
						: {}),
				},
				{ context: daemonContext({}) },
			)

			const [updated] = await db.select().from(sessions).where(eq(sessions.id, session.id))
			expect(updated).toMatchObject({ status: 'running', error_message: null, num_events: 1 })
			expect(updated!.last_activity_at).toBeGreaterThanOrEqual(previousActivity)
		}
	})

	test.each([
		{ eventType: 'message' as const, role: 'user' as const },
		{ eventType: 'system' as const, role: 'assistant' as const },
		{ eventType: 'tool_result' as const, role: 'assistant' as const },
	])('$eventType/$role records activity without repairing status', async ({ eventType, role }) => {
		const { session } = await createTaskAndSession({
			ticketId: null,
			ticketProvider: null,
			name: `non-repair-${eventType}-${role}-${randomUUID()}`,
			status: 'lost',
			errorMessage: 'lost warning',
		})

		await call(
			createEventProcedure,
			{
				sessionId: session.id,
				codingAgentSessionId: 'non-repair-agent-session',
				eventType,
				role,
				...(eventType === 'tool_result' ? { toolResultForId: randomUUID(), toolResultContent: 'done' } : {}),
			},
			{ context: daemonContext({}) },
		)

		const [updated] = await db.select().from(sessions).where(eq(sessions.id, session.id))
		expect(updated).toMatchObject({ status: 'lost', error_message: 'lost warning', num_events: 1 })
	})

	function daemonContext(linearOverrides: Parameters<typeof createMockLinearService>[0]) {
		return createMockDaemonContext({
			auth: createMockDaemonAuth({ userId, organizationId, hostId }),
			services: { db, dbReadReplica: db, linear: createMockLinearService(linearOverrides) },
		})
	}

	test('advances Linear status for an rpi:* skill on a Linear-ticketed task (Skill casing)', async () => {
		const { session } = await createTaskAndSession({
			ticketId: 'ENG-100',
			ticketProvider: 'linear',
			name: 'linear-skill-upper',
		})

		const updateIssueStatus = vi.fn(async () => ({ updated: true }))

		await call(
			createEventProcedure,
			{
				sessionId: session.id,
				codingAgentSessionId: 'agent-session-1',
				eventType: 'tool_call',
				role: 'assistant',
				toolName: 'Skill',
				toolInputJson: JSON.stringify({ skill: 'rpi:create-research' }),
			},
			{ context: daemonContext({ updateIssueStatus }) },
		)

		expect(updateIssueStatus).toHaveBeenCalledTimes(1)
		expect(updateIssueStatus).toHaveBeenCalledWith(organizationId, 'ENG-100', 'research-in-progress')
	})

	test('advances Linear status for an rpi:* skill (lower-case skill casing)', async () => {
		const { session } = await createTaskAndSession({
			ticketId: 'ENG-101',
			ticketProvider: 'linear',
			name: 'linear-skill-lower',
		})

		const updateIssueStatus = vi.fn(async () => ({ updated: true }))

		await call(
			createEventProcedure,
			{
				sessionId: session.id,
				codingAgentSessionId: 'agent-session-2',
				eventType: 'tool_call',
				role: 'assistant',
				toolName: 'skill',
				toolInputJson: JSON.stringify({ skill: 'rpi:implement-plan' }),
			},
			{ context: daemonContext({ updateIssueStatus }) },
		)

		expect(updateIssueStatus).toHaveBeenCalledTimes(1)
		expect(updateIssueStatus).toHaveBeenCalledWith(organizationId, 'ENG-101', 'in-dev')
	})

	test('does NOT advance when task has no ticket', async () => {
		const { session } = await createTaskAndSession({
			ticketId: null,
			ticketProvider: null,
			name: 'no-ticket',
		})

		const updateIssueStatus = vi.fn(async () => ({ updated: true }))

		await call(
			createEventProcedure,
			{
				sessionId: session.id,
				codingAgentSessionId: 'agent-session-3',
				eventType: 'tool_call',
				role: 'assistant',
				toolName: 'Skill',
				toolInputJson: JSON.stringify({ skill: 'rpi:create-research' }),
			},
			{ context: daemonContext({ updateIssueStatus }) },
		)

		expect(updateIssueStatus).not.toHaveBeenCalled()
	})

	test('does NOT advance when ticket_provider is not linear (Jira)', async () => {
		const { session } = await createTaskAndSession({
			ticketId: 'JIRA-1',
			ticketProvider: 'jira',
			name: 'jira-ticket',
		})

		const updateIssueStatus = vi.fn(async () => ({ updated: true }))

		await call(
			createEventProcedure,
			{
				sessionId: session.id,
				codingAgentSessionId: 'agent-session-4',
				eventType: 'tool_call',
				role: 'assistant',
				toolName: 'Skill',
				toolInputJson: JSON.stringify({ skill: 'rpi:create-research' }),
			},
			{ context: daemonContext({ updateIssueStatus }) },
		)

		expect(updateIssueStatus).not.toHaveBeenCalled()
	})

	test('does NOT advance for a non-skill tool call', async () => {
		const { session } = await createTaskAndSession({
			ticketId: 'ENG-102',
			ticketProvider: 'linear',
			name: 'non-skill-tool',
		})

		const updateIssueStatus = vi.fn(async () => ({ updated: true }))

		await call(
			createEventProcedure,
			{
				sessionId: session.id,
				codingAgentSessionId: 'agent-session-5',
				eventType: 'tool_call',
				role: 'assistant',
				toolName: 'Bash',
				toolInputJson: JSON.stringify({ command: 'ls' }),
			},
			{ context: daemonContext({ updateIssueStatus }) },
		)

		expect(updateIssueStatus).not.toHaveBeenCalled()
	})

	test('persists the event and reports to Sentry when updateIssueStatus throws', async () => {
		const { session } = await createTaskAndSession({
			ticketId: 'ENG-103',
			ticketProvider: 'linear',
			name: 'linear-throws',
		})

		const eventId = randomUUID()
		const captureSpy = vi.mocked(Sentry.captureException)
		const updateIssueStatus = vi.fn(async () => {
			throw new Error('linear boom')
		})

		// Handler resolves despite the Linear failure.
		const result = await call(
			createEventProcedure,
			{
				eventId,
				sessionId: session.id,
				codingAgentSessionId: 'agent-session-6',
				eventType: 'tool_call',
				role: 'assistant',
				toolName: 'Skill',
				toolInputJson: JSON.stringify({ skill: 'rpi:create-research' }),
			},
			{ context: daemonContext({ updateIssueStatus }) },
		)

		expect(result.eventId).toBe(eventId)

		// Event was still persisted.
		const [persisted] = await db
			.select()
			.from(conversationEvents)
			.where(eq(conversationEvents.id, eventId))
			.limit(1)
		expect(persisted).toBeDefined()

		// Sentry was pinged with the auto-advance error tag.
		expect(updateIssueStatus).toHaveBeenCalledTimes(1)
		expect(captureSpy).toHaveBeenCalledTimes(1)
		expect(captureSpy).toHaveBeenCalledWith(
			expect.any(Error),
			expect.objectContaining({ tags: { error_type: 'linear_auto_advance_status' } }),
		)
	})

	afterAll(async () => {
		await cleanupTestDb?.()
	}, 30000)
})
