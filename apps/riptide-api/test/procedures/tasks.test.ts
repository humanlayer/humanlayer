import { organizations } from '@humanlayer/db/tables/organizations'
import { taskUserAcl } from '@humanlayer/db/tables/task-user-acl'
import { taskUserSettings } from '@humanlayer/db/tables/task-user-settings'
import { tasks } from '@humanlayer/db/tables/tasks'
import { call } from '@orpc/server'
import { and, eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { updateTaskProcedure } from '../../src/orpc/api/tasks/update'
import { createMockApiAuth, createMockApiContext } from '../mocks'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

/**
 * tasks.update — defaultWorkingDirectory routing tests
 *
 * Tests verify that a non-owner calling tasks.update with defaultWorkingDirectory:
 * (a) writes to task_user_settings (not tasks)
 * (b) returns a transactionId
 * (c) leaves tasks.default_working_directory unchanged
 */
describe('tasks.update — defaultWorkingDirectory routing', async () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase

	let organizationId: string
	const workosOrganizationId = 'org_dir_routing_test'

	const ownerUserId = 'user_dir_owner'
	const editorUserId = 'user_dir_editor'

	beforeAll(async () => {
		const testDb = await createTestDb('tasks_update_dir_routing')
		cleanupTestDb = testDb.cleanup
		db = testDb.db

		const [org] = await db
			.insert(organizations)
			.values({ name: 'dir routing test org', workos_organization_id: workosOrganizationId })
			.returning()
		if (!org) throw new Error('Unable to insert organization for setup')
		organizationId = org.id
	}, 30000)

	test('owner tasks.update with defaultWorkingDirectory writes to tasks table', async () => {
		const [task] = await db
			.insert(tasks)
			.values({
				name: 'owner-dir-routing-test',
				resource_owner_user_id: ownerUserId,
				created_by: ownerUserId,
				organization_id: organizationId,
				default_working_directory: '/original',
			})
			.returning()

		const result = await call(
			updateTaskProcedure,
			{ taskId: task!.id, defaultWorkingDirectory: '/updated-by-owner' },
			{
				context: createMockApiContext(
					createMockApiContext({
						auth: { userId: ownerUserId, organizationId, workosOrganizationId },
						services: { db, dbReadReplica: db },
					}),
				),
			},
		)

		// Returns a transactionId
		expect(result.transactionId).toBeDefined()
		expect(result.success).toBe(true)

		// Verify tasks table was updated
		const [updatedTask] = await db.select().from(tasks).where(eq(tasks.id, task!.id)).limit(1)
		expect(updatedTask!.default_working_directory).toBe('/updated-by-owner')

		// Verify no task_user_settings row created for owner
		const settings = await db
			.select()
			.from(taskUserSettings)
			.where(and(eq(taskUserSettings.task_id, task!.id), eq(taskUserSettings.user_id, ownerUserId)))
		expect(settings).toHaveLength(0)
	})

	test('owner tasks.update with slackNotificationsMuted round-trips on the tasks row', async () => {
		const [task] = await db
			.insert(tasks)
			.values({
				name: 'owner-slack-mute-test',
				resource_owner_user_id: ownerUserId,
				created_by: ownerUserId,
				organization_id: organizationId,
			})
			.returning()

		// Owner mutes Slack notifications for the task.
		const muted = await call(
			updateTaskProcedure,
			{ taskId: task!.id, slackNotificationsMuted: true },
			{
				context: createMockApiContext({
					auth: createMockApiAuth({ userId: ownerUserId, organizationId, workosOrganizationId }),
					services: { db, dbReadReplica: db },
				}),
			},
		)
		expect(muted.success).toBe(true)

		const [afterMute] = await db.select().from(tasks).where(eq(tasks.id, task!.id)).limit(1)
		expect(afterMute!.slack_notifications_muted).toBe(true)

		// Task-level field — no per-user task_user_settings row is created.
		const settings = await db.select().from(taskUserSettings).where(eq(taskUserSettings.task_id, task!.id))
		expect(settings).toHaveLength(0)

		// Owner unmutes — the task row flips back.
		await call(
			updateTaskProcedure,
			{ taskId: task!.id, slackNotificationsMuted: false },
			{
				context: createMockApiContext({
					auth: createMockApiAuth({ userId: ownerUserId, organizationId, workosOrganizationId }),
					services: { db, dbReadReplica: db },
				}),
			},
		)
		const [afterUnmute] = await db.select().from(tasks).where(eq(tasks.id, task!.id)).limit(1)
		expect(afterUnmute!.slack_notifications_muted).toBe(false)
	})

	test('owner tasks.update changes the workflow type with its auto-advance flags; editors cannot', async () => {
		const [task] = await db
			.insert(tasks)
			.values({
				name: 'owner-workflow-change-test',
				resource_owner_user_id: ownerUserId,
				created_by: ownerUserId,
				organization_id: organizationId,
				workflow_type: 'freeform',
			})
			.returning()
		await db.insert(taskUserAcl).values({
			organization_id: organizationId,
			resource_owner_user_id: ownerUserId,
			subject_user_id: editorUserId,
			task_id: task!.id,
			permission_level: 'edit',
			granted_by: ownerUserId,
		})

		await expect(
			call(
				updateTaskProcedure,
				{ taskId: task!.id, workflowType: 'prd_tdd' },
				{
					context: createMockApiContext({
						auth: createMockApiAuth({ userId: editorUserId, organizationId, workosOrganizationId }),
						services: { db, dbReadReplica: db },
					}),
				},
			),
		).rejects.toThrow()

		const changed = await call(
			updateTaskProcedure,
			{
				taskId: task!.id,
				workflowType: 'outline_only',
				autoAdvanceQuestionsToResearch: true,
				autoAdvanceResearchToDesign: true,
			},
			{
				context: createMockApiContext({
					auth: createMockApiAuth({ userId: ownerUserId, organizationId, workosOrganizationId }),
					services: { db, dbReadReplica: db },
				}),
			},
		)
		expect(changed.success).toBe(true)

		const [after] = await db.select().from(tasks).where(eq(tasks.id, task!.id)).limit(1)
		expect(after!.workflow_type).toBe('outline_only')
		expect(after!.auto_advance_questions_to_research).toBe(true)
		expect(after!.auto_advance_research_to_design).toBe(true)
	})

	test('owner tasks.update round-trips GitHub draft repository identity', async () => {
		const [task] = await db
			.insert(tasks)
			.values({
				name: 'owner-github-draft-update',
				resource_owner_user_id: ownerUserId,
				created_by: ownerUserId,
				organization_id: organizationId,
				is_draft: true,
			})
			.returning()

		await call(
			updateTaskProcedure,
			{
				taskId: task!.id,
				ticketProvider: 'github',
				githubConnectionId: '11111111-1111-4111-8111-111111111111',
				ticketId: '482',
				ticketRepositoryId: '90071992547409931236',
				ticketRepositoryFullName: 'acme/web',
			},
			{
				context: createMockApiContext({
					auth: createMockApiAuth({ userId: ownerUserId, organizationId, workosOrganizationId }),
					services: { db, dbReadReplica: db },
				}),
			},
		)

		const [updatedTask] = await db.select().from(tasks).where(eq(tasks.id, task!.id)).limit(1)
		expect(updatedTask).toMatchObject({
			ticket_provider: 'github',
			github_connection_id: '11111111-1111-4111-8111-111111111111',
			ticket_id: '482',
			ticket_repository_id: '90071992547409931236',
			ticket_repository_full_name: 'acme/web',
		})
	})

	test('owner tasks.update rejects repository identity merged with a persisted non-GitHub provider', async () => {
		const [task] = await db
			.insert(tasks)
			.values({
				name: 'owner-linear-draft-update',
				resource_owner_user_id: ownerUserId,
				created_by: ownerUserId,
				organization_id: organizationId,
				ticket_provider: 'linear',
				is_draft: true,
			})
			.returning()

		await expect(
			call(
				updateTaskProcedure,
				{
					taskId: task!.id,
					githubConnectionId: '11111111-1111-4111-8111-111111111111',
					ticketRepositoryId: '90071992547409931236',
				},
				{
					context: createMockApiContext({
						auth: createMockApiAuth({ userId: ownerUserId, organizationId, workosOrganizationId }),
						services: { db, dbReadReplica: db },
					}),
				},
			),
		).rejects.toMatchObject({ code: 'BAD_REQUEST' })
	})

	test('non-owner tasks.update with slackNotificationsMuted is forbidden (owner-only task field)', async () => {
		const [task] = await db
			.insert(tasks)
			.values({
				name: 'non-owner-slack-mute-test',
				resource_owner_user_id: ownerUserId,
				created_by: ownerUserId,
				organization_id: organizationId,
			})
			.returning()

		// Grant edit permission to the editor — still not allowed to flip this owner-only task field.
		await db.insert(taskUserAcl).values({
			organization_id: organizationId,
			resource_owner_user_id: ownerUserId,
			subject_user_id: editorUserId,
			task_id: task!.id,
			permission_level: 'edit',
			granted_by: ownerUserId,
		})

		await expect(
			call(
				updateTaskProcedure,
				{ taskId: task!.id, slackNotificationsMuted: true },
				{
					context: createMockApiContext({
						auth: createMockApiAuth({ userId: editorUserId, organizationId, workosOrganizationId }),
						services: { db, dbReadReplica: db },
					}),
				},
			),
		).rejects.toThrow()

		const [after] = await db.select().from(tasks).where(eq(tasks.id, task!.id)).limit(1)
		expect(after!.slack_notifications_muted).toBe(false)
	})

	test('non-owner tasks.update with defaultWorkingDirectory writes to task_user_settings, not tasks', async () => {
		const originalDir = '/owner-original-dir'
		const [task] = await db
			.insert(tasks)
			.values({
				name: 'non-owner-dir-routing-test',
				resource_owner_user_id: ownerUserId,
				created_by: ownerUserId,
				organization_id: organizationId,
				default_working_directory: originalDir,
			})
			.returning()

		// Grant edit permission to editor
		await db.insert(taskUserAcl).values({
			organization_id: organizationId,
			resource_owner_user_id: ownerUserId,
			subject_user_id: editorUserId,
			task_id: task!.id,
			permission_level: 'edit',
			granted_by: ownerUserId,
		})

		const result = await call(
			updateTaskProcedure,
			{ taskId: task!.id, defaultWorkingDirectory: '/non-owner-override' },
			{
				context: createMockApiContext({
					auth: createMockApiAuth({ userId: editorUserId, organizationId, workosOrganizationId }),
					services: { db, dbReadReplica: db },
				}),
			},
		)

		// Returns a transactionId
		expect(result.transactionId).toBeDefined()
		expect(result.success).toBe(true)

		// Verify tasks.default_working_directory is UNCHANGED
		const [updatedTask] = await db.select().from(tasks).where(eq(tasks.id, task!.id)).limit(1)
		expect(updatedTask!.default_working_directory).toBe(originalDir)

		// Verify task_user_settings row was created with working_directory='/non-owner-override'
		const [settings] = await db
			.select()
			.from(taskUserSettings)
			.where(and(eq(taskUserSettings.task_id, task!.id), eq(taskUserSettings.user_id, editorUserId)))
			.limit(1)
		expect(settings).toBeDefined()
		expect(settings!.working_directory).toBe('/non-owner-override')
	})

	test('non-owner tasks.update with defaultWorkingDirectory returns non-null transactionId', async () => {
		const [task] = await db
			.insert(tasks)
			.values({
				name: 'non-owner-txid-test',
				resource_owner_user_id: ownerUserId,
				created_by: ownerUserId,
				organization_id: organizationId,
			})
			.returning()

		await db.insert(taskUserAcl).values({
			organization_id: organizationId,
			resource_owner_user_id: ownerUserId,
			subject_user_id: editorUserId,
			task_id: task!.id,
			permission_level: 'edit',
			granted_by: ownerUserId,
		})

		const result = await call(
			updateTaskProcedure,
			{ taskId: task!.id, defaultWorkingDirectory: '/some-dir' },
			{
				context: createMockApiContext({
					auth: createMockApiAuth({ userId: editorUserId, organizationId, workosOrganizationId }),
					services: { db, dbReadReplica: db },
				}),
			},
		)

		// transactionId must be non-null so the client can await the right collection sync
		expect(result.transactionId).not.toBeNull()
		expect(result.transactionId).not.toBeUndefined()
	})

	test('non-owner second update of defaultWorkingDirectory updates existing row', async () => {
		const [task] = await db
			.insert(tasks)
			.values({
				name: 'non-owner-dir-update-existing',
				resource_owner_user_id: ownerUserId,
				created_by: ownerUserId,
				organization_id: organizationId,
				default_working_directory: '/task-default',
			})
			.returning()

		await db.insert(taskUserAcl).values({
			organization_id: organizationId,
			resource_owner_user_id: ownerUserId,
			subject_user_id: editorUserId,
			task_id: task!.id,
			permission_level: 'edit',
			granted_by: ownerUserId,
		})

		// First update
		await call(
			updateTaskProcedure,
			{ taskId: task!.id, defaultWorkingDirectory: '/first-update' },
			{
				context: createMockApiContext({
					auth: createMockApiAuth({ userId: editorUserId, organizationId, workosOrganizationId }),
					services: { db, dbReadReplica: db },
				}),
			},
		)

		// Second update
		await call(
			updateTaskProcedure,
			{ taskId: task!.id, defaultWorkingDirectory: '/second-update' },
			{
				context: createMockApiContext({
					auth: createMockApiAuth({ userId: editorUserId, organizationId, workosOrganizationId }),
					services: { db, dbReadReplica: db },
				}),
			},
		)

		// Only one row should exist (upsert, not duplicate insert)
		const allSettings = await db
			.select()
			.from(taskUserSettings)
			.where(and(eq(taskUserSettings.task_id, task!.id), eq(taskUserSettings.user_id, editorUserId)))

		expect(allSettings).toHaveLength(1)
		expect(allSettings[0]!.working_directory).toBe('/second-update')

		// tasks table still unchanged
		const [updatedTask] = await db.select().from(tasks).where(eq(tasks.id, task!.id)).limit(1)
		expect(updatedTask!.default_working_directory).toBe('/task-default')
	})

	test('non-owner with only autoAdvanceQuestionsToResearch produces working_directory=null (no silent copy of task default)', async () => {
		const [task] = await db
			.insert(tasks)
			.values({
				name: 'non-owner-auto-advance-null-dir',
				resource_owner_user_id: ownerUserId,
				created_by: ownerUserId,
				organization_id: organizationId,
				default_working_directory: '/owner-task-default',
			})
			.returning()

		await db.insert(taskUserAcl).values({
			organization_id: organizationId,
			resource_owner_user_id: ownerUserId,
			subject_user_id: editorUserId,
			task_id: task!.id,
			permission_level: 'edit',
			granted_by: ownerUserId,
		})

		await call(
			updateTaskProcedure,
			{ taskId: task!.id, autoAdvanceQuestionsToResearch: true },
			{
				context: createMockApiContext({
					auth: createMockApiAuth({ userId: editorUserId, organizationId, workosOrganizationId }),
					services: { db, dbReadReplica: db },
				}),
			},
		)

		// Verify the newly-created task_user_settings row has working_directory=null
		// (not '~/' and not the task's default_working_directory)
		const [settings] = await db
			.select()
			.from(taskUserSettings)
			.where(and(eq(taskUserSettings.task_id, task!.id), eq(taskUserSettings.user_id, editorUserId)))
			.limit(1)
		expect(settings).toBeDefined()
		expect(settings!.working_directory).toBeNull()
	})

	afterAll(async () => {
		await cleanupTestDb?.()
	}, 30000)
})
