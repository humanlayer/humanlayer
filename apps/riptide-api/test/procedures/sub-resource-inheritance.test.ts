import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'

import { approvals } from '@humanlayer/db/tables/approvals'
import { artifacts } from '@humanlayer/db/tables/artifacts'
import { conversationEvents } from '@humanlayer/db/tables/conversation-events'
import { onlineHosts } from '@humanlayer/db/tables/online-hosts'
import { organizations } from '@humanlayer/db/tables/organizations'
import { sessions } from '@humanlayer/db/tables/sessions'
import { tasks } from '@humanlayer/db/tables/tasks'
import { call } from '@orpc/server'
import { eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { uuidv7 } from 'uuidv7'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { forkSessionProcedure } from '../../src/orpc/api/sessions/fork'
import { updateSessionApiProcedure } from '../../src/orpc/api/sessions/update'
import { createApprovalProcedure } from '../../src/orpc/daemon/approvals/create'
import { checkAutoAdvance } from '../../src/orpc/daemon/sessions/check-auto-advance'
import { createEventProcedure } from '../../src/orpc/daemon/sessions/events/create'
import { createMockApiAuth, createMockApiContext, createMockDaemonAuth, createMockDaemonContext } from '../mocks'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('Section 10: Sub-Resource Inheritance Tests', async () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase

	let organizationId: string
	const workosOrganizationId = 'org_abc123'
	const userId = 'user_abc1234'
	const hostId = randomUUID()

	beforeAll(async () => {
		const testDb = await createTestDb('sub_resource_inheritance')
		cleanupTestDb = testDb.cleanup
		db = testDb.db

		// Set up organization
		const [org] = await db
			.insert(organizations)
			.values({
				name: 'test organization',
				workos_organization_id: workosOrganizationId,
			})
			.returning()

		if (!org) throw new Error('Unable to insert organization for setup')
		organizationId = org.id
	}, 30000)

	describe('10.1 Conversation Event Inheritance', () => {
		test('Test 120: Inherits resource_owner_user_id from session', async () => {
			// Create task and session
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'test task for event inheritance',
					resource_owner_user_id: userId,
					created_by: userId,
					default_working_directory: tmpdir(),
					setup_status: 'completed',
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			const [session] = await db
				.insert(sessions)
				.values({
					organization_id: organizationId,
					resource_owner_user_id: userId,
					created_by: userId,
					host_id: hostId,
					task_id: task.id,
					title: 'test session for event',
					working_directory: tmpdir(),
					coding_agent: 'claude',
					provider: 'anthropic',
					model: 'claude-sonnet-4-5',
					permissions_mode: 'accept_edits',
					status: 'ready_for_input',
				})
				.returning()

			if (!session) throw new Error('Failed to create session')

			const daemonAuth = createMockDaemonAuth({ userId, organizationId, hostId })

			// Create conversation event via daemon endpoint
			const result = await call(
				createEventProcedure,
				{
					sessionId: session.id,
					codingAgentSessionId: 'agent-session-123',
					codingAgentEventId: 'event-123',
					eventType: 'message',
					role: 'user',
					content: 'Hello, world!',
				},
				{
					context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
				},
			)

			// Verify the event was created
			const [event] = await db
				.select()
				.from(conversationEvents)
				.where(eq(conversationEvents.id, result.eventId))
				.limit(1)

			expect(event).toBeDefined()
			expect(event?.resource_owner_user_id).toBe(userId)
			expect(event?.resource_owner_user_id).toBe(session.resource_owner_user_id)
		})

		test('Test 121: Inherits task_id from session', async () => {
			// Create task and session
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'test task for event task_id inheritance',
					resource_owner_user_id: userId,
					created_by: userId,
					default_working_directory: tmpdir(),
					setup_status: 'completed',
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			const [session] = await db
				.insert(sessions)
				.values({
					organization_id: organizationId,
					resource_owner_user_id: userId,
					created_by: userId,
					host_id: hostId,
					task_id: task.id,
					title: 'test session for event task_id',
					working_directory: tmpdir(),
					coding_agent: 'claude',
					provider: 'anthropic',
					model: 'claude-sonnet-4-5',
					permissions_mode: 'accept_edits',
					status: 'ready_for_input',
				})
				.returning()

			if (!session) throw new Error('Failed to create session')

			const daemonAuth = createMockDaemonAuth({ userId, organizationId, hostId })

			// Create conversation event
			const result = await call(
				createEventProcedure,
				{
					sessionId: session.id,
					codingAgentSessionId: 'agent-session-456',
					codingAgentEventId: 'event-456',
					eventType: 'message',
					role: 'assistant',
					content: 'Response',
				},
				{
					context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
				},
			)

			// Verify the event inherits task_id
			const [event] = await db
				.select()
				.from(conversationEvents)
				.where(eq(conversationEvents.id, result.eventId))
				.limit(1)

			expect(event).toBeDefined()
			expect(event?.task_id).toBe(task.id)
			expect(event?.task_id).toBe(session.task_id)
		})

		test('Test 123: Works when session has task_id as null', async () => {
			// Create session without task_id
			const [session] = await db
				.insert(sessions)
				.values({
					organization_id: organizationId,
					resource_owner_user_id: userId,
					created_by: userId,
					host_id: hostId,
					task_id: null, // task_id is null
					title: 'test session without task',
					working_directory: tmpdir(),
					coding_agent: 'claude',
					provider: 'anthropic',
					model: 'claude-sonnet-4-5',
					permissions_mode: 'accept_edits',
					status: 'ready_for_input',
				})
				.returning()

			if (!session) throw new Error('Failed to create session')

			const daemonAuth = createMockDaemonAuth({ userId, organizationId, hostId })

			// Create event
			const result = await call(
				createEventProcedure,
				{
					sessionId: session.id,
					codingAgentSessionId: 'agent-session-null',
					codingAgentEventId: 'event-null',
					eventType: 'message',
					role: 'user',
					content: 'Test without task',
				},
				{
					context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
				},
			)

			const [event] = await db
				.select()
				.from(conversationEvents)
				.where(eq(conversationEvents.id, result.eventId))
				.limit(1)

			expect(event).toBeDefined()
			expect(event?.task_id).toBeNull()
		})
	})

	describe('10.2 Approval Inheritance', () => {
		test('Test 124: Inherits resource_owner_user_id from session', async () => {
			// Create task and session
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'test task for approval inheritance',
					resource_owner_user_id: userId,
					created_by: userId,
					default_working_directory: tmpdir(),
					setup_status: 'completed',
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			const [session] = await db
				.insert(sessions)
				.values({
					organization_id: organizationId,
					resource_owner_user_id: userId,
					created_by: userId,
					host_id: hostId,
					task_id: task.id,
					title: 'test session for approval',
					working_directory: tmpdir(),
					coding_agent: 'claude',
					provider: 'anthropic',
					model: 'claude-sonnet-4-5',
					permissions_mode: 'accept_edits',
					status: 'ready_for_input',
				})
				.returning()

			if (!session) throw new Error('Failed to create session')

			const daemonAuth = createMockDaemonAuth({ userId, organizationId, hostId })

			// Create approval via daemon endpoint
			const result = await call(
				createApprovalProcedure,
				{
					sessionId: session.id,
					toolName: 'Bash',
					toolInput: { command: 'rm -rf /' },
					toolUseId: 'tool-use-123',
					agentId: 'agent-123',
				},
				{
					context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
				},
			)

			// Verify the approval was created
			const [approval] = await db.select().from(approvals).where(eq(approvals.id, result.approvalId)).limit(1)

			expect(approval).toBeDefined()
			expect(approval?.resource_owner_user_id).toBe(userId)
			expect(approval?.resource_owner_user_id).toBe(session.resource_owner_user_id)
		})

		test('Test 125: Inherits task_id from session', async () => {
			// Create task and session
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'test task for approval task_id inheritance',
					resource_owner_user_id: userId,
					created_by: userId,
					default_working_directory: tmpdir(),
					setup_status: 'completed',
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			const [session] = await db
				.insert(sessions)
				.values({
					organization_id: organizationId,
					resource_owner_user_id: userId,
					created_by: userId,
					host_id: hostId,
					task_id: task.id,
					title: 'test session for approval task_id',
					working_directory: tmpdir(),
					coding_agent: 'claude',
					provider: 'anthropic',
					model: 'claude-sonnet-4-5',
					permissions_mode: 'accept_edits',
					status: 'ready_for_input',
				})
				.returning()

			if (!session) throw new Error('Failed to create session')

			const daemonAuth = createMockDaemonAuth({ userId, organizationId, hostId })

			// Create approval
			const result = await call(
				createApprovalProcedure,
				{
					sessionId: session.id,
					toolName: 'Edit',
					toolInput: { file: '/etc/passwd', content: 'hacked' },
					toolUseId: 'tool-use-456',
					agentId: 'agent-456',
				},
				{
					context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
				},
			)

			// Verify the approval inherits task_id
			const [approval] = await db.select().from(approvals).where(eq(approvals.id, result.approvalId)).limit(1)

			expect(approval).toBeDefined()
			expect(approval?.task_id).toBe(task.id)
			expect(approval?.task_id).toBe(session.task_id)
		})
	})

	describe('10.3 Session Update - task_id Cascade', () => {
		test('Test 126: Updating session task_id cascades to conversation_events', async () => {
			// Create two tasks
			const [task1] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'task 1 for cascade',
					resource_owner_user_id: userId,
					created_by: userId,
					default_working_directory: tmpdir(),
					setup_status: 'completed',
				})
				.returning()

			const [task2] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'task 2 for cascade',
					resource_owner_user_id: userId,
					created_by: userId,
					default_working_directory: tmpdir(),
					setup_status: 'completed',
				})
				.returning()

			if (!task1 || !task2) throw new Error('Failed to create tasks')

			// Create session with task1
			const [session] = await db
				.insert(sessions)
				.values({
					organization_id: organizationId,
					resource_owner_user_id: userId,
					created_by: userId,
					host_id: hostId,
					task_id: task1.id,
					title: 'test session for cascade',
					working_directory: tmpdir(),
					coding_agent: 'claude',
					provider: 'anthropic',
					model: 'claude-sonnet-4-5',
					permissions_mode: 'accept_edits',
					status: 'ready_for_input',
				})
				.returning()

			if (!session) throw new Error('Failed to create session')

			const daemonAuth = createMockDaemonAuth({ userId, organizationId, hostId })

			// Create a conversation event
			const eventResult = await call(
				createEventProcedure,
				{
					sessionId: session.id,
					codingAgentSessionId: 'agent-cascade-1',
					codingAgentEventId: 'event-cascade-1',
					eventType: 'message',
					role: 'user',
					content: 'Test cascade',
				},
				{
					context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
				},
			)

			// Verify event has task1
			const [eventBefore] = await db
				.select()
				.from(conversationEvents)
				.where(eq(conversationEvents.id, eventResult.eventId))
				.limit(1)

			expect(eventBefore?.task_id).toBe(task1.id)

			// Update session to task2
			const apiAuth = createMockApiAuth({ userId, organizationId, workosOrganizationId })

			await call(
				updateSessionApiProcedure,
				{
					sessionId: session.id,
					taskId: task2.id,
				},
				{
					context: createMockApiContext({ auth: apiAuth, services: { db, dbReadReplica: db } }),
				},
			)

			// Verify event was updated to task2
			const [eventAfter] = await db
				.select()
				.from(conversationEvents)
				.where(eq(conversationEvents.id, eventResult.eventId))
				.limit(1)

			expect(eventAfter?.task_id).toBe(task2.id)
		})

		test('Test 127: Updating session task_id cascades to approvals', async () => {
			// Create two tasks
			const [task1] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'task 1 for approval cascade',
					resource_owner_user_id: userId,
					created_by: userId,
					default_working_directory: tmpdir(),
					setup_status: 'completed',
				})
				.returning()

			const [task2] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'task 2 for approval cascade',
					resource_owner_user_id: userId,
					created_by: userId,
					default_working_directory: tmpdir(),
					setup_status: 'completed',
				})
				.returning()

			if (!task1 || !task2) throw new Error('Failed to create tasks')

			// Create session with task1
			const [session] = await db
				.insert(sessions)
				.values({
					organization_id: organizationId,
					resource_owner_user_id: userId,
					created_by: userId,
					host_id: hostId,
					task_id: task1.id,
					title: 'test session for approval cascade',
					working_directory: tmpdir(),
					coding_agent: 'claude',
					provider: 'anthropic',
					model: 'claude-sonnet-4-5',
					permissions_mode: 'accept_edits',
					status: 'ready_for_input',
				})
				.returning()

			if (!session) throw new Error('Failed to create session')

			const daemonAuth = createMockDaemonAuth({ userId, organizationId, hostId })

			// Create an approval
			const approvalResult = await call(
				createApprovalProcedure,
				{
					sessionId: session.id,
					toolName: 'Bash',
					toolInput: { command: 'echo test' },
					toolUseId: 'tool-cascade-1',
					agentId: 'agent-cascade',
				},
				{
					context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
				},
			)

			// Verify approval has task1
			const [approvalBefore] = await db
				.select()
				.from(approvals)
				.where(eq(approvals.id, approvalResult.approvalId))
				.limit(1)

			expect(approvalBefore?.task_id).toBe(task1.id)

			// Update session to task2
			const apiAuth = createMockApiAuth({ userId, organizationId, workosOrganizationId })

			await call(
				updateSessionApiProcedure,
				{
					sessionId: session.id,
					taskId: task2.id,
				},
				{
					context: createMockApiContext({ auth: apiAuth, services: { db, dbReadReplica: db } }),
				},
			)

			// Verify approval was updated to task2
			const [approvalAfter] = await db
				.select()
				.from(approvals)
				.where(eq(approvals.id, approvalResult.approvalId))
				.limit(1)

			expect(approvalAfter?.task_id).toBe(task2.id)
		})

		test('Test 128: Cascade: null → value works', async () => {
			// Create task
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'task for null to value cascade',
					resource_owner_user_id: userId,
					created_by: userId,
					default_working_directory: tmpdir(),
					setup_status: 'completed',
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			// Create session with null task_id
			const [session] = await db
				.insert(sessions)
				.values({
					organization_id: organizationId,
					resource_owner_user_id: userId,
					created_by: userId,
					host_id: hostId,
					task_id: null,
					title: 'test session for null to value',
					working_directory: tmpdir(),
					coding_agent: 'claude',
					provider: 'anthropic',
					model: 'claude-sonnet-4-5',
					permissions_mode: 'accept_edits',
					status: 'ready_for_input',
				})
				.returning()

			if (!session) throw new Error('Failed to create session')

			const daemonAuth = createMockDaemonAuth({ userId, organizationId, hostId })

			// Create conversation event and approval
			const eventResult = await call(
				createEventProcedure,
				{
					sessionId: session.id,
					codingAgentSessionId: 'agent-null-value',
					codingAgentEventId: 'event-null-value',
					eventType: 'message',
					role: 'user',
					content: 'Test null to value',
				},
				{
					context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
				},
			)

			const approvalResult = await call(
				createApprovalProcedure,
				{
					sessionId: session.id,
					toolName: 'Bash',
					toolInput: { command: 'ls' },
					toolUseId: 'tool-null-value',
					agentId: 'agent-null',
				},
				{
					context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
				},
			)

			// Verify both have null task_id
			const [eventBefore] = await db
				.select()
				.from(conversationEvents)
				.where(eq(conversationEvents.id, eventResult.eventId))
				.limit(1)

			const [approvalBefore] = await db
				.select()
				.from(approvals)
				.where(eq(approvals.id, approvalResult.approvalId))
				.limit(1)

			expect(eventBefore?.task_id).toBeNull()
			expect(approvalBefore?.task_id).toBeNull()

			// Update session to have task
			const apiAuth = createMockApiAuth({ userId, organizationId, workosOrganizationId })

			await call(
				updateSessionApiProcedure,
				{
					sessionId: session.id,
					taskId: task.id,
				},
				{
					context: createMockApiContext({ auth: apiAuth, services: { db, dbReadReplica: db } }),
				},
			)

			// Verify both were updated to task
			const [eventAfter] = await db
				.select()
				.from(conversationEvents)
				.where(eq(conversationEvents.id, eventResult.eventId))
				.limit(1)

			const [approvalAfter] = await db
				.select()
				.from(approvals)
				.where(eq(approvals.id, approvalResult.approvalId))
				.limit(1)

			expect(eventAfter?.task_id).toBe(task.id)
			expect(approvalAfter?.task_id).toBe(task.id)
		})

		test('Test 129: Cascade: value → null works', async () => {
			// Create task
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'task for value to null cascade',
					resource_owner_user_id: userId,
					created_by: userId,
					default_working_directory: tmpdir(),
					setup_status: 'completed',
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			// Create session with task
			const [session] = await db
				.insert(sessions)
				.values({
					organization_id: organizationId,
					resource_owner_user_id: userId,
					created_by: userId,
					host_id: hostId,
					task_id: task.id,
					title: 'test session for value to null',
					working_directory: tmpdir(),
					coding_agent: 'claude',
					provider: 'anthropic',
					model: 'claude-sonnet-4-5',
					permissions_mode: 'accept_edits',
					status: 'ready_for_input',
				})
				.returning()

			if (!session) throw new Error('Failed to create session')

			const daemonAuth = createMockDaemonAuth({ userId, organizationId, hostId })

			// Create conversation event and approval
			const eventResult = await call(
				createEventProcedure,
				{
					sessionId: session.id,
					codingAgentSessionId: 'agent-value-null',
					codingAgentEventId: 'event-value-null',
					eventType: 'message',
					role: 'user',
					content: 'Test value to null',
				},
				{
					context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
				},
			)

			const approvalResult = await call(
				createApprovalProcedure,
				{
					sessionId: session.id,
					toolName: 'Bash',
					toolInput: { command: 'pwd' },
					toolUseId: 'tool-value-null',
					agentId: 'agent-value',
				},
				{
					context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
				},
			)

			// Verify both have task
			const [eventBefore] = await db
				.select()
				.from(conversationEvents)
				.where(eq(conversationEvents.id, eventResult.eventId))
				.limit(1)

			const [approvalBefore] = await db
				.select()
				.from(approvals)
				.where(eq(approvals.id, approvalResult.approvalId))
				.limit(1)

			expect(eventBefore?.task_id).toBe(task.id)
			expect(approvalBefore?.task_id).toBe(task.id)

			// Update session to null task_id
			const apiAuth = createMockApiAuth({ userId, organizationId, workosOrganizationId })

			await call(
				updateSessionApiProcedure,
				{
					sessionId: session.id,
					taskId: null,
				},
				{
					context: createMockApiContext({ auth: apiAuth, services: { db, dbReadReplica: db } }),
				},
			)

			// Verify both were updated to null
			const [eventAfter] = await db
				.select()
				.from(conversationEvents)
				.where(eq(conversationEvents.id, eventResult.eventId))
				.limit(1)

			const [approvalAfter] = await db
				.select()
				.from(approvals)
				.where(eq(approvals.id, approvalResult.approvalId))
				.limit(1)

			expect(eventAfter?.task_id).toBeNull()
			expect(approvalAfter?.task_id).toBeNull()
		})
	})

	describe('10.4 permissions_mode Inheritance for new modes', () => {
		/**
		 * Fork tests: verify that sessions with permissions_mode 'auto'
		 * produce forked sessions with the same permissions_mode.
		 */
		describe('Fork inherits permissions_mode', () => {
			async function createForkableSessionWithMode(permissionsMode: 'auto', userId: string, hostId: string) {
				// Register host so fork ownership check passes
				await db
					.insert(onlineHosts)
					.values({ host_id: hostId, user_id: userId, organization_id: organizationId })
					.onConflictDoNothing()

				const [task] = await db
					.insert(tasks)
					.values({
						organization_id: organizationId,
						name: `fork-mode-${permissionsMode}-${randomUUID()}`,
						resource_owner_user_id: userId,
						created_by: userId,
					})
					.returning()
				if (!task) throw new Error('Failed to create task')

				const sessionId = uuidv7()
				await db.insert(sessions).values({
					id: sessionId,
					task_id: task.id,
					organization_id: organizationId,
					resource_owner_user_id: userId,
					created_by: userId,
					host_id: hostId,
					working_directory: tmpdir(),
					coding_agent: 'claude',
					status: 'ready_for_input',
					coding_agent_session_id: randomUUID(),
					provider: 'anthropic',
					model: 'claude-sonnet-4-5',
					permissions_mode: permissionsMode,
					title: `Fork source ${permissionsMode}`,
				})

				// Need a preceding assistant event with coding_agent_event_id for the fork API
				const now = BigInt(Date.now())
				await db.insert(conversationEvents).values({
					id: uuidv7(),
					session_id: sessionId,
					organization_id: organizationId,
					resource_owner_user_id: userId,
					event_type: 'message',
					role: 'assistant',
					content: 'Preceding response',
					coding_agent_event_id: randomUUID(),
					created_at: now,
					updated_at: now,
				})

				// Fork point: user message without coding_agent_event_id
				const forkEventId = uuidv7()
				const laterTime = BigInt(Date.now() + 1000)
				await db.insert(conversationEvents).values({
					id: forkEventId,
					session_id: sessionId,
					organization_id: organizationId,
					resource_owner_user_id: userId,
					event_type: 'message',
					role: 'user',
					content: 'User message at fork point',
					created_at: laterTime,
					updated_at: laterTime,
				})

				return { sessionId, forkAtEventId: forkEventId }
			}

			test('fork from an auto session produces a child with permissions_mode auto', async () => {
				const userId = 'user_fork_auto'
				const hostId = randomUUID()
				const { sessionId, forkAtEventId } = await createForkableSessionWithMode('auto', userId, hostId)

				const result = await call(
					forkSessionProcedure,
					{ sourceSessionId: sessionId, forkAtEventId, text: 'Continue from auto' },
					{
						context: createMockApiContext({
							auth: createMockApiAuth({ userId, organizationId, workosOrganizationId }),
							services: { db, dbReadReplica: db },
						}),
					},
				)

				expect(result.session.permissions_mode).toBe('auto')
			})
		})

		/**
		 * Auto-advance tests: verify that sessions with permissions_mode 'auto'
		 * produce auto-advanced sessions with the same permissions_mode.
		 */
		describe('Auto-advance inherits permissions_mode', () => {
			async function createAutoAdvanceSession(permissionsMode: 'auto', userId: string, hostId: string) {
				const [task] = await db
					.insert(tasks)
					.values({
						organization_id: organizationId,
						name: `advance-mode-${permissionsMode}-${randomUUID()}`,
						slug: `advance-${permissionsMode}-${randomUUID().slice(0, 8)}`,
						resource_owner_user_id: userId,
						created_by: userId,
						default_working_directory: tmpdir(),
						setup_status: 'completed',
						auto_advance_questions_to_research: true,
					})
					.returning()
				if (!task) throw new Error('Failed to create task')

				const [session] = await db
					.insert(sessions)
					.values({
						organization_id: organizationId,
						resource_owner_user_id: userId,
						created_by: userId,
						host_id: hostId,
						task_id: task.id,
						title: 'research-questions',
						working_directory: tmpdir(),
						coding_agent: 'claude',
						provider: 'anthropic',
						model: 'claude-sonnet-4-5',
						permissions_mode: permissionsMode,
						status: 'ready_for_input',
						labels: [{ name: 'rpi:research-questions', title: 'research-questions' }],
					})
					.returning()
				if (!session) throw new Error('Failed to create session')

				// Artifact is required for the research-questions → research transition
				await db.insert(artifacts).values({
					organization_id: organizationId,
					resource_owner_user_id: userId,
					task_id: task.id,
					file_name: `01-research-questions-${randomUUID().slice(0, 8)}.md`,
					frontmatter: { type: 'research-questions' },
					content: '# Research Questions\n\nTest content',
					content_hash: `test-hash-${randomUUID()}`,
					created_by: userId,
				})

				return { sessionId: session.id, taskId: task.id }
			}

			test('auto-advance from an auto session produces a child with permissions_mode auto', async () => {
				const userId = 'user_advance_auto'
				const hostId = randomUUID()
				const { sessionId, taskId } = await createAutoAdvanceSession('auto', userId, hostId)

				await checkAutoAdvance(db, sessionId, organizationId)

				const newSessions = await db
					.select()
					.from(sessions)
					.where(eq(sessions.task_id, taskId))
					.orderBy(sessions.created_at)

				expect(newSessions).toHaveLength(2)
				expect(newSessions[1]?.permissions_mode).toBe('auto')
			})
		})
	})

	afterAll(async () => {
		await cleanupTestDb?.()
	}, 30000)
})
