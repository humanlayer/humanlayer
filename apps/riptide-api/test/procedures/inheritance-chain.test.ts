import { randomUUID } from 'node:crypto'

import { approvals } from '@humanlayer/db/tables/approvals'
import { artifactOperationsLog } from '@humanlayer/db/tables/artifact-operations-log'
import { artifactVersions } from '@humanlayer/db/tables/artifact-versions'
import { artifacts } from '@humanlayer/db/tables/artifacts'
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

import { createSessionProcedure } from '../../src/orpc/api/sessions/create'
import { createTaskProcedure } from '../../src/orpc/api/tasks/create'
import { createApprovalProcedure } from '../../src/orpc/daemon/approvals/create'
import { upsertArtifactProcedure } from '../../src/orpc/daemon/artifacts/upsert'
import { createEventProcedure } from '../../src/orpc/daemon/sessions/events/create'
import { createMockApiAuth, createMockApiContext, createMockDaemonAuth, createMockDaemonContext } from '../mocks'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('Section 12: Full Inheritance Chain', async () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase

	let organizationId: string
	const workosOrganizationId = 'org_abc123'
	const userId = 'user_abc1234'
	const sharedUserId = 'user_shared456'
	const hostId = randomUUID()

	beforeAll(async () => {
		const testDb = await createTestDb('inheritance_chain')
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

		// Register hosts so API-level host ownership validation passes for sessions.create tests
		await db
			.insert(onlineHosts)
			.values([
				{ host_id: hostId, user_id: userId, organization_id: organizationId },
				{ host_id: hostId, user_id: sharedUserId, organization_id: organizationId },
			])
			.onConflictDoNothing()
	}, 30000)

	describe('12.1 Complete Ownership Chain (tests 136-138)', () => {
		test('Test 136: Task → Session → ConversationEvent: all have same resource_owner_user_id', async () => {
			// Create a task via API
			const apiAuth = createMockApiAuth({
				userId,
				organizationId,
				workosOrganizationId,
			})

			const taskResult = await call(
				createTaskProcedure,
				{
					name: 'test task for conversation event inheritance',
					slug: 'test-task-conv-event',
					defaultWorkingDirectory: '/tmp/test',
					setupStatus: 'completed',
				},
				{
					context: createMockApiContext({ auth: apiAuth, services: { db, dbReadReplica: db } }),
				},
			)

			// Create a session via API
			const sessionResult = await call(
				createSessionProcedure,
				{
					taskId: taskResult.task.id,
					prompt: 'Test prompt',
					workingDirectory: '/tmp/test',
					codingAgent: 'claude',
					permissionsMode: 'default',
					hostId, // Required for daemon to create events on this session
				},
				{
					context: createMockApiContext({ auth: apiAuth, services: { db, dbReadReplica: db } }),
				},
			)

			// Create a conversation event via daemon
			const daemonAuth = createMockDaemonAuth({
				userId,
				organizationId,
				hostId,
			})

			const eventResult = await call(
				createEventProcedure,
				{
					sessionId: sessionResult.session.id,
					codingAgentSessionId: 'test-agent-session-id',
					eventType: 'message',
					role: 'user',
					content: 'Test message',
				},
				{
					context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
				},
			)

			// Fetch all three from the database and verify resource_owner_user_id
			const [task] = await db.select().from(tasks).where(eq(tasks.id, taskResult.task.id)).limit(1)

			const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionResult.session.id)).limit(1)

			const [event] = await db
				.select()
				.from(conversationEvents)
				.where(eq(conversationEvents.id, eventResult.eventId))
				.limit(1)

			expect(task).toBeDefined()
			expect(session).toBeDefined()
			expect(event).toBeDefined()

			// All three should have the same resource_owner_user_id
			expect(task?.resource_owner_user_id).toBe(userId)
			expect(session?.resource_owner_user_id).toBe(userId)
			expect(event?.resource_owner_user_id).toBe(userId)

			// Verify they all match
			expect(task?.resource_owner_user_id).toBe(session?.resource_owner_user_id)
			expect(session?.resource_owner_user_id).toBe(event?.resource_owner_user_id)
		})

		test('Test 137: Task → Session → Approval: all have same resource_owner_user_id', async () => {
			// Create a task via API
			const apiAuth = createMockApiAuth({
				userId,
				organizationId,
				workosOrganizationId,
			})

			const taskResult = await call(
				createTaskProcedure,
				{
					name: 'test task for approval inheritance',
					slug: 'test-task-approval',
					defaultWorkingDirectory: '/tmp/test',
					setupStatus: 'completed',
				},
				{
					context: createMockApiContext({ auth: apiAuth, services: { db, dbReadReplica: db } }),
				},
			)

			// Create a session directly in DB (to control host_id for daemon auth)
			const [session] = await db
				.insert(sessions)
				.values({
					organization_id: organizationId,
					task_id: taskResult.task.id,
					resource_owner_user_id: userId,
					created_by: userId,
					host_id: hostId,
					status: 'running',
					working_directory: '/tmp/test',
				})
				.returning()

			if (!session) throw new Error('Failed to create session')

			// Create an approval via daemon
			const daemonAuth = createMockDaemonAuth({
				userId,
				organizationId,
				hostId,
			})

			const approvalResult = await call(
				createApprovalProcedure,
				{
					sessionId: session.id,
					toolName: 'test_tool',
					toolInput: { param: 'test value' },
				},
				{
					context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
				},
			)

			// Fetch all three from the database and verify resource_owner_user_id
			const [task] = await db.select().from(tasks).where(eq(tasks.id, taskResult.task.id)).limit(1)

			const [approval] = await db
				.select()
				.from(approvals)
				.where(eq(approvals.id, approvalResult.approvalId))
				.limit(1)

			expect(task).toBeDefined()
			expect(session).toBeDefined()
			expect(approval).toBeDefined()

			// All three should have the same resource_owner_user_id
			expect(task?.resource_owner_user_id).toBe(userId)
			expect(session.resource_owner_user_id).toBe(userId)
			expect(approval?.resource_owner_user_id).toBe(userId)

			// Verify they all match
			expect(task?.resource_owner_user_id).toBe(session.resource_owner_user_id)
			expect(session.resource_owner_user_id).toBe(approval!.resource_owner_user_id)
		})

		test('Test 138: Task → Artifact → ArtifactVersion: all have same resource_owner_user_id', async () => {
			// Create a task via API
			const apiAuth = createMockApiAuth({
				userId,
				organizationId,
				workosOrganizationId,
			})

			const taskResult = await call(
				createTaskProcedure,
				{
					name: 'test task for artifact version inheritance',
					slug: 'test-task-artifact-version',
					defaultWorkingDirectory: '/tmp/test',
					setupStatus: 'completed',
				},
				{
					context: createMockApiContext({ auth: apiAuth, services: { db, dbReadReplica: db } }),
				},
			)

			// Create an artifact via daemon
			const daemonAuth = createMockDaemonAuth({
				userId,
				organizationId,
				hostId,
			})

			const artifactResult = await call(
				upsertArtifactProcedure,
				{
					taskId: taskResult.task.id,
					fileName: 'test-version-chain.md',
					content: '# Original content',
				},
				{
					context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
				},
			)

			// Update the artifact to create a version
			await call(
				upsertArtifactProcedure,
				{
					taskId: taskResult.task.id,
					fileName: 'test-version-chain.md',
					content: '# Updated content',
				},
				{
					context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
				},
			)

			// Fetch all three from the database and verify resource_owner_user_id
			const [task] = await db.select().from(tasks).where(eq(tasks.id, taskResult.task.id)).limit(1)

			const [artifact] = await db
				.select()
				.from(artifacts)
				.where(eq(artifacts.id, artifactResult.artifactId))
				.limit(1)

			const [version] = await db
				.select()
				.from(artifactVersions)
				.where(eq(artifactVersions.artifact_id, artifactResult.artifactId))
				.limit(1)

			expect(task).toBeDefined()
			expect(artifact).toBeDefined()
			expect(version).toBeDefined()

			// All three should have the same resource_owner_user_id
			expect(task?.resource_owner_user_id).toBe(userId)
			expect(artifact?.resource_owner_user_id).toBe(userId)
			expect(version?.resource_owner_user_id).toBe(userId)

			// Verify they all match
			expect(task?.resource_owner_user_id).toBe(artifact?.resource_owner_user_id)
			expect(artifact?.resource_owner_user_id).toBe(version?.resource_owner_user_id)
		})
	})

	describe('12.2 Shared User Creates Resources (tests 139-140)', () => {
		test('Test 139: Shared users artifact has owners resource_owner_user_id, shared users created_by', async () => {
			// Create a task owned by userId via API
			const ownerAuth = createMockApiAuth({
				userId,
				organizationId,
				workosOrganizationId,
			})

			const taskResult = await call(
				createTaskProcedure,
				{
					name: 'test task for shared user artifact',
					slug: 'test-task-shared',
					defaultWorkingDirectory: '/tmp/test',
					setupStatus: 'completed',
				},
				{
					context: createMockApiContext({ auth: ownerAuth, services: { db, dbReadReplica: db } }),
				},
			)

			// Grant access to sharedUserId via taskUserAcl
			await db.insert(taskUserAcl).values({
				organization_id: organizationId,
				subject_user_id: sharedUserId,
				task_id: taskResult.task.id,
				resource_owner_user_id: userId,
				permission_level: 'edit',
				granted_by: userId,
			})

			// Shared user creates an artifact via daemon
			const sharedDaemonAuth = createMockDaemonAuth({
				userId: sharedUserId,
				organizationId,
				hostId,
			})

			const artifactResult = await call(
				upsertArtifactProcedure,
				{
					taskId: taskResult.task.id,
					fileName: 'shared-user-artifact.md',
					content: '# Created by shared user',
				},
				{
					context: createMockDaemonContext({ auth: sharedDaemonAuth, services: { db, dbReadReplica: db } }),
				},
			)

			// Fetch the artifact from the database
			const [artifact] = await db
				.select()
				.from(artifacts)
				.where(eq(artifacts.id, artifactResult.artifactId))
				.limit(1)

			expect(artifact).toBeDefined()

			// resource_owner_user_id should be the task owner (userId)
			expect(artifact?.resource_owner_user_id).toBe(userId)

			// created_by should be the shared user (sharedUserId)
			expect(artifact?.created_by).toBe(sharedUserId)

			// These two should be different
			expect(artifact?.resource_owner_user_id).not.toBe(artifact?.created_by)
		})

		test('Test 140: Operations log shows shared user as created_by', async () => {
			// Create a task owned by userId via API
			const ownerAuth = createMockApiAuth({
				userId,
				organizationId,
				workosOrganizationId,
			})

			const taskResult = await call(
				createTaskProcedure,
				{
					name: 'test task for shared user operations log',
					slug: 'test-task-shared-ops-log',
					defaultWorkingDirectory: '/tmp/test',
					setupStatus: 'completed',
				},
				{
					context: createMockApiContext({ auth: ownerAuth, services: { db, dbReadReplica: db } }),
				},
			)

			// Grant access to sharedUserId via taskUserAcl
			await db.insert(taskUserAcl).values({
				organization_id: organizationId,
				subject_user_id: sharedUserId,
				task_id: taskResult.task.id,
				resource_owner_user_id: userId,
				permission_level: 'edit',
				granted_by: userId,
			})

			// Shared user creates an artifact with operation logging via daemon
			const sharedDaemonAuth = createMockDaemonAuth({
				userId: sharedUserId,
				organizationId,
				hostId,
			})

			const artifactResult = await call(
				upsertArtifactProcedure,
				{
					taskId: taskResult.task.id,
					fileName: 'shared-user-ops-log.md',
					content: '# Created by shared user',
					operationType: 'Write',
					operationContents: { tool: 'write_file', path: 'shared-user-ops-log.md' },
				},
				{
					context: createMockDaemonContext({ auth: sharedDaemonAuth, services: { db, dbReadReplica: db } }),
				},
			)

			// Fetch the operations log entry
			const [logEntry] = await db
				.select()
				.from(artifactOperationsLog)
				.where(eq(artifactOperationsLog.artifact_id, artifactResult.artifactId))
				.limit(1)

			expect(logEntry).toBeDefined()

			// resource_owner_user_id should be the task owner (userId)
			expect(logEntry?.resource_owner_user_id).toBe(userId)

			// created_by should be the shared user (sharedUserId)
			expect(logEntry?.created_by).toBe(sharedUserId)

			// These two should be different
			expect(logEntry?.resource_owner_user_id).not.toBe(logEntry?.created_by)
		})
	})

	afterAll(async () => {
		await cleanupTestDb?.()
	}, 30000)
})
