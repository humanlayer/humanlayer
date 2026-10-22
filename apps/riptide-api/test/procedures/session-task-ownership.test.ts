// File: apps/riptide-api/test/procedures/session-task-ownership.test.ts

import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'

import { approvals } from '@humanlayer/db/tables/approvals'
import { conversationEvents } from '@humanlayer/db/tables/conversation-events'
import { onlineHosts } from '@humanlayer/db/tables/online-hosts'
import { organizations } from '@humanlayer/db/tables/organizations'
import { sessions } from '@humanlayer/db/tables/sessions'
import { taskUserAcl } from '@humanlayer/db/tables/task-user-acl'
import { tasks } from '@humanlayer/db/tables/tasks'
import { call } from '@orpc/server'
import { eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { continueSessionProcedure } from '../../src/orpc/api/sessions/continue'
import { createSessionProcedure } from '../../src/orpc/api/sessions/create'
import { interruptSessionProcedure } from '../../src/orpc/api/sessions/interrupt'
import { launchSessionProcedure } from '../../src/orpc/api/sessions/launch'
import { updateSessionApiProcedure } from '../../src/orpc/api/sessions/update'
import { createApprovalProcedure } from '../../src/orpc/daemon/approvals/create'
import { createEventProcedure } from '../../src/orpc/daemon/sessions/events/create'
import { createMockApiAuth, createMockApiContext, createMockDaemonAuth, createMockDaemonContext } from '../mocks'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('Session Task Ownership', async () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let organizationId: string
	const workosOrganizationId = 'org_abc123'
	const taskOwnerUserId = 'user_task_owner'
	const sessionCreatorUserId = 'user_session_creator'
	const sharedUserId = 'user_shared'
	const unauthorizedUserId = 'user_unauthorized'
	const hostId = randomUUID()

	beforeAll(async () => {
		const testDb = await createTestDb('session_task_ownership')
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

		// Register hosts so API-level host ownership validation passes for users that call sessions.launch
		await db
			.insert(onlineHosts)
			.values([
				{ host_id: hostId, user_id: sessionCreatorUserId, organization_id: organizationId },
				{ host_id: hostId, user_id: taskOwnerUserId, organization_id: organizationId },
			])
			.onConflictDoNothing()
	}, 30000)

	// ========================================================================
	// GAP 1: Session should inherit resource_owner_user_id from task
	// ========================================================================

	describe('GAP 1: Session inherits resource_owner_user_id from task', () => {
		test('sessions.create with taskId should set resource_owner_user_id from task, not creating user', async () => {
			// Create a task owned by taskOwnerUserId
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'task owned by task owner',
					resource_owner_user_id: taskOwnerUserId,
					created_by: taskOwnerUserId,
					default_working_directory: tmpdir(),
					setup_status: 'completed',
				})
				.returning()

			// Grant write access to sessionCreatorUserId
			await db.insert(taskUserAcl).values({
				organization_id: organizationId,
				subject_user_id: sessionCreatorUserId,
				task_id: task!.id,
				resource_owner_user_id: taskOwnerUserId,
				permission_level: 'edit',
				granted_by: taskOwnerUserId,
			})

			// sessionCreatorUserId creates a session for that task
			const apiAuth = createMockApiAuth({
				userId: sessionCreatorUserId,
				organizationId,
				workosOrganizationId,
			})

			const result = await call(
				createSessionProcedure,
				{
					taskId: task!.id,
					prompt: 'Test prompt',
					workingDirectory: tmpdir(),
					codingAgent: 'claude',
					permissionsMode: 'default',
				},
				{
					context: createMockApiContext({ auth: apiAuth, services: { db, dbReadReplica: db } }),
				},
			)

			const [session] = await db.select().from(sessions).where(eq(sessions.id, result.session.id)).limit(1)

			// EXPECTED: Session should have task's resource_owner_user_id
			// CURRENT: Session has sessionCreatorUserId as resource_owner_user_id
			expect(session?.resource_owner_user_id).toBe(taskOwnerUserId) // WILL FAIL - currently equals sessionCreatorUserId
			expect(session?.created_by).toBe(sessionCreatorUserId) // created_by should still be the creator
		})

		test('sessions.launch with taskId should set resource_owner_user_id from task', async () => {
			// Create a task owned by taskOwnerUserId
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'task for launch',
					resource_owner_user_id: taskOwnerUserId,
					created_by: taskOwnerUserId,
					default_working_directory: tmpdir(),
					setup_status: 'completed',
				})
				.returning()

			// Grant write access to sessionCreatorUserId
			await db.insert(taskUserAcl).values({
				organization_id: organizationId,
				subject_user_id: sessionCreatorUserId,
				task_id: task!.id,
				resource_owner_user_id: taskOwnerUserId,
				permission_level: 'edit',
				granted_by: taskOwnerUserId,
			})

			const apiAuth = createMockApiAuth({
				userId: sessionCreatorUserId,
				organizationId,
				workosOrganizationId,
			})

			const result = await call(
				launchSessionProcedure,
				{
					taskId: task!.id,
					title: 'Test launch',
					text: 'Hello',
					workingDirectory: tmpdir(),
					hostId,
					codingAgent: 'claude',
					provider: 'anthropic',
					model: 'claude-sonnet-4-5',
					permissionsMode: 'default',
				},
				{
					context: createMockApiContext({ auth: apiAuth, services: { db, dbReadReplica: db } }),
				},
			)

			const [session] = await db.select().from(sessions).where(eq(sessions.id, result.session.id)).limit(1)

			// EXPECTED: Session should have task's resource_owner_user_id
			expect(session?.resource_owner_user_id).toBe(taskOwnerUserId) // WILL FAIL
		})
	})

	// ========================================================================
	// GAP 2: Must check write permission to task before creating session
	// ========================================================================
	describe('GAP 2: Check write permission to task on session create/launch', () => {
		test('sessions.create should reject if user lacks write permission to task', async () => {
			// Create a task owned by taskOwnerUserId
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'task without shared access',
					resource_owner_user_id: taskOwnerUserId,
					created_by: taskOwnerUserId,
					default_working_directory: tmpdir(),
					setup_status: 'completed',
				})
				.returning()

			// unauthorizedUserId tries to create a session for the task (no ACL granted)
			const apiAuth = createMockApiAuth({
				userId: unauthorizedUserId,
				organizationId,
				workosOrganizationId,
			})

			// EXPECTED: Should throw FORBIDDEN error
			// CURRENT: No task permission check - session is created successfully
			await expect(
				call(
					createSessionProcedure,
					{
						taskId: task!.id,
						prompt: 'Test prompt',
						workingDirectory: tmpdir(),
						codingAgent: 'claude',
						permissionsMode: 'default',
					},
					{
						context: createMockApiContext({ auth: apiAuth, services: { db, dbReadReplica: db } }),
					},
				),
			).rejects.toThrow() // WILL FAIL - currently succeeds
		})

		test('sessions.launch should reject if user lacks write permission to task', async () => {
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'task for unauthorized launch',
					resource_owner_user_id: taskOwnerUserId,
					created_by: taskOwnerUserId,
					default_working_directory: tmpdir(),
					setup_status: 'completed',
				})
				.returning()

			const apiAuth = createMockApiAuth({
				userId: unauthorizedUserId,
				organizationId,
				workosOrganizationId,
			})

			// EXPECTED: Should throw FORBIDDEN error
			await expect(
				call(
					launchSessionProcedure,
					{
						taskId: task!.id,
						title: 'Unauthorized launch',
						text: 'Hello',
						workingDirectory: tmpdir(),
						hostId,
						codingAgent: 'claude',
						provider: 'anthropic',
						model: 'claude-sonnet-4-5',
						permissionsMode: 'default',
					},
					{
						context: createMockApiContext({ auth: apiAuth, services: { db, dbReadReplica: db } }),
					},
				),
			).rejects.toThrow() // WILL FAIL - currently succeeds
		})
	})

	// ========================================================================
	// GAP 3: Session update should use task ACL for authorization
	// ========================================================================
	describe('GAP 3: Session update requires creator + task ACL', () => {
		test('User with write ACL on task but not creator cannot update session', async () => {
			// Create task owned by taskOwnerUserId
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'task for session update via ACL',
					resource_owner_user_id: taskOwnerUserId,
					created_by: taskOwnerUserId,
					default_working_directory: tmpdir(),
					setup_status: 'completed',
				})
				.returning()

			// Create session with taskOwnerUserId as creator
			const [session] = await db
				.insert(sessions)
				.values({
					organization_id: organizationId,
					resource_owner_user_id: taskOwnerUserId,
					created_by: taskOwnerUserId,
					host_id: hostId,
					task_id: task!.id,
					title: 'session for ACL update test',
					working_directory: tmpdir(),
					coding_agent: 'claude',
					provider: 'anthropic',
					model: 'claude-sonnet-4-5',
					permissions_mode: 'default',
					status: 'ready_for_input',
				})
				.returning()

			// Grant write access to sharedUserId
			await db.insert(taskUserAcl).values({
				organization_id: organizationId,
				subject_user_id: sharedUserId,
				task_id: task!.id,
				resource_owner_user_id: taskOwnerUserId,
				permission_level: 'edit',
				granted_by: taskOwnerUserId,
			})

			// sharedUserId tries to update the session (has edit ACL but is not the creator)
			const apiAuth = createMockApiAuth({
				userId: sharedUserId,
				organizationId,
				workosOrganizationId,
			})

			// EXPECTED: Should fail because sharedUserId is not the session creator
			await expect(
				call(
					updateSessionApiProcedure,
					{
						sessionId: session!.id,
						title: 'Updated by shared user',
					},
					{
						context: createMockApiContext({ auth: apiAuth, services: { db, dbReadReplica: db } }),
					},
				),
			).rejects.toThrow()
		})
	})

	// ========================================================================
	// GAP 4: Check write permission to target task when changing task_id
	// ========================================================================
	describe('GAP 4: Check write permission to target task when changing session task_id', () => {
		test('sessions.update should reject changing to task user cannot write to', async () => {
			// Create task1 owned by sessionCreatorUserId
			const [task1] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'source task',
					resource_owner_user_id: sessionCreatorUserId,
					created_by: sessionCreatorUserId,
					default_working_directory: tmpdir(),
					setup_status: 'completed',
				})
				.returning()

			// Create task2 owned by taskOwnerUserId (no access granted to sessionCreatorUserId)
			const [task2] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'target task (unauthorized)',
					resource_owner_user_id: taskOwnerUserId,
					created_by: taskOwnerUserId,
					default_working_directory: tmpdir(),
					setup_status: 'completed',
				})
				.returning()

			// Create session with task1
			const [session] = await db
				.insert(sessions)
				.values({
					organization_id: organizationId,
					resource_owner_user_id: sessionCreatorUserId,
					created_by: sessionCreatorUserId,
					host_id: hostId,
					task_id: task1!.id,
					title: 'session to move to unauthorized task',
					working_directory: tmpdir(),
					coding_agent: 'claude',
					provider: 'anthropic',
					model: 'claude-sonnet-4-5',
					permissions_mode: 'default',
					status: 'ready_for_input',
				})
				.returning()

			const apiAuth = createMockApiAuth({
				userId: sessionCreatorUserId,
				organizationId,
				workosOrganizationId,
			})

			// EXPECTED: Should throw FORBIDDEN because sessionCreatorUserId cannot write to task2
			// CURRENT: No permission check on target task - succeeds
			await expect(
				call(
					updateSessionApiProcedure,
					{
						sessionId: session!.id,
						taskId: task2!.id,
					},
					{
						context: createMockApiContext({ auth: apiAuth, services: { db, dbReadReplica: db } }),
					},
				),
			).rejects.toThrow() // WILL FAIL - currently succeeds
		})
	})

	// ========================================================================
	// GAP 5: Cascade resource_owner_user_id when task changes
	// ========================================================================
	describe('GAP 5: Cascade resource_owner_user_id when session task_id changes', () => {
		test('Updating session task_id should cascade resource_owner_user_id to session', async () => {
			// Create task1 owned by user1
			const [task1] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'task1 for cascade',
					resource_owner_user_id: 'user1',
					created_by: 'user1',
					default_working_directory: tmpdir(),
					setup_status: 'completed',
				})
				.returning()

			// Create task2 owned by user2 (grant write to user1)
			const [task2] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'task2 for cascade',
					resource_owner_user_id: 'user2',
					created_by: 'user2',
					default_working_directory: tmpdir(),
					setup_status: 'completed',
				})
				.returning()

			await db.insert(taskUserAcl).values({
				organization_id: organizationId,
				subject_user_id: 'user1',
				task_id: task2!.id,
				resource_owner_user_id: 'user2',
				permission_level: 'edit',
				granted_by: 'user2',
			})

			// Create session with task1 (resource_owner_user_id = user1)
			const [session] = await db
				.insert(sessions)
				.values({
					organization_id: organizationId,
					resource_owner_user_id: 'user1',
					created_by: 'user1',
					host_id: hostId,
					task_id: task1!.id,
					title: 'session for ownership cascade',
					working_directory: tmpdir(),
					coding_agent: 'claude',
					provider: 'anthropic',
					model: 'claude-sonnet-4-5',
					permissions_mode: 'default',
					status: 'ready_for_input',
				})
				.returning()

			const apiAuth = createMockApiAuth({
				userId: 'user1',
				organizationId,
				workosOrganizationId,
			})

			// Update session to task2
			await call(
				updateSessionApiProcedure,
				{
					sessionId: session!.id,
					taskId: task2!.id,
				},
				{
					context: createMockApiContext({ auth: apiAuth, services: { db, dbReadReplica: db } }),
				},
			)

			const [updatedSession] = await db.select().from(sessions).where(eq(sessions.id, session!.id)).limit(1)

			// EXPECTED: Session should now have task2's resource_owner_user_id (user2)
			// CURRENT: Session still has user1 as resource_owner_user_id
			expect(updatedSession?.resource_owner_user_id).toBe('user2') // WILL FAIL
		})

		test('Updating session task_id should cascade resource_owner_user_id to conversation_events', async () => {
			// Create task1 owned by user1
			const [task1] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'task1 for event cascade',
					resource_owner_user_id: 'user1',
					created_by: 'user1',
					default_working_directory: tmpdir(),
					setup_status: 'completed',
				})
				.returning()

			// Create task2 owned by user2 (grant write to user1)
			const [task2] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'task2 for event cascade',
					resource_owner_user_id: 'user2',
					created_by: 'user2',
					default_working_directory: tmpdir(),
					setup_status: 'completed',
				})
				.returning()

			await db.insert(taskUserAcl).values({
				organization_id: organizationId,
				subject_user_id: 'user1',
				task_id: task2!.id,
				resource_owner_user_id: 'user2',
				permission_level: 'edit',
				granted_by: 'user2',
			})

			// Create session with task1
			const [session] = await db
				.insert(sessions)
				.values({
					organization_id: organizationId,
					resource_owner_user_id: 'user1',
					created_by: 'user1',
					host_id: hostId,
					task_id: task1!.id,
					title: 'session for event cascade',
					working_directory: tmpdir(),
					coding_agent: 'claude',
					provider: 'anthropic',
					model: 'claude-sonnet-4-5',
					permissions_mode: 'default',
					status: 'ready_for_input',
				})
				.returning()

			// Create a conversation event
			const daemonAuth = createMockDaemonAuth({
				userId: 'user1',
				organizationId,
				hostId,
			})

			await call(
				createEventProcedure,
				{
					sessionId: session!.id,
					codingAgentSessionId: 'test-agent-session',
					eventType: 'message',
					role: 'user',
					content: 'test message',
				},
				{
					context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
				},
			)

			const apiAuth = createMockApiAuth({
				userId: 'user1',
				organizationId,
				workosOrganizationId,
			})

			// Update session to task2
			await call(
				updateSessionApiProcedure,
				{
					sessionId: session!.id,
					taskId: task2!.id,
				},
				{
					context: createMockApiContext({ auth: apiAuth, services: { db, dbReadReplica: db } }),
				},
			)

			const [eventAfter] = await db
				.select()
				.from(conversationEvents)
				.where(eq(conversationEvents.session_id, session!.id))
				.limit(1)

			// EXPECTED: Event should have task2's resource_owner_user_id
			// CURRENT: Only task_id is cascaded, not resource_owner_user_id
			expect(eventAfter?.resource_owner_user_id).toBe('user2') // WILL FAIL
		})

		test('Updating session task_id should cascade resource_owner_user_id to approvals', async () => {
			// Create task1 owned by user1
			const [task1] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'task1 for approval cascade',
					resource_owner_user_id: 'user1',
					created_by: 'user1',
					default_working_directory: tmpdir(),
					setup_status: 'completed',
				})
				.returning()

			// Create task2 owned by user2 (grant write to user1)
			const [task2] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'task2 for approval cascade',
					resource_owner_user_id: 'user2',
					created_by: 'user2',
					default_working_directory: tmpdir(),
					setup_status: 'completed',
				})
				.returning()

			await db.insert(taskUserAcl).values({
				organization_id: organizationId,
				subject_user_id: 'user1',
				task_id: task2!.id,
				resource_owner_user_id: 'user2',
				permission_level: 'edit',
				granted_by: 'user2',
			})

			// Create session with task1
			const [session] = await db
				.insert(sessions)
				.values({
					organization_id: organizationId,
					resource_owner_user_id: 'user1',
					created_by: 'user1',
					host_id: hostId,
					task_id: task1!.id,
					title: 'session for approval cascade',
					working_directory: tmpdir(),
					coding_agent: 'claude',
					provider: 'anthropic',
					model: 'claude-sonnet-4-5',
					permissions_mode: 'default',
					status: 'ready_for_input',
				})
				.returning()

			// Create an approval
			const daemonAuth = createMockDaemonAuth({
				userId: 'user1',
				organizationId,
				hostId,
			})

			await call(
				createApprovalProcedure,
				{
					sessionId: session!.id,
					toolName: 'Bash',
					toolInput: { command: 'ls' },
				},
				{
					context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
				},
			)

			const apiAuth = createMockApiAuth({
				userId: 'user1',
				organizationId,
				workosOrganizationId,
			})

			// Update session to task2
			await call(
				updateSessionApiProcedure,
				{
					sessionId: session!.id,
					taskId: task2!.id,
				},
				{
					context: createMockApiContext({ auth: apiAuth, services: { db, dbReadReplica: db } }),
				},
			)

			const [approvalAfter] = await db
				.select()
				.from(approvals)
				.where(eq(approvals.session_id, session!.id))
				.limit(1)

			// EXPECTED: Approval should have task2's resource_owner_user_id
			// CURRENT: Only task_id is cascaded, not resource_owner_user_id
			expect(approvalAfter?.resource_owner_user_id).toBe('user2') // WILL FAIL
		})
	})

	// ========================================================================
	// GAP 6: Session continue/interrupt should use task ACL
	// ========================================================================
	describe('GAP 6: Session continue/interrupt requires creator + task ACL', () => {
		test('User with write ACL on task but not creator cannot continue session', async () => {
			// Create task owned by taskOwnerUserId
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'task for continue via ACL',
					resource_owner_user_id: taskOwnerUserId,
					created_by: taskOwnerUserId,
					default_working_directory: tmpdir(),
					setup_status: 'completed',
				})
				.returning()

			// Create session with taskOwnerUserId as creator
			const [session] = await db
				.insert(sessions)
				.values({
					organization_id: organizationId,
					resource_owner_user_id: taskOwnerUserId,
					created_by: taskOwnerUserId,
					host_id: hostId,
					task_id: task!.id,
					title: 'session for ACL continue',
					working_directory: tmpdir(),
					coding_agent: 'claude',
					provider: 'anthropic',
					model: 'claude-sonnet-4-5',
					permissions_mode: 'default',
					status: 'ready_for_input',
				})
				.returning()

			// Grant write to sharedUserId
			await db.insert(taskUserAcl).values({
				organization_id: organizationId,
				subject_user_id: sharedUserId,
				task_id: task!.id,
				resource_owner_user_id: taskOwnerUserId,
				permission_level: 'edit',
				granted_by: taskOwnerUserId,
			})

			const apiAuth = createMockApiAuth({
				userId: sharedUserId,
				organizationId,
				workosOrganizationId,
			})

			// EXPECTED: Should fail because sharedUserId is not the session creator
			await expect(
				call(
					continueSessionProcedure,
					{
						sessionId: session!.id,
						text: 'Continued by shared user',
						model: 'claude-sonnet-4-5',
						permissionsMode: 'default',
					},
					{
						context: createMockApiContext({ auth: apiAuth, services: { db, dbReadReplica: db } }),
					},
				),
			).rejects.toThrow()
		})

		test('User with write ACL on task but not creator cannot interrupt session', async () => {
			// Create task owned by taskOwnerUserId
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'task for interrupt via ACL',
					resource_owner_user_id: taskOwnerUserId,
					created_by: taskOwnerUserId,
					default_working_directory: tmpdir(),
					setup_status: 'completed',
				})
				.returning()

			// Create session with taskOwnerUserId as creator, status: 'running'
			const [session] = await db
				.insert(sessions)
				.values({
					organization_id: organizationId,
					resource_owner_user_id: taskOwnerUserId,
					created_by: taskOwnerUserId,
					host_id: hostId,
					task_id: task!.id,
					title: 'session for ACL interrupt',
					working_directory: tmpdir(),
					coding_agent: 'claude',
					provider: 'anthropic',
					model: 'claude-sonnet-4-5',
					permissions_mode: 'default',
					status: 'running',
				})
				.returning()

			// Grant write to sharedUserId
			await db.insert(taskUserAcl).values({
				organization_id: organizationId,
				subject_user_id: sharedUserId,
				task_id: task!.id,
				resource_owner_user_id: taskOwnerUserId,
				permission_level: 'edit',
				granted_by: taskOwnerUserId,
			})

			const apiAuth = createMockApiAuth({
				userId: sharedUserId,
				organizationId,
				workosOrganizationId,
			})

			// EXPECTED: Should fail because sharedUserId is not the session creator
			await expect(
				call(
					interruptSessionProcedure,
					{
						sessionId: session!.id,
					},
					{
						context: createMockApiContext({ auth: apiAuth, services: { db, dbReadReplica: db } }),
					},
				),
			).rejects.toThrow()
		})
	})

	afterAll(async () => {
		await cleanupTestDb?.()
	}, 30000)
})
