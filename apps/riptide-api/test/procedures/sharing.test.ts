import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'

import { organizations } from '@humanlayer/db/tables/organizations'
import { taskOrganizationAcl } from '@humanlayer/db/tables/task-organization-acl'
import { tasks } from '@humanlayer/db/tables/tasks'
import { call } from '@orpc/server'
import { and, eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { updateOrgSharingProcedure as liveUpdateOrgSharingProcedure } from '../../src/orpc/api/sharing/organization/update.effect'
import { createMockApiAuth, createMockApiContext } from '../mocks'
import { bindProcedureToRuntime, createRuntimeWithTestPostgresLayer } from '../utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

/**
 * Sharing Access Control Tests - Three-Actor Pattern
 *
 * Actors:
 * 1. Owner - The task owner (resource_owner_user_id)
 * 2. Stranger - User with no access
 * 3. (ACL-holder not applicable - only owner can manage sharing)
 */
describe('Sharing - Organization Update', async () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let effectRuntime: ReturnType<typeof createRuntimeWithTestPostgresLayer> | undefined
	let updateOrgSharingProcedure: typeof liveUpdateOrgSharingProcedure

	let organizationId: string
	const workosOrganizationId = 'org_sharing_test'

	// Two actors (owner and stranger - ACL holders cannot manage sharing)
	const ownerUserId = 'user_owner_sharing_123'
	const strangerUserId = 'user_stranger_sharing_789'

	beforeAll(async () => {
		const testDb = await createTestDb('sharing')
		cleanupTestDb = testDb.cleanup
		db = testDb.db
		effectRuntime = createRuntimeWithTestPostgresLayer(db)
		updateOrgSharingProcedure = bindProcedureToRuntime(liveUpdateOrgSharingProcedure, effectRuntime)

		// Set up organization
		const [org] = await db
			.insert(organizations)
			.values({
				name: 'sharing test organization',
				workos_organization_id: workosOrganizationId,
			})
			.returning()

		if (!org) throw new Error('Unable to insert organization for setup')
		organizationId = org.id
	}, 30000)

	const createOwnerContext = () =>
		createMockApiContext({
			auth: createMockApiAuth({ userId: ownerUserId, organizationId, workosOrganizationId }),
			services: { db, dbReadReplica: db },
		})

	const createStrangerContext = () =>
		createMockApiContext({
			auth: createMockApiAuth({ userId: strangerUserId, organizationId, workosOrganizationId }),
			services: { db, dbReadReplica: db },
		})

	describe('Authorization', () => {
		test('Owner can share task with org', async () => {
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'owner share task',
					resource_owner_user_id: ownerUserId,
					created_by: ownerUserId,
					default_working_directory: tmpdir(),
					setup_status: 'completed',
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			const result = await call(
				updateOrgSharingProcedure,
				{ taskId: task.id, permissionLevel: 'read' },
				{ context: createOwnerContext() },
			)

			expect(result.acl).not.toBeNull()
			expect(result.acl!.permission_level).toBe('read')
			expect(result.acl!.task_id).toBe(task.id)
			expect(result.transactionId).not.toBe('0')

			// Verify ACL in database
			const [dbAcl] = await db
				.select()
				.from(taskOrganizationAcl)
				.where(
					and(
						eq(taskOrganizationAcl.task_id, task.id),
						eq(taskOrganizationAcl.organization_id, organizationId),
					),
				)
				.limit(1)

			expect(dbAcl).toBeDefined()
			expect(dbAcl?.permission_level).toBe('read')
		})

		test('Owner can unshare task', async () => {
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'owner unshare task',
					resource_owner_user_id: ownerUserId,
					created_by: ownerUserId,
					default_working_directory: tmpdir(),
					setup_status: 'completed',
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			// Share first
			await call(
				updateOrgSharingProcedure,
				{ taskId: task.id, permissionLevel: 'read' },
				{ context: createOwnerContext() },
			)

			// Verify shared
			const [sharedAcl] = await db
				.select()
				.from(taskOrganizationAcl)
				.where(eq(taskOrganizationAcl.task_id, task.id))
				.limit(1)
			expect(sharedAcl).toBeDefined()

			// Then unshare
			const result = await call(
				updateOrgSharingProcedure,
				{ taskId: task.id, permissionLevel: null },
				{ context: createOwnerContext() },
			)

			expect(result.acl).toBeNull()
			expect(result.transactionId).not.toBe('0')

			// Verify ACL deleted from database
			const [deletedAcl] = await db
				.select()
				.from(taskOrganizationAcl)
				.where(eq(taskOrganizationAcl.task_id, task.id))
				.limit(1)

			expect(deletedAcl).toBeUndefined()
		})

		test('Stranger cannot share task they do not own (gets NOT_FOUND)', async () => {
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'stranger cannot share',
					resource_owner_user_id: ownerUserId,
					created_by: ownerUserId,
					default_working_directory: tmpdir(),
					setup_status: 'completed',
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			await expect(
				call(
					updateOrgSharingProcedure,
					{ taskId: task.id, permissionLevel: 'read' },
					{ context: createStrangerContext() },
				),
			).rejects.toThrow()

			// Verify no ACL was created
			const [acl] = await db
				.select()
				.from(taskOrganizationAcl)
				.where(eq(taskOrganizationAcl.task_id, task.id))
				.limit(1)

			expect(acl).toBeUndefined()
		})

		test('Non-existent task returns NOT_FOUND', async () => {
			await expect(
				call(
					updateOrgSharingProcedure,
					{ taskId: randomUUID(), permissionLevel: 'read' },
					{ context: createOwnerContext() },
				),
			).rejects.toThrow()
		})
	})

	describe('Idempotency', () => {
		test('Sharing twice succeeds (upsert behavior)', async () => {
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'idempotent share task',
					resource_owner_user_id: ownerUserId,
					created_by: ownerUserId,
					default_working_directory: tmpdir(),
					setup_status: 'completed',
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			// Share first time
			await call(
				updateOrgSharingProcedure,
				{ taskId: task.id, permissionLevel: 'read' },
				{ context: createOwnerContext() },
			)

			// Share second time (should succeed via upsert)
			const result = await call(
				updateOrgSharingProcedure,
				{ taskId: task.id, permissionLevel: 'read' },
				{ context: createOwnerContext() },
			)

			expect(result.acl).not.toBeNull()
			expect(result.acl!.permission_level).toBe('read')

			// Verify only one ACL entry exists
			const acls = await db.select().from(taskOrganizationAcl).where(eq(taskOrganizationAcl.task_id, task.id))

			expect(acls.length).toBe(1)
		})

		test('Unsharing when not shared succeeds', async () => {
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'idempotent unshare task',
					resource_owner_user_id: ownerUserId,
					created_by: ownerUserId,
					default_working_directory: tmpdir(),
					setup_status: 'completed',
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			// Unshare when not shared (should succeed)
			const result = await call(
				updateOrgSharingProcedure,
				{ taskId: task.id, permissionLevel: null },
				{ context: createOwnerContext() },
			)

			expect(result.acl).toBeNull()
			expect(result.transactionId).not.toBe('0')
		})
	})

	afterAll(async () => {
		await effectRuntime?.dispose()
		await cleanupTestDb?.()
	}, 30000)
})
