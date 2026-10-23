import { tmpdir } from 'node:os'

import { organizations } from '@humanlayer/db/tables/organizations'
import { taskUserAcl } from '@humanlayer/db/tables/task-user-acl'
import { taskUserSettings } from '@humanlayer/db/tables/task-user-settings'
import { tasks } from '@humanlayer/db/tables/tasks'
import { call } from '@orpc/server'
import { and, eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { upsertTaskUserSettingsProcedure as liveUpsertTaskUserSettingsProcedure } from '../../src/orpc/api/task-user-settings/upsert.effect'
import { updateTaskProcedure } from '../../src/orpc/api/tasks/update'
import { createMockApiAuth, createMockApiContext } from '../mocks'
import { bindProcedureToRuntime, createRuntimeWithTestPostgresLayer } from '../utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

/**
 * Task User Settings Tests - Three-Actor Pattern
 *
 * Tests verify:
 * - Users with read/edit access can get/upsert their own settings
 * - Stranger cannot get/upsert settings
 * - Upsert is idempotent
 * - Partial updates only change specified fields
 */
describe('Task User Settings - Three-Actor Pattern', async () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let effectRuntime: ReturnType<typeof createRuntimeWithTestPostgresLayer> | undefined
	let upsertTaskUserSettingsProcedure: typeof liveUpsertTaskUserSettingsProcedure

	let organizationId: string
	const workosOrganizationId = 'org_abc123'

	// Three actors
	const ownerUserId = 'user_owner_123'
	const readerUserId = 'user_reader_456'
	const strangerUserId = 'user_stranger_789'

	beforeAll(async () => {
		const testDb = await createTestDb('task_user_settings')
		cleanupTestDb = testDb.cleanup
		db = testDb.db
		effectRuntime = createRuntimeWithTestPostgresLayer(db)
		upsertTaskUserSettingsProcedure = bindProcedureToRuntime(liveUpsertTaskUserSettingsProcedure, effectRuntime)

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

	describe('taskUserSettings.upsert', () => {
		test('User with read access can upsert their own settings', async () => {
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'task for reader upsert',
					resource_owner_user_id: ownerUserId,
					created_by: ownerUserId,
					default_working_directory: tmpdir(),
					setup_status: 'completed',
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			// Grant read permission
			await db.insert(taskUserAcl).values({
				organization_id: organizationId,
				subject_user_id: readerUserId,
				task_id: task.id,
				resource_owner_user_id: ownerUserId,
				permission_level: 'read',
				granted_by: ownerUserId,
			})

			const result = await call(
				upsertTaskUserSettingsProcedure,
				{
					taskId: task.id,
					workingDirectory: '/home/upserted',
					hostId: 'host-upsert-1',
					autoAdvanceQuestionsToResearch: true,
				},
				{
					context: createMockApiContext({
						auth: createMockApiAuth({ userId: readerUserId, organizationId, workosOrganizationId }),
						services: { db, dbReadReplica: db },
					}),
				},
			)

			expect(result.settings).toBeDefined()
			expect(result.settings.working_directory).toBe('/home/upserted')
			expect(result.settings.host_id).toBe('host-upsert-1')
			expect(result.settings.auto_advance_questions_to_research).toBe(true)

			// Verify DB state
			const [dbSettings] = await db
				.select()
				.from(taskUserSettings)
				.where(
					and(
						eq(taskUserSettings.task_id, task.id),
						eq(taskUserSettings.user_id, readerUserId),
						eq(taskUserSettings.organization_id, organizationId),
					),
				)
				.limit(1)

			expect(dbSettings?.working_directory).toBe('/home/upserted')
			expect(dbSettings?.host_id).toBe('host-upsert-1')
			expect(dbSettings?.auto_advance_questions_to_research).toBe(true)
		})

		test('User with edit access can upsert their own settings', async () => {
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'task for editor upsert',
					resource_owner_user_id: ownerUserId,
					created_by: ownerUserId,
					default_working_directory: tmpdir(),
					setup_status: 'completed',
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			// Grant edit permission
			await db.insert(taskUserAcl).values({
				organization_id: organizationId,
				subject_user_id: readerUserId,
				task_id: task.id,
				resource_owner_user_id: ownerUserId,
				permission_level: 'edit',
				granted_by: ownerUserId,
			})

			const result = await call(
				upsertTaskUserSettingsProcedure,
				{
					taskId: task.id,
					workingDirectory: '/home/editor',
				},
				{
					context: createMockApiContext({
						auth: createMockApiAuth({ userId: readerUserId, organizationId, workosOrganizationId }),
						services: { db, dbReadReplica: db },
					}),
				},
			)

			expect(result.settings.working_directory).toBe('/home/editor')
		})

		test('Stranger cannot upsert settings (task not found)', async () => {
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'task for stranger upsert',
					resource_owner_user_id: ownerUserId,
					created_by: ownerUserId,
					default_working_directory: tmpdir(),
					setup_status: 'completed',
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			await expect(
				call(
					upsertTaskUserSettingsProcedure,
					{
						taskId: task.id,
						workingDirectory: '/home/stranger',
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

		test('Upsert is idempotent - updating existing settings', async () => {
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'task for idempotent upsert',
					resource_owner_user_id: ownerUserId,
					created_by: ownerUserId,
					default_working_directory: tmpdir(),
					setup_status: 'completed',
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			// First upsert
			await call(
				upsertTaskUserSettingsProcedure,
				{
					taskId: task.id,
					workingDirectory: '/home/first',
					hostId: 'host-1',
				},
				{
					context: createMockApiContext({
						auth: createMockApiAuth({ userId: ownerUserId, organizationId, workosOrganizationId }),
						services: { db, dbReadReplica: db },
					}),
				},
			)

			// Second upsert
			const result = await call(
				upsertTaskUserSettingsProcedure,
				{
					taskId: task.id,
					workingDirectory: '/home/second',
					hostId: 'host-2',
				},
				{
					context: createMockApiContext({
						auth: createMockApiAuth({ userId: ownerUserId, organizationId, workosOrganizationId }),
						services: { db, dbReadReplica: db },
					}),
				},
			)

			expect(result.settings.working_directory).toBe('/home/second')
			expect(result.settings.host_id).toBe('host-2')

			// Verify only one row exists
			const allSettings = await db
				.select()
				.from(taskUserSettings)
				.where(
					and(
						eq(taskUserSettings.task_id, task.id),
						eq(taskUserSettings.user_id, ownerUserId),
						eq(taskUserSettings.organization_id, organizationId),
					),
				)

			expect(allSettings.length).toBe(1)
		})

		test('Upsert with no workingDirectory seeds working_directory as null', async () => {
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'task for null working directory seed',
					resource_owner_user_id: ownerUserId,
					created_by: ownerUserId,
					default_working_directory: '/task-default-dir',
					setup_status: 'completed',
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			// Grant read permission so upsert is authorized
			await db.insert(taskUserAcl).values({
				organization_id: organizationId,
				subject_user_id: readerUserId,
				task_id: task.id,
				resource_owner_user_id: ownerUserId,
				permission_level: 'read',
				granted_by: ownerUserId,
			})

			// Upsert with no workingDirectory — should seed null, not '~/' or task default
			const result = await call(
				upsertTaskUserSettingsProcedure,
				{
					taskId: task.id,
					// workingDirectory intentionally omitted
				},
				{
					context: createMockApiContext({
						auth: createMockApiAuth({ userId: readerUserId, organizationId, workosOrganizationId }),
						services: { db, dbReadReplica: db },
					}),
				},
			)

			expect(result.settings).toBeDefined()
			expect(result.settings.working_directory).toBeNull()

			// Verify DB state
			const [dbSettings] = await db
				.select()
				.from(taskUserSettings)
				.where(
					and(
						eq(taskUserSettings.task_id, task.id),
						eq(taskUserSettings.user_id, readerUserId),
						eq(taskUserSettings.organization_id, organizationId),
					),
				)
				.limit(1)

			expect(dbSettings?.working_directory).toBeNull()
		})

		test('Partial updates only change specified fields', async () => {
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'task for partial update',
					resource_owner_user_id: ownerUserId,
					created_by: ownerUserId,
					default_working_directory: tmpdir(),
					setup_status: 'completed',
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			// First upsert with all fields
			await call(
				upsertTaskUserSettingsProcedure,
				{
					taskId: task.id,
					workingDirectory: '/home/initial',
					hostId: 'host-initial',
					autoAdvanceQuestionsToResearch: true,
					autoAdvanceResearchToDesign: false,
				},
				{
					context: createMockApiContext({
						auth: createMockApiAuth({ userId: ownerUserId, organizationId, workosOrganizationId }),
						services: { db, dbReadReplica: db },
					}),
				},
			)

			// Partial update - only change working_directory
			const result = await call(
				upsertTaskUserSettingsProcedure,
				{
					taskId: task.id,
					workingDirectory: '/home/updated',
				},
				{
					context: createMockApiContext({
						auth: createMockApiAuth({ userId: ownerUserId, organizationId, workosOrganizationId }),
						services: { db, dbReadReplica: db },
					}),
				},
			)

			expect(result.settings.working_directory).toBe('/home/updated')
			expect(result.settings.host_id).toBe('host-initial') // Should remain unchanged
			expect(result.settings.auto_advance_questions_to_research).toBe(true) // Should remain unchanged
			expect(result.settings.auto_advance_research_to_design).toBe(false) // Should remain unchanged
		})
	})

	afterAll(async () => {
		await effectRuntime?.dispose()
		await cleanupTestDb?.()
	})
})

describe('Task Update - Auto-Advance Ownership Routing', async () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let organizationId: string
	const workosOrganizationId = 'org_routing_test'

	const ownerUserId = 'user_routing_owner'
	const editorUserId = 'user_routing_editor'
	const readerUserId = 'user_routing_reader'

	beforeAll(async () => {
		const testDb = await createTestDb('task_update_auto_advance_ownership_routing')
		cleanupTestDb = testDb.cleanup
		db = testDb.db

		const [org] = await db
			.insert(organizations)
			.values({ name: 'routing test org', workos_organization_id: workosOrganizationId })
			.returning()
		if (!org) throw new Error('Unable to insert organization for setup')
		organizationId = org.id
	}, 30000)

	test('Owner updates auto-advance via tasks.update — writes to tasks table, no task_user_settings row', async () => {
		const [task] = await db
			.insert(tasks)
			.values({
				name: 'owner-routing-test',
				resource_owner_user_id: ownerUserId,
				created_by: ownerUserId,
				organization_id: organizationId,
			})
			.returning()

		await call(
			updateTaskProcedure,
			{ taskId: task!.id, autoAdvanceQuestionsToResearch: true },
			{
				context: createMockApiContext({
					auth: createMockApiAuth({ userId: ownerUserId, organizationId, workosOrganizationId }),
					services: { db, dbReadReplica: db },
				}),
			},
		)

		// Verify tasks table updated
		const [updatedTask] = await db.select().from(tasks).where(eq(tasks.id, task!.id)).limit(1)
		expect(updatedTask!.auto_advance_questions_to_research).toBe(true)

		// Verify no task_user_settings row created
		const settings = await db
			.select()
			.from(taskUserSettings)
			.where(and(eq(taskUserSettings.task_id, task!.id), eq(taskUserSettings.user_id, ownerUserId)))
		expect(settings).toHaveLength(0)
	})

	test('Non-owner with edit ACL updates auto-advance — writes to task_user_settings, not tasks', async () => {
		const [task] = await db
			.insert(tasks)
			.values({
				name: 'editor-routing-test',
				resource_owner_user_id: ownerUserId,
				created_by: ownerUserId,
				organization_id: organizationId,
				auto_advance_questions_to_research: false,
				auto_advance_research_to_design: true,
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

		// Verify tasks table NOT modified
		const [updatedTask] = await db.select().from(tasks).where(eq(tasks.id, task!.id)).limit(1)
		expect(updatedTask!.auto_advance_questions_to_research).toBe(false) // unchanged

		// Verify task_user_settings row created with correct values
		const [settings] = await db
			.select()
			.from(taskUserSettings)
			.where(and(eq(taskUserSettings.task_id, task!.id), eq(taskUserSettings.user_id, editorUserId)))
			.limit(1)
		expect(settings).toBeDefined()
		expect(settings!.auto_advance_questions_to_research).toBe(true) // toggled value
		expect(settings!.auto_advance_research_to_design).toBe(true) // copied from task
		expect(settings!.working_directory).toBeNull() // null: no per-user preference seeded on first auto-advance write
	})

	test('Non-owner second toggle — updates existing row, preserves other fields', async () => {
		const [task] = await db
			.insert(tasks)
			.values({
				name: 'second-toggle-test',
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

		// First toggle
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

		// Second toggle — different field
		await call(
			updateTaskProcedure,
			{ taskId: task!.id, autoAdvanceResearchToDesign: true },
			{
				context: createMockApiContext({
					auth: createMockApiAuth({ userId: editorUserId, organizationId, workosOrganizationId }),
					services: { db, dbReadReplica: db },
				}),
			},
		)

		// Verify single row with both values
		const settings = await db
			.select()
			.from(taskUserSettings)
			.where(and(eq(taskUserSettings.task_id, task!.id), eq(taskUserSettings.user_id, editorUserId)))
		expect(settings).toHaveLength(1)
		expect(settings[0]!.auto_advance_questions_to_research).toBe(true)
		expect(settings[0]!.auto_advance_research_to_design).toBe(true)
	})

	test('Non-owner with read ACL cannot update auto-advance — FORBIDDEN', async () => {
		const [task] = await db
			.insert(tasks)
			.values({
				name: 'reader-routing-test',
				resource_owner_user_id: ownerUserId,
				created_by: ownerUserId,
				organization_id: organizationId,
			})
			.returning()

		await db.insert(taskUserAcl).values({
			organization_id: organizationId,
			resource_owner_user_id: ownerUserId,
			subject_user_id: readerUserId,
			task_id: task!.id,
			permission_level: 'read',
			granted_by: ownerUserId,
		})

		await expect(
			call(
				updateTaskProcedure,
				{ taskId: task!.id, autoAdvanceQuestionsToResearch: true },
				{
					context: createMockApiContext({
						auth: createMockApiAuth({ userId: readerUserId, organizationId, workosOrganizationId }),
						services: { db, dbReadReplica: db },
					}),
				},
			),
		).rejects.toThrow()
	})

	afterAll(async () => {
		await cleanupTestDb?.()
	}, 30000)
})
