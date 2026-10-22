import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'

import { conversationEvents } from '@humanlayer/db/tables/conversation-events'
import { onlineHosts } from '@humanlayer/db/tables/online-hosts'
import { organizations } from '@humanlayer/db/tables/organizations'
import { sessions } from '@humanlayer/db/tables/sessions'
import { taskUserAcl } from '@humanlayer/db/tables/task-user-acl'
import { taskUserSettings } from '@humanlayer/db/tables/task-user-settings'
import { tasks } from '@humanlayer/db/tables/tasks'
import { call } from '@orpc/server'
import { eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { continueSessionProcedure } from '../../src/orpc/api/sessions/continue'
import { createSessionProcedure } from '../../src/orpc/api/sessions/create'
import { interruptSessionProcedure as liveInterruptSessionProcedure } from '../../src/orpc/api/sessions/interrupt'
import { launchSessionProcedure } from '../../src/orpc/api/sessions/launch'
import { updateSessionApiProcedure } from '../../src/orpc/api/sessions/update'
import { archiveTaskProcedure } from '../../src/orpc/api/tasks/archive'
import { updateTaskProcedure } from '../../src/orpc/api/tasks/update'
import { createMockApiAuth, createMockApiContext } from '../mocks'
import { bindProcedureToRuntime, createRuntimeWithTestPostgresLayer } from '../utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

/**
 * Access Control Tests - Three-Actor Pattern
 *
 * Every access control test MUST include three actors:
 * 1. Owner - The resource owner (resource_owner_user_id)
 * 2. Stranger - User with no access (different user, no ACL)
 * 3. ACL-holder - User with ACL access but not ownership
 *
 * Tests verify:
 * - Positive cases: Owner and ACL-holder can access
 * - Negative cases: Stranger cannot access
 * - DB state verification: Mutations actually occur (or don't)
 */
describe('Task/Session Access Control - Three-Actor Pattern', async () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let effectRuntime: ReturnType<typeof createRuntimeWithTestPostgresLayer> | undefined
	let interruptSessionProcedure: typeof liveInterruptSessionProcedure

	let organizationId: string
	const workosOrganizationId = 'org_abc123'

	// Three actors
	const ownerUserId = 'user_owner_123'
	const aclHolderUserId = 'user_acl_holder_456'
	const strangerUserId = 'user_stranger_789'
	// Admin actor: same org, non-owner, no ACL (force-archive / force-rename bypass)
	const adminUserId = 'user_admin_999'

	const hostId = randomUUID()

	beforeAll(async () => {
		const testDb = await createTestDb('access_control')
		cleanupTestDb = testDb.cleanup
		db = testDb.db
		effectRuntime = createRuntimeWithTestPostgresLayer(db)
		interruptSessionProcedure = bindProcedureToRuntime(liveInterruptSessionProcedure, effectRuntime)

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

		// Register hosts for ownerUserId and aclHolderUserId so API-level host validation passes
		await db
			.insert(onlineHosts)
			.values([
				{ host_id: hostId, user_id: ownerUserId, organization_id: organizationId, status: 'online' },
				{ host_id: hostId, user_id: aclHolderUserId, organization_id: organizationId, status: 'online' },
			])
			.onConflictDoNothing()
	}, 30000)

	describe('tasks.update access control', () => {
		test('Owner can update their own task and DB reflects changes', async () => {
			const originalName = 'owner task'
			const updatedName = 'updated owner task'

			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: originalName,
					resource_owner_user_id: ownerUserId,
					created_by: ownerUserId,
					default_working_directory: tmpdir(),
					setup_status: 'completed',
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			const result = await call(
				updateTaskProcedure,
				{ taskId: task.id, name: updatedName },
				{
					context: createMockApiContext({
						auth: createMockApiAuth({ userId: ownerUserId, organizationId, workosOrganizationId }),
						services: { db, dbReadReplica: db },
					}),
				},
			)

			expect(result.success).toBe(true)

			// Verify DB state actually changed
			const [updatedTask] = await db.select().from(tasks).where(eq(tasks.id, task.id)).limit(1)
			expect(updatedTask?.name).toBe(updatedName)
			expect(updatedTask?.name).not.toBe(originalName)
		})

		test('ACL-holder with write permission can update user-settings-compatible fields and DB reflects changes in task_user_settings', async () => {
			const originalWorkingDir = tmpdir()
			const updatedWorkingDir = '/updated/working/dir'

			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'acl task',
					resource_owner_user_id: ownerUserId,
					created_by: ownerUserId,
					default_working_directory: originalWorkingDir,
					setup_status: 'completed',
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			// Grant write ACL to aclHolderUserId
			await db.insert(taskUserAcl).values({
				organization_id: organizationId,
				subject_user_id: aclHolderUserId,
				task_id: task.id,
				resource_owner_user_id: ownerUserId,
				permission_level: 'edit',
				granted_by: ownerUserId,
			})

			const result = await call(
				updateTaskProcedure,
				{ taskId: task.id, defaultWorkingDirectory: updatedWorkingDir },
				{
					context: createMockApiContext({
						auth: createMockApiAuth({ userId: aclHolderUserId, organizationId, workosOrganizationId }),
						services: { db, dbReadReplica: db },
					}),
				},
			)

			expect(result.success).toBe(true)

			// Verify task table is UNCHANGED (ACL-holder cannot modify task directly)
			const [unchangedTask] = await db.select().from(tasks).where(eq(tasks.id, task.id)).limit(1)
			expect(unchangedTask?.default_working_directory).toBe(originalWorkingDir)

			// Verify task_user_settings was created with the user's working directory
			const [userSettings] = await db
				.select()
				.from(taskUserSettings)
				.where(eq(taskUserSettings.task_id, task.id))
				.limit(1)
			expect(userSettings?.user_id).toBe(aclHolderUserId)
			expect(userSettings?.working_directory).toBe(updatedWorkingDir)
		})

		test('ACL-holder with write permission CANNOT update task-only fields (name, slug, etc.)', async () => {
			const originalName = 'acl task name restriction'

			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: originalName,
					resource_owner_user_id: ownerUserId,
					created_by: ownerUserId,
					default_working_directory: tmpdir(),
					setup_status: 'completed',
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			// Grant write ACL to aclHolderUserId
			await db.insert(taskUserAcl).values({
				organization_id: organizationId,
				subject_user_id: aclHolderUserId,
				task_id: task.id,
				resource_owner_user_id: ownerUserId,
				permission_level: 'edit',
				granted_by: ownerUserId,
			})

			// ACL-holder tries to update name - should be forbidden
			await expect(
				call(
					updateTaskProcedure,
					{ taskId: task.id, name: 'attempted rename by acl holder' },
					{
						context: createMockApiContext({
							auth: createMockApiAuth({ userId: aclHolderUserId, organizationId, workosOrganizationId }),
							services: { db, dbReadReplica: db },
						}),
					},
				),
			).rejects.toThrow()

			// Verify DB state is unchanged
			const [unchangedTask] = await db.select().from(tasks).where(eq(tasks.id, task.id)).limit(1)
			expect(unchangedTask?.name).toBe(originalName)
		})

		test('Stranger cannot update task (gets NOT_FOUND) and DB is unchanged', async () => {
			const originalName = 'stranger test task'

			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: originalName,
					resource_owner_user_id: ownerUserId,
					created_by: ownerUserId,
					default_working_directory: tmpdir(),
					setup_status: 'completed',
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			// Stranger tries to update
			await expect(
				call(
					updateTaskProcedure,
					{ taskId: task.id, name: 'hacked name' },
					{
						context: createMockApiContext({
							auth: createMockApiAuth({ userId: strangerUserId, organizationId, workosOrganizationId }),
							services: { db, dbReadReplica: db },
						}),
					},
				),
			).rejects.toThrow()

			// Verify DB state is unchanged
			const [unchangedTask] = await db.select().from(tasks).where(eq(tasks.id, task.id)).limit(1)
			expect(unchangedTask?.name).toBe(originalName)
		})

		test('ACL-holder with read-only permission cannot update task', async () => {
			const originalName = 'read only task'

			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: originalName,
					resource_owner_user_id: ownerUserId,
					created_by: ownerUserId,
					default_working_directory: tmpdir(),
					setup_status: 'completed',
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			// Grant read-only ACL
			await db.insert(taskUserAcl).values({
				organization_id: organizationId,
				subject_user_id: aclHolderUserId,
				task_id: task.id,
				resource_owner_user_id: ownerUserId,
				permission_level: 'read',
				granted_by: ownerUserId,
			})

			// Read-only ACL holder tries to update
			await expect(
				call(
					updateTaskProcedure,
					{ taskId: task.id, name: 'attempted update' },
					{
						context: createMockApiContext({
							auth: createMockApiAuth({ userId: aclHolderUserId, organizationId, workosOrganizationId }),
							services: { db, dbReadReplica: db },
						}),
					},
				),
			).rejects.toThrow()

			// Verify DB state is unchanged
			const [unchangedTask] = await db.select().from(tasks).where(eq(tasks.id, task.id)).limit(1)
			expect(unchangedTask?.name).toBe(originalName)
		})

		test('Admin (non-owner, no ACL) can force-rename a task (name only) and DB reflects changes', async () => {
			const originalName = 'admin force-rename original'
			const updatedName = 'admin force-rename updated'

			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: originalName,
					resource_owner_user_id: ownerUserId,
					created_by: ownerUserId,
					default_working_directory: tmpdir(),
					setup_status: 'completed',
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			const result = await call(
				updateTaskProcedure,
				{ taskId: task.id, name: updatedName },
				{
					context: createMockApiContext({
						auth: createMockApiAuth({
							userId: adminUserId,
							organizationId,
							workosOrganizationId,
							roles: ['admin'],
						}),
						services: { db, dbReadReplica: db },
					}),
				},
			)

			expect(result.success).toBe(true)

			const [updatedTask] = await db.select().from(tasks).where(eq(tasks.id, task.id)).limit(1)
			expect(updatedTask?.name).toBe(updatedName)
		})

		test('Admin force-rename with a non-name owner-only field (slug) is still FORBIDDEN and DB unchanged', async () => {
			const originalName = 'admin non-name field task'

			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: originalName,
					resource_owner_user_id: ownerUserId,
					created_by: ownerUserId,
					default_working_directory: tmpdir(),
					setup_status: 'completed',
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			// Admin bypass is narrow — name-only. A slug (owner-only field) disqualifies it.
			await expect(
				call(
					updateTaskProcedure,
					{ taskId: task.id, name: 'admin rename attempt', slug: 'admin-slug' },
					{
						context: createMockApiContext({
							auth: createMockApiAuth({
								userId: adminUserId,
								organizationId,
								workosOrganizationId,
								roles: ['admin'],
							}),
							services: { db, dbReadReplica: db },
						}),
					},
				),
			).rejects.toThrow()

			const [unchangedTask] = await db.select().from(tasks).where(eq(tasks.id, task.id)).limit(1)
			expect(unchangedTask?.name).toBe(originalName)
			expect(unchangedTask?.slug).toBeNull()
		})

		test('Admin bypass is org-scoped: admin from a different org cannot force-rename and DB unchanged', async () => {
			const originalName = 'cross-org admin rename task'

			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: originalName,
					resource_owner_user_id: ownerUserId,
					created_by: ownerUserId,
					default_working_directory: tmpdir(),
					setup_status: 'completed',
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			const [otherOrg] = await db
				.insert(organizations)
				.values({ name: 'other admin org', workos_organization_id: 'org_other_admin_rename' })
				.returning()

			if (!otherOrg) throw new Error('Failed to create other org')

			await expect(
				call(
					updateTaskProcedure,
					{ taskId: task.id, name: 'cross-org hacked name' },
					{
						context: createMockApiContext({
							auth: createMockApiAuth({
								userId: adminUserId,
								organizationId: otherOrg.id,
								workosOrganizationId: 'org_other_admin_rename',
								roles: ['admin'],
							}),
							services: { db, dbReadReplica: db },
						}),
					},
				),
			).rejects.toThrow()

			const [unchangedTask] = await db.select().from(tasks).where(eq(tasks.id, task.id)).limit(1)
			expect(unchangedTask?.name).toBe(originalName)
		})
	})

	describe('tasks.archive access control', () => {
		test('Owner can archive their own task and DB reflects changes', async () => {
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'owner task for archive',
					resource_owner_user_id: ownerUserId,
					created_by: ownerUserId,
					default_working_directory: tmpdir(),
					setup_status: 'completed',
					archived: false,
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			const result = await call(
				archiveTaskProcedure,
				{ taskId: task.id, archived: true, cascadeToSessions: false },
				{
					context: createMockApiContext({
						auth: createMockApiAuth({ userId: ownerUserId, organizationId, workosOrganizationId }),
						services: { db, dbReadReplica: db },
					}),
				},
			)

			expect(result.success).toBe(true)

			// Verify DB state
			const [archivedTask] = await db.select().from(tasks).where(eq(tasks.id, task.id)).limit(1)
			expect(archivedTask?.archived).toBe(true)
		})

		test('Stranger cannot archive task and DB is unchanged', async () => {
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'stranger archive task',
					resource_owner_user_id: ownerUserId,
					created_by: ownerUserId,
					default_working_directory: tmpdir(),
					setup_status: 'completed',
					archived: false,
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			await expect(
				call(
					archiveTaskProcedure,
					{ taskId: task.id, archived: true, cascadeToSessions: false },
					{
						context: createMockApiContext({
							auth: createMockApiAuth({ userId: strangerUserId, organizationId, workosOrganizationId }),
							services: { db, dbReadReplica: db },
						}),
					},
				),
			).rejects.toThrow()

			// Verify DB state unchanged
			const [unchangedTask] = await db.select().from(tasks).where(eq(tasks.id, task.id)).limit(1)
			expect(unchangedTask?.archived).toBe(false)
		})

		test('Admin (non-owner, no ACL) can force-archive a task and DB reflects changes', async () => {
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'admin force-archive task',
					resource_owner_user_id: ownerUserId,
					created_by: ownerUserId,
					default_working_directory: tmpdir(),
					setup_status: 'completed',
					archived: false,
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			const result = await call(
				archiveTaskProcedure,
				{ taskId: task.id, archived: true, cascadeToSessions: false },
				{
					context: createMockApiContext({
						auth: createMockApiAuth({
							userId: adminUserId,
							organizationId,
							workosOrganizationId,
							roles: ['admin'],
						}),
						services: { db, dbReadReplica: db },
					}),
				},
			)

			expect(result.success).toBe(true)

			const [archivedTask] = await db.select().from(tasks).where(eq(tasks.id, task.id)).limit(1)
			expect(archivedTask?.archived).toBe(true)
		})

		test('Admin bypass is org-scoped: admin from a different org cannot force-archive and DB unchanged', async () => {
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'cross-org admin archive task',
					resource_owner_user_id: ownerUserId,
					created_by: ownerUserId,
					default_working_directory: tmpdir(),
					setup_status: 'completed',
					archived: false,
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			const [otherOrg] = await db
				.insert(organizations)
				.values({ name: 'other admin archive org', workos_organization_id: 'org_other_admin_archive' })
				.returning()

			if (!otherOrg) throw new Error('Failed to create other org')

			await expect(
				call(
					archiveTaskProcedure,
					{ taskId: task.id, archived: true, cascadeToSessions: false },
					{
						context: createMockApiContext({
							auth: createMockApiAuth({
								userId: adminUserId,
								organizationId: otherOrg.id,
								workosOrganizationId: 'org_other_admin_archive',
								roles: ['admin'],
							}),
							services: { db, dbReadReplica: db },
						}),
					},
				),
			).rejects.toThrow()

			const [unchangedTask] = await db.select().from(tasks).where(eq(tasks.id, task.id)).limit(1)
			expect(unchangedTask?.archived).toBe(false)
		})
	})

	describe('sessions.update access control', () => {
		test('Owner can update their own session and DB reflects changes', async () => {
			const originalTitle = 'owner session'
			const updatedTitle = 'updated owner session'

			const [session] = await db
				.insert(sessions)
				.values({
					organization_id: organizationId,
					resource_owner_user_id: ownerUserId,
					created_by: ownerUserId,
					host_id: hostId,
					title: originalTitle,
					working_directory: tmpdir(),
					coding_agent: 'claude',
					provider: 'anthropic',
					model: 'claude-sonnet-4-5',
					permissions_mode: 'accept_edits',
					status: 'ready_for_input',
				})
				.returning()

			if (!session) throw new Error('Failed to create session')

			const result = await call(
				updateSessionApiProcedure,
				{ sessionId: session.id, title: updatedTitle },
				{
					context: createMockApiContext({
						auth: createMockApiAuth({ userId: ownerUserId, organizationId, workosOrganizationId }),
						services: { db, dbReadReplica: db },
					}),
				},
			)

			expect(result.success).toBe(true)

			// Verify DB state
			const [updatedSession] = await db.select().from(sessions).where(eq(sessions.id, session.id)).limit(1)
			expect(updatedSession?.title).toBe(updatedTitle)
		})

		test('Stranger cannot update session and DB is unchanged', async () => {
			const originalTitle = 'stranger session'

			const [session] = await db
				.insert(sessions)
				.values({
					organization_id: organizationId,
					resource_owner_user_id: ownerUserId,
					created_by: ownerUserId,
					host_id: hostId,
					title: originalTitle,
					working_directory: tmpdir(),
					coding_agent: 'claude',
					provider: 'anthropic',
					model: 'claude-sonnet-4-5',
					permissions_mode: 'accept_edits',
					status: 'ready_for_input',
				})
				.returning()

			if (!session) throw new Error('Failed to create session')

			await expect(
				call(
					updateSessionApiProcedure,
					{ sessionId: session.id, title: 'hacked session title' },
					{
						context: createMockApiContext({
							auth: createMockApiAuth({ userId: strangerUserId, organizationId, workosOrganizationId }),
							services: { db, dbReadReplica: db },
						}),
					},
				),
			).rejects.toThrow()

			// Verify DB state unchanged
			const [unchangedSession] = await db.select().from(sessions).where(eq(sessions.id, session.id)).limit(1)
			expect(unchangedSession?.title).toBe(originalTitle)
		})
	})

	describe('sessions.interrupt access control', () => {
		test('Owner can interrupt their own session and DB reflects status change', async () => {
			const [session] = await db
				.insert(sessions)
				.values({
					organization_id: organizationId,
					resource_owner_user_id: ownerUserId,
					created_by: ownerUserId,
					host_id: hostId,
					title: 'owner running session',
					working_directory: tmpdir(),
					coding_agent: 'claude',
					provider: 'anthropic',
					model: 'claude-sonnet-4-5',
					permissions_mode: 'accept_edits',
					status: 'running',
				})
				.returning()

			if (!session) throw new Error('Failed to create session')

			const result = await call(
				interruptSessionProcedure,
				{ sessionId: session.id },
				{
					context: createMockApiContext({
						auth: createMockApiAuth({ userId: ownerUserId, organizationId, workosOrganizationId }),
						services: { db, dbReadReplica: db },
					}),
				},
			)

			expect(result.success).toBe(true)

			// Verify DB state - status should change
			const [interruptedSession] = await db.select().from(sessions).where(eq(sessions.id, session.id)).limit(1)
			expect(interruptedSession?.status).not.toBe('running')
		})

		test('Stranger cannot interrupt session and DB status is unchanged', async () => {
			const [session] = await db
				.insert(sessions)
				.values({
					organization_id: organizationId,
					resource_owner_user_id: ownerUserId,
					created_by: ownerUserId,
					host_id: hostId,
					title: 'stranger interrupt session',
					working_directory: tmpdir(),
					coding_agent: 'claude',
					provider: 'anthropic',
					model: 'claude-sonnet-4-5',
					permissions_mode: 'accept_edits',
					status: 'running',
				})
				.returning()

			if (!session) throw new Error('Failed to create session')

			await expect(
				call(
					interruptSessionProcedure,
					{ sessionId: session.id },
					{
						context: createMockApiContext({
							auth: createMockApiAuth({ userId: strangerUserId, organizationId, workosOrganizationId }),
							services: { db, dbReadReplica: db },
						}),
					},
				),
			).rejects.toThrow()

			// Verify DB state unchanged
			const [unchangedSession] = await db.select().from(sessions).where(eq(sessions.id, session.id)).limit(1)
			expect(unchangedSession?.status).toBe('running')
		})
	})

	describe('sessions.continue access control', () => {
		test('Owner can resume a lost session and clear its warning', async () => {
			const [session] = await db
				.insert(sessions)
				.values({
					organization_id: organizationId,
					resource_owner_user_id: ownerUserId,
					created_by: ownerUserId,
					host_id: hostId,
					title: 'lost owner session',
					working_directory: tmpdir(),
					coding_agent: 'claude',
					provider: 'anthropic',
					model: 'claude-sonnet-4-5',
					permissions_mode: 'accept_edits',
					status: 'lost',
					error_message: 'session appears lost',
				})
				.returning()

			await call(
				continueSessionProcedure,
				{
					sessionId: session!.id,
					text: 'retry this session',
					model: 'claude-sonnet-4-5',
					permissionsMode: 'accept_edits',
				},
				{
					context: createMockApiContext({
						auth: createMockApiAuth({ userId: ownerUserId, organizationId, workosOrganizationId }),
						services: { db, dbReadReplica: db },
					}),
				},
			)

			const [updated] = await db.select().from(sessions).where(eq(sessions.id, session!.id))
			expect(updated).toMatchObject({ status: 'resuming', error_message: null, prompt: 'retry this session' })
			const events = await db
				.select()
				.from(conversationEvents)
				.where(eq(conversationEvents.session_id, session!.id))
			expect(events).toHaveLength(1)
			expect(events[0]).toMatchObject({ event_type: 'message', role: 'user', content: 'retry this session' })
		})

		test('Owner can continue their own session and DB reflects changes', async () => {
			const [session] = await db
				.insert(sessions)
				.values({
					organization_id: organizationId,
					resource_owner_user_id: ownerUserId,
					created_by: ownerUserId,
					host_id: hostId,
					title: 'owner ready session',
					working_directory: tmpdir(),
					coding_agent: 'claude',
					provider: 'anthropic',
					model: 'claude-sonnet-4-5',
					permissions_mode: 'accept_edits',
					status: 'ready_for_input',
				})
				.returning()

			if (!session) throw new Error('Failed to create session')

			const result = await call(
				continueSessionProcedure,
				{
					sessionId: session.id,
					text: 'continue with this message',
					model: 'claude-sonnet-4-5',
					permissionsMode: 'accept_edits',
				},
				{
					context: createMockApiContext({
						auth: createMockApiAuth({ userId: ownerUserId, organizationId, workosOrganizationId }),
						services: { db, dbReadReplica: db },
					}),
				},
			)

			expect(result.success).toBe(true)
		})

		test('Stranger cannot continue session', async () => {
			const [session] = await db
				.insert(sessions)
				.values({
					organization_id: organizationId,
					resource_owner_user_id: ownerUserId,
					created_by: ownerUserId,
					host_id: hostId,
					title: 'stranger continue session',
					working_directory: tmpdir(),
					coding_agent: 'claude',
					provider: 'anthropic',
					model: 'claude-sonnet-4-5',
					permissions_mode: 'accept_edits',
					status: 'ready_for_input',
				})
				.returning()

			if (!session) throw new Error('Failed to create session')

			await expect(
				call(
					continueSessionProcedure,
					{
						sessionId: session.id,
						text: 'hacked message',
						model: 'claude-sonnet-4-5',
						permissionsMode: 'accept_edits',
					},
					{
						context: createMockApiContext({
							auth: createMockApiAuth({ userId: strangerUserId, organizationId, workosOrganizationId }),
							services: { db, dbReadReplica: db },
						}),
					},
				),
			).rejects.toThrow()
		})
	})

	describe('Cross-Resource Authorization', () => {
		test('User cannot create session for task they do not own and have no ACL', async () => {
			// Create task owned by ownerUserId
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'owner only task',
					resource_owner_user_id: ownerUserId,
					created_by: ownerUserId,
					default_working_directory: tmpdir(),
					setup_status: 'completed',
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			// Stranger tries to launch session for owner's task
			await expect(
				call(
					launchSessionProcedure,
					{
						taskId: task.id,
						text: 'hacked session',
						workingDirectory: tmpdir(),
						hostId: hostId,
						codingAgent: 'claude',
						provider: 'anthropic',
						model: 'opus',
						permissionsMode: 'default',
					},
					{
						context: createMockApiContext({
							auth: createMockApiAuth({ userId: strangerUserId, organizationId, workosOrganizationId }),
							services: { db, dbReadReplica: db },
						}),
					},
				),
			).rejects.toThrow()

			// Verify no session was created for this task
			const sessionsForTask = await db.select().from(sessions).where(eq(sessions.task_id, task.id))
			expect(sessionsForTask.length).toBe(0)
		})

		test('User with write ACL can create session for shared task', async () => {
			// Create task owned by ownerUserId
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'shared task for session',
					resource_owner_user_id: ownerUserId,
					created_by: ownerUserId,
					default_working_directory: tmpdir(),
					setup_status: 'completed',
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			// Grant write ACL to aclHolderUserId
			await db.insert(taskUserAcl).values({
				organization_id: organizationId,
				subject_user_id: aclHolderUserId,
				task_id: task.id,
				resource_owner_user_id: ownerUserId,
				permission_level: 'edit',
				granted_by: ownerUserId,
			})

			// ACL holder launches session
			const result = await call(
				launchSessionProcedure,
				{
					taskId: task.id,
					text: 'acl holder session',
					workingDirectory: tmpdir(),
					hostId: hostId,
					codingAgent: 'claude',
					provider: 'anthropic',
					model: 'opus',
					permissionsMode: 'default',
				},
				{
					context: createMockApiContext({
						auth: createMockApiAuth({ userId: aclHolderUserId, organizationId, workosOrganizationId }),
						services: { db, dbReadReplica: db },
					}),
				},
			)

			expect(result.session.id).toBeDefined()

			// Verify session was created and ownership is inherited from task
			const [createdSession] = await db.select().from(sessions).where(eq(sessions.id, result.session.id)).limit(1)

			expect(createdSession?.task_id).toBe(task.id)
			expect(createdSession?.resource_owner_user_id).toBe(ownerUserId) // Inherited from task
			expect(createdSession?.created_by).toBe(aclHolderUserId) // Actual creator
		})

		test('Cannot move session to task user does not have access to (confused deputy)', async () => {
			// Create two tasks - one owned by owner, one by stranger
			const [ownerTask] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'owner task',
					resource_owner_user_id: ownerUserId,
					created_by: ownerUserId,
					default_working_directory: tmpdir(),
					setup_status: 'completed',
				})
				.returning()

			const [strangerTask] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'stranger task',
					resource_owner_user_id: strangerUserId,
					created_by: strangerUserId,
					default_working_directory: tmpdir(),
					setup_status: 'completed',
				})
				.returning()

			if (!ownerTask || !strangerTask) throw new Error('Failed to create tasks')

			// Create session on owner's task
			const [session] = await db
				.insert(sessions)
				.values({
					organization_id: organizationId,
					resource_owner_user_id: ownerUserId,
					created_by: ownerUserId,
					host_id: hostId,
					task_id: ownerTask.id,
					title: 'session to move',
					working_directory: tmpdir(),
					coding_agent: 'claude',
					provider: 'anthropic',
					model: 'claude-sonnet-4-5',
					permissions_mode: 'accept_edits',
					status: 'ready_for_input',
				})
				.returning()

			if (!session) throw new Error('Failed to create session')

			// Owner tries to move session to stranger's task (should fail - no access to target)
			await expect(
				call(
					updateSessionApiProcedure,
					{ sessionId: session.id, taskId: strangerTask.id },
					{
						context: createMockApiContext({
							auth: createMockApiAuth({ userId: ownerUserId, organizationId, workosOrganizationId }),
							services: { db, dbReadReplica: db },
						}),
					},
				),
			).rejects.toThrow()

			// Verify session still belongs to original task
			const [unchangedSession] = await db.select().from(sessions).where(eq(sessions.id, session.id)).limit(1)
			expect(unchangedSession?.task_id).toBe(ownerTask.id)
		})
	})

	describe('Session created_by Gate', () => {
		test('resource owner who did not create session is denied update', async () => {
			// Setup: ownerUserId owns the task, aclHolderUserId creates a session on the task
			// Then ownerUserId tries to update the session -> should be denied
			// (ownerUserId is resource_owner but not created_by)
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'created_by gate task',
					resource_owner_user_id: ownerUserId,
					created_by: ownerUserId,
					default_working_directory: tmpdir(),
					setup_status: 'completed',
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			// Grant aclHolderUserId edit access
			await db.insert(taskUserAcl).values({
				task_id: task.id,
				subject_user_id: aclHolderUserId,
				organization_id: organizationId,
				resource_owner_user_id: ownerUserId,
				permission_level: 'edit',
				granted_by: ownerUserId,
			})

			// aclHolderUserId creates a session
			const createResult = await call(
				createSessionProcedure,
				{
					taskId: task.id,
					title: 'acl holder session',
					prompt: 'test',
					workingDirectory: tmpdir(),
					hostId,
					codingAgent: 'claude',
					provider: 'anthropic',
					model: 'claude-sonnet-4-5',
					permissionsMode: 'default',
					status: 'draft',
				},
				{
					context: createMockApiContext({
						auth: createMockApiAuth({ userId: aclHolderUserId, organizationId, workosOrganizationId }),
						services: { db, dbReadReplica: db },
					}),
				},
			)

			// ownerUserId tries to update -> denied (not created_by)
			await expect(
				call(
					updateSessionApiProcedure,
					{ sessionId: createResult.session.id, title: 'owner renamed' },
					{
						context: createMockApiContext({
							auth: createMockApiAuth({ userId: ownerUserId, organizationId, workosOrganizationId }),
							services: { db, dbReadReplica: db },
						}),
					},
				),
			).rejects.toThrow()
		})

		test('non-creator with edit ACL is denied update', async () => {
			// Setup: ownerUserId creates a session, aclHolderUserId has edit ACL
			// aclHolderUserId tries to update -> denied (not created_by)
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'non-creator edit test',
					resource_owner_user_id: ownerUserId,
					created_by: ownerUserId,
					default_working_directory: tmpdir(),
					setup_status: 'completed',
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			await db.insert(taskUserAcl).values({
				task_id: task.id,
				subject_user_id: aclHolderUserId,
				organization_id: organizationId,
				resource_owner_user_id: ownerUserId,
				permission_level: 'edit',
				granted_by: ownerUserId,
			})

			const createResult = await call(
				createSessionProcedure,
				{
					taskId: task.id,
					title: 'owner session',
					prompt: 'test',
					workingDirectory: tmpdir(),
					hostId,
					codingAgent: 'claude',
					provider: 'anthropic',
					model: 'claude-sonnet-4-5',
					permissionsMode: 'default',
					status: 'draft',
				},
				{
					context: createMockApiContext({
						auth: createMockApiAuth({ userId: ownerUserId, organizationId, workosOrganizationId }),
						services: { db, dbReadReplica: db },
					}),
				},
			)

			await expect(
				call(
					updateSessionApiProcedure,
					{ sessionId: createResult.session.id, title: 'acl holder renamed' },
					{
						context: createMockApiContext({
							auth: createMockApiAuth({ userId: aclHolderUserId, organizationId, workosOrganizationId }),
							services: { db, dbReadReplica: db },
						}),
					},
				),
			).rejects.toThrow()
		})

		test('session creator with edit ACL can still update', async () => {
			// aclHolderUserId creates a session on ownerUserId's task
			// aclHolderUserId updates their own session -> succeeds
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'creator can update test',
					resource_owner_user_id: ownerUserId,
					created_by: ownerUserId,
					default_working_directory: tmpdir(),
					setup_status: 'completed',
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			await db.insert(taskUserAcl).values({
				task_id: task.id,
				subject_user_id: aclHolderUserId,
				organization_id: organizationId,
				resource_owner_user_id: ownerUserId,
				permission_level: 'edit',
				granted_by: ownerUserId,
			})

			const createResult = await call(
				createSessionProcedure,
				{
					taskId: task.id,
					title: 'acl holder session',
					prompt: 'test',
					workingDirectory: tmpdir(),
					hostId,
					codingAgent: 'claude',
					provider: 'anthropic',
					model: 'claude-sonnet-4-5',
					permissionsMode: 'default',
					status: 'draft',
				},
				{
					context: createMockApiContext({
						auth: createMockApiAuth({ userId: aclHolderUserId, organizationId, workosOrganizationId }),
						services: { db, dbReadReplica: db },
					}),
				},
			)

			const updateResult = await call(
				updateSessionApiProcedure,
				{ sessionId: createResult.session.id, title: 'acl holder renamed' },
				{
					context: createMockApiContext({
						auth: createMockApiAuth({ userId: aclHolderUserId, organizationId, workosOrganizationId }),
						services: { db, dbReadReplica: db },
					}),
				},
			)
			expect(updateResult.success).toBe(true)
		})
	})

	describe('Host Ownership Validation', () => {
		test('sessions.create with valid hostId succeeds', async () => {
			// hostId is already registered for ownerUserId in beforeAll
			const result = await call(
				createSessionProcedure,
				{
					title: 'valid host session',
					prompt: 'test',
					workingDirectory: tmpdir(),
					hostId,
					codingAgent: 'claude',
					provider: 'anthropic',
					model: 'claude-sonnet-4-20250514',
					permissionsMode: 'default',
					status: 'draft',
				},
				{
					context: createMockApiContext({
						auth: createMockApiAuth({ userId: ownerUserId, organizationId, workosOrganizationId }),
						services: { db, dbReadReplica: db },
					}),
				},
			)
			expect(result.session.id).toBeDefined()
		})

		test('sessions.create with unowned hostId is denied', async () => {
			const unownedHostId = randomUUID()
			// No online_hosts record for this hostId

			await expect(
				call(
					createSessionProcedure,
					{
						title: 'unowned host session',
						prompt: 'test',
						workingDirectory: tmpdir(),
						hostId: unownedHostId,
						codingAgent: 'claude',
						provider: 'anthropic',
						model: 'claude-sonnet-4-20250514',
						permissionsMode: 'default',
						status: 'draft',
					},
					{
						context: createMockApiContext({
							auth: createMockApiAuth({ userId: ownerUserId, organizationId, workosOrganizationId }),
							services: { db, dbReadReplica: db },
						}),
					},
				),
			).rejects.toThrow()
		})

		test('sessions.create with an owned offline hostId is denied', async () => {
			const offlineHostId = randomUUID()
			await db.insert(onlineHosts).values({
				host_id: offlineHostId,
				organization_id: organizationId,
				status: 'offline',
				user_id: ownerUserId,
			})

			await expect(
				call(
					createSessionProcedure,
					{
						title: 'offline host session',
						prompt: 'test',
						workingDirectory: tmpdir(),
						hostId: offlineHostId,
						codingAgent: 'claude',
						provider: 'anthropic',
						model: 'claude-sonnet-4-20250514',
						permissionsMode: 'default',
						status: 'draft',
					},
					{
						context: createMockApiContext({
							auth: createMockApiAuth({ userId: ownerUserId, organizationId, workosOrganizationId }),
							services: { db, dbReadReplica: db },
						}),
					},
				),
			).rejects.toThrow()
		})

		test('sessions.create with null hostId succeeds (draft)', async () => {
			const result = await call(
				createSessionProcedure,
				{
					title: 'null host draft',
					prompt: 'test',
					workingDirectory: tmpdir(),
					codingAgent: 'claude',
					provider: 'anthropic',
					model: 'claude-sonnet-4-20250514',
					permissionsMode: 'default',
					status: 'draft',
				},
				{
					context: createMockApiContext({
						auth: createMockApiAuth({ userId: ownerUserId, organizationId, workosOrganizationId }),
						services: { db, dbReadReplica: db },
					}),
				},
			)
			expect(result.session.id).toBeDefined()
		})

		test('sessions.launch with unowned hostId is denied', async () => {
			const unownedHostId = randomUUID()

			await expect(
				call(
					launchSessionProcedure,
					{
						title: 'unowned host launch',
						text: 'test',
						workingDirectory: tmpdir(),
						hostId: unownedHostId,
						codingAgent: 'claude',
						provider: 'anthropic',
						model: 'claude-sonnet-4-20250514',
						permissionsMode: 'default',
					},
					{
						context: createMockApiContext({
							auth: createMockApiAuth({ userId: ownerUserId, organizationId, workosOrganizationId }),
							services: { db, dbReadReplica: db },
						}),
					},
				),
			).rejects.toThrow()
		})

		test('sessions.launch with host from different org is denied', async () => {
			const otherOrgHostId = randomUUID()
			const [otherOrg] = await db
				.insert(organizations)
				.values({
					name: 'other org',
					workos_organization_id: 'org_other_999',
				})
				.returning()

			if (!otherOrg) throw new Error('Failed to create other org')

			await db.insert(onlineHosts).values({
				host_id: otherOrgHostId,
				user_id: ownerUserId,
				organization_id: otherOrg.id,
			})

			await expect(
				call(
					launchSessionProcedure,
					{
						title: 'cross-org host launch',
						text: 'test',
						workingDirectory: tmpdir(),
						hostId: otherOrgHostId,
						codingAgent: 'claude',
						provider: 'anthropic',
						model: 'claude-sonnet-4-20250514',
						permissionsMode: 'default',
					},
					{
						context: createMockApiContext({
							auth: createMockApiAuth({ userId: ownerUserId, organizationId, workosOrganizationId }),
							services: { db, dbReadReplica: db },
						}),
					},
				),
			).rejects.toThrow()
		})
	})

	describe('sessions.update — archive interrupts active sessions', () => {
		const activeStatuses = ['running', 'needs_approval', 'launching', 'resuming'] as const

		for (const status of activeStatuses) {
			test(`Archiving a ${status} session sets status to interrupt_requested`, async () => {
				const [session] = await db
					.insert(sessions)
					.values({
						organization_id: organizationId,
						resource_owner_user_id: ownerUserId,
						created_by: ownerUserId,
						host_id: hostId,
						title: `archive-interrupt-${status}`,
						working_directory: tmpdir(),
						coding_agent: 'claude',
						provider: 'anthropic',
						model: 'claude-sonnet-4-5',
						permissions_mode: 'accept_edits',
						status,
					})
					.returning()

				if (!session) throw new Error('Failed to create session')

				const result = await call(
					updateSessionApiProcedure,
					{ sessionId: session.id, archived: true },
					{
						context: createMockApiContext({
							auth: createMockApiAuth({ userId: ownerUserId, organizationId, workosOrganizationId }),
							services: { db, dbReadReplica: db },
						}),
					},
				)

				expect(result.success).toBe(true)

				const [updated] = await db.select().from(sessions).where(eq(sessions.id, session.id)).limit(1)
				expect(updated?.status).toBe('interrupt_requested')
				expect(updated?.archived).toBe(true)
			})
		}

		test('Archiving a ready_for_input session does NOT change status', async () => {
			const [session] = await db
				.insert(sessions)
				.values({
					organization_id: organizationId,
					resource_owner_user_id: ownerUserId,
					created_by: ownerUserId,
					host_id: hostId,
					title: 'archive-ready-for-input-no-interrupt',
					working_directory: tmpdir(),
					coding_agent: 'claude',
					provider: 'anthropic',
					model: 'claude-sonnet-4-5',
					permissions_mode: 'accept_edits',
					status: 'ready_for_input',
				})
				.returning()

			if (!session) throw new Error('Failed to create session')

			const result = await call(
				updateSessionApiProcedure,
				{ sessionId: session.id, archived: true },
				{
					context: createMockApiContext({
						auth: createMockApiAuth({ userId: ownerUserId, organizationId, workosOrganizationId }),
						services: { db, dbReadReplica: db },
					}),
				},
			)

			expect(result.success).toBe(true)

			const [updated] = await db.select().from(sessions).where(eq(sessions.id, session.id)).limit(1)
			expect(updated?.status).toBe('ready_for_input')
			expect(updated?.archived).toBe(true)
		})

		test('Unarchiving a session does NOT set interrupt_requested', async () => {
			const [session] = await db
				.insert(sessions)
				.values({
					organization_id: organizationId,
					resource_owner_user_id: ownerUserId,
					created_by: ownerUserId,
					host_id: hostId,
					title: 'unarchive-no-interrupt',
					working_directory: tmpdir(),
					coding_agent: 'claude',
					provider: 'anthropic',
					model: 'claude-sonnet-4-5',
					permissions_mode: 'accept_edits',
					status: 'running',
					archived: true,
				})
				.returning()

			if (!session) throw new Error('Failed to create session')

			const result = await call(
				updateSessionApiProcedure,
				{ sessionId: session.id, archived: false },
				{
					context: createMockApiContext({
						auth: createMockApiAuth({ userId: ownerUserId, organizationId, workosOrganizationId }),
						services: { db, dbReadReplica: db },
					}),
				},
			)

			expect(result.success).toBe(true)

			const [updated] = await db.select().from(sessions).where(eq(sessions.id, session.id)).limit(1)
			expect(updated?.status).toBe('running')
			expect(updated?.archived).toBe(false)
		})
	})

	describe('tasks.archive — cascade interrupts active sessions', () => {
		test('Task archive with cascadeToSessions interrupts active child sessions', async () => {
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'task-cascade-interrupt',
					resource_owner_user_id: ownerUserId,
					created_by: ownerUserId,
					default_working_directory: tmpdir(),
					setup_status: 'completed',
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			// Create sessions in various statuses
			const [runningSession] = await db
				.insert(sessions)
				.values({
					organization_id: organizationId,
					resource_owner_user_id: ownerUserId,
					created_by: ownerUserId,
					host_id: hostId,
					task_id: task.id,
					title: 'running child',
					working_directory: tmpdir(),
					coding_agent: 'claude',
					provider: 'anthropic',
					model: 'claude-sonnet-4-5',
					permissions_mode: 'accept_edits',
					status: 'running',
				})
				.returning()

			const [readyForInputSession] = await db
				.insert(sessions)
				.values({
					organization_id: organizationId,
					resource_owner_user_id: ownerUserId,
					created_by: ownerUserId,
					host_id: hostId,
					task_id: task.id,
					title: 'ready for input child',
					working_directory: tmpdir(),
					coding_agent: 'claude',
					provider: 'anthropic',
					model: 'claude-sonnet-4-5',
					permissions_mode: 'accept_edits',
					status: 'ready_for_input',
				})
				.returning()

			if (!runningSession || !readyForInputSession) throw new Error('Failed to create sessions')

			const result = await call(
				archiveTaskProcedure,
				{ taskId: task.id, archived: true, cascadeToSessions: true },
				{
					context: createMockApiContext({
						auth: createMockApiAuth({ userId: ownerUserId, organizationId, workosOrganizationId }),
						services: { db, dbReadReplica: db },
					}),
				},
			)

			expect(result.success).toBe(true)

			// Running session should be interrupted AND archived
			const [updatedRunning] = await db.select().from(sessions).where(eq(sessions.id, runningSession.id)).limit(1)
			expect(updatedRunning?.status).toBe('interrupt_requested')
			expect(updatedRunning?.archived).toBe(true)

			// Ready-for-input session should be archived but status unchanged
			const [updatedReadyForInput] = await db
				.select()
				.from(sessions)
				.where(eq(sessions.id, readyForInputSession.id))
				.limit(1)
			expect(updatedReadyForInput?.status).toBe('ready_for_input')
			expect(updatedReadyForInput?.archived).toBe(true)
		})

		test('Task unarchive with cascadeToSessions does NOT interrupt sessions', async () => {
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'task-unarchive-no-interrupt',
					resource_owner_user_id: ownerUserId,
					created_by: ownerUserId,
					default_working_directory: tmpdir(),
					setup_status: 'completed',
					archived: true,
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			const [archivedRunningSession] = await db
				.insert(sessions)
				.values({
					organization_id: organizationId,
					resource_owner_user_id: ownerUserId,
					created_by: ownerUserId,
					host_id: hostId,
					task_id: task.id,
					title: 'archived running child',
					working_directory: tmpdir(),
					coding_agent: 'claude',
					provider: 'anthropic',
					model: 'claude-sonnet-4-5',
					permissions_mode: 'accept_edits',
					status: 'running',
					archived: true,
				})
				.returning()

			if (!archivedRunningSession) throw new Error('Failed to create session')

			const result = await call(
				archiveTaskProcedure,
				{ taskId: task.id, archived: false, cascadeToSessions: true },
				{
					context: createMockApiContext({
						auth: createMockApiAuth({ userId: ownerUserId, organizationId, workosOrganizationId }),
						services: { db, dbReadReplica: db },
					}),
				},
			)

			expect(result.success).toBe(true)

			// Session should be unarchived but status should remain unchanged
			const [updated] = await db
				.select()
				.from(sessions)
				.where(eq(sessions.id, archivedRunningSession.id))
				.limit(1)
			expect(updated?.status).toBe('running')
			expect(updated?.archived).toBe(false)
		})
	})

	afterAll(async () => {
		await effectRuntime?.dispose()
		await cleanupTestDb?.()
	}, 30000)
})
