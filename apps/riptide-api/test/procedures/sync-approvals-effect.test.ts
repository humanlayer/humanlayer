import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'

import { approvals } from '@humanlayer/db/tables/approvals'
import { organizations } from '@humanlayer/db/tables/organizations'
import { sessions } from '@humanlayer/db/tables/sessions'
import { taskOrganizationAcl } from '@humanlayer/db/tables/task-organization-acl'
import { taskUserAcl } from '@humanlayer/db/tables/task-user-acl'
import { tasks } from '@humanlayer/db/tables/tasks'
import { call } from '@orpc/server'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { uuidv7 } from 'uuidv7'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { syncApprovalsEffectProcedure as liveSyncApprovalsEffectProcedure } from '../../src/orpc/api/sync/approvals.effect'
import { createMockApiAuth, createMockApiContext } from '../mocks'
import { bindProcedureToRuntime, createRuntimeWithTestPostgresLayer } from '../utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

/**
 * Sync Approvals Effect Procedure Tests
 *
 * Tests the Effect-based sync approvals procedure which returns approvals
 * visible to the authenticated user based on:
 * 1. Direct ownership: approval.resource_owner_user_id = userId
 * 2. Task user ACL: user has ACL entry for the approval's task
 * 3. Task organization ACL: organization has ACL entry for the approval's task
 *
 * Also tests filtering, sorting, pagination, and error handling.
 */
describe('api/sync/approvals.effect', async () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let effectRuntime: ReturnType<typeof createRuntimeWithTestPostgresLayer> | undefined
	let syncApprovalsProcedure: typeof liveSyncApprovalsEffectProcedure

	let organizationId: string
	const workosOrganizationId = `org_sync_approvals_${uuidv7()}`

	// Three actors
	const ownerUserId = `user_owner_${uuidv7()}`
	const aclHolderUserId = `user_acl_holder_${uuidv7()}`
	const strangerUserId = `user_stranger_${uuidv7()}`

	const hostId = randomUUID()

	beforeAll(async () => {
		const testDb = await createTestDb('sync_approvals_effect')
		cleanupTestDb = testDb.cleanup
		db = testDb.db
		effectRuntime = createRuntimeWithTestPostgresLayer(db)
		syncApprovalsProcedure = bindProcedureToRuntime(liveSyncApprovalsEffectProcedure, effectRuntime)

		const [org] = await db
			.insert(organizations)
			.values({ name: 'Sync Approvals Effect Test Org', workos_organization_id: workosOrganizationId })
			.returning()
		if (!org) throw new Error('Unable to insert organization for setup')
		organizationId = org.id
	}, 60000)

	afterAll(async () => {
		await effectRuntime?.dispose()
		await cleanupTestDb?.()
	}, 30000)

	function makeContext(uid = ownerUserId) {
		return createMockApiContext({
			auth: createMockApiAuth({ userId: uid, organizationId, workosOrganizationId }),
			services: { db, dbReadReplica: db },
		})
	}

	async function createSession(options: { resourceOwnerUserId: string; taskId?: string | null; title?: string }) {
		const [session] = await db
			.insert(sessions)
			.values({
				organization_id: organizationId,
				resource_owner_user_id: options.resourceOwnerUserId,
				created_by: options.resourceOwnerUserId,
				host_id: hostId,
				task_id: options.taskId ?? null,
				title: options.title ?? 'test session',
				working_directory: tmpdir(),
				coding_agent: 'claude',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissions_mode: 'accept_edits',
				status: 'needs_approval',
			})
			.returning()
		if (!session) throw new Error('Failed to create session')
		return session
	}

	async function createApproval(options: {
		sessionId: string
		resourceOwnerUserId: string
		taskId?: string | null
		status?: 'pending' | 'approved' | 'denied'
		toolName?: string
	}) {
		const [approval] = await db
			.insert(approvals)
			.values({
				session_id: options.sessionId,
				organization_id: organizationId,
				user_id: options.resourceOwnerUserId,
				host_id: hostId,
				resource_owner_user_id: options.resourceOwnerUserId,
				task_id: options.taskId ?? null,
				status: options.status ?? 'pending',
				tool_name: options.toolName ?? 'bash',
				tool_input: { command: 'ls' },
			})
			.returning()
		if (!approval) throw new Error('Failed to create approval')
		return approval
	}

	async function createTask(options: { resourceOwnerUserId: string; name?: string }) {
		const [task] = await db
			.insert(tasks)
			.values({
				organization_id: organizationId,
				name: options.name ?? 'test task',
				resource_owner_user_id: options.resourceOwnerUserId,
				created_by: options.resourceOwnerUserId,
				default_working_directory: tmpdir(),
				setup_status: 'completed',
			})
			.returning()
		if (!task) throw new Error('Failed to create task')
		return task
	}

	describe('Visibility - Direct ownership', () => {
		test('user can see their own approvals (no task_id)', async () => {
			const session = await createSession({ resourceOwnerUserId: ownerUserId })
			const approval = await createApproval({ sessionId: session.id, resourceOwnerUserId: ownerUserId })

			const result = await call(syncApprovalsProcedure, { limit: 100 }, { context: makeContext(ownerUserId) })

			expect(result.rows.map((r) => r.id)).toContain(approval.id)
		})

		test('user cannot see approvals owned by others (no task_id)', async () => {
			const session = await createSession({ resourceOwnerUserId: ownerUserId })
			const approval = await createApproval({ sessionId: session.id, resourceOwnerUserId: ownerUserId })

			const result = await call(syncApprovalsProcedure, { limit: 100 }, { context: makeContext(strangerUserId) })

			expect(result.rows.map((r) => r.id)).not.toContain(approval.id)
		})
	})

	describe('Visibility - Task user ACL', () => {
		test('user with task ACL can see approvals for that task', async () => {
			const task = await createTask({ resourceOwnerUserId: ownerUserId })
			const session = await createSession({ resourceOwnerUserId: ownerUserId, taskId: task.id })
			const approval = await createApproval({
				sessionId: session.id,
				resourceOwnerUserId: ownerUserId,
				taskId: task.id,
			})

			// Grant ACL to aclHolderUserId
			await db.insert(taskUserAcl).values({
				organization_id: organizationId,
				subject_user_id: aclHolderUserId,
				task_id: task.id,
				resource_owner_user_id: ownerUserId,
				permission_level: 'read',
				granted_by: ownerUserId,
			})

			const result = await call(syncApprovalsProcedure, { limit: 100 }, { context: makeContext(aclHolderUserId) })

			expect(result.rows.map((r) => r.id)).toContain(approval.id)
		})

		test('user without task ACL cannot see approvals for that task', async () => {
			const task = await createTask({ resourceOwnerUserId: ownerUserId, name: 'acl-blocked task' })
			const session = await createSession({ resourceOwnerUserId: ownerUserId, taskId: task.id })
			const approval = await createApproval({
				sessionId: session.id,
				resourceOwnerUserId: ownerUserId,
				taskId: task.id,
			})

			// No ACL granted to strangerUserId
			const result = await call(syncApprovalsProcedure, { limit: 100 }, { context: makeContext(strangerUserId) })

			expect(result.rows.map((r) => r.id)).not.toContain(approval.id)
		})
	})

	describe('Visibility - Task organization ACL', () => {
		test('user can see approvals for tasks with organization ACL', async () => {
			const task = await createTask({ resourceOwnerUserId: ownerUserId, name: 'org-acl task' })
			const session = await createSession({ resourceOwnerUserId: ownerUserId, taskId: task.id })
			const approval = await createApproval({
				sessionId: session.id,
				resourceOwnerUserId: ownerUserId,
				taskId: task.id,
			})

			// Grant org-level ACL
			await db.insert(taskOrganizationAcl).values({
				organization_id: organizationId,
				task_id: task.id,
				resource_owner_user_id: ownerUserId,
				permission_level: 'read',
				granted_by: ownerUserId,
			})

			// Stranger should now see it via org ACL
			const result = await call(syncApprovalsProcedure, { limit: 100 }, { context: makeContext(strangerUserId) })

			expect(result.rows.map((r) => r.id)).toContain(approval.id)
		})
	})

	describe('Pagination', () => {
		test('respects limit parameter', async () => {
			const session = await createSession({ resourceOwnerUserId: ownerUserId, title: 'pagination test session' })

			// Create 5 approvals
			for (let i = 0; i < 5; i++) {
				await createApproval({
					sessionId: session.id,
					resourceOwnerUserId: ownerUserId,
					toolName: `tool_${i}`,
				})
			}

			const result = await call(syncApprovalsProcedure, { limit: 3 }, { context: makeContext(ownerUserId) })

			expect(result.rows.length).toBeLessThanOrEqual(3)
		})

		test('respects offset parameter', async () => {
			const session = await createSession({
				resourceOwnerUserId: ownerUserId,
				title: 'offset test session',
			})

			// Create 3 approvals with distinct tool names for identification
			const approval1 = await createApproval({
				sessionId: session.id,
				resourceOwnerUserId: ownerUserId,
				toolName: 'offset_tool_1',
			})
			const approval2 = await createApproval({
				sessionId: session.id,
				resourceOwnerUserId: ownerUserId,
				toolName: 'offset_tool_2',
			})
			const approval3 = await createApproval({
				sessionId: session.id,
				resourceOwnerUserId: ownerUserId,
				toolName: 'offset_tool_3',
			})

			// Get all first using the correct WhereExpression schema format
			const allResult = await call(
				syncApprovalsProcedure,
				{
					limit: 100,
					where: {
						type: 'or',
						conditions: [
							{ type: 'comparison', field: ['id'], operator: 'eq', value: approval1.id },
							{ type: 'comparison', field: ['id'], operator: 'eq', value: approval2.id },
							{ type: 'comparison', field: ['id'], operator: 'eq', value: approval3.id },
						],
					},
				},
				{ context: makeContext(ownerUserId) },
			)
			expect(allResult.rows.length).toBe(3)

			// Get with offset
			const offsetResult = await call(
				syncApprovalsProcedure,
				{
					limit: 100,
					offset: 1,
					where: {
						type: 'or',
						conditions: [
							{ type: 'comparison', field: ['id'], operator: 'eq', value: approval1.id },
							{ type: 'comparison', field: ['id'], operator: 'eq', value: approval2.id },
							{ type: 'comparison', field: ['id'], operator: 'eq', value: approval3.id },
						],
					},
				},
				{ context: makeContext(ownerUserId) },
			)
			expect(offsetResult.rows.length).toBe(2)
		})
	})

	describe('Filtering', () => {
		test('filters by status using where clause', async () => {
			const session = await createSession({ resourceOwnerUserId: ownerUserId, title: 'filter test session' })

			const pendingApproval = await createApproval({
				sessionId: session.id,
				resourceOwnerUserId: ownerUserId,
				status: 'pending',
				toolName: 'filter_pending',
			})

			const approvedApproval = await createApproval({
				sessionId: session.id,
				resourceOwnerUserId: ownerUserId,
				status: 'approved',
				toolName: 'filter_approved',
			})

			// Filter for pending only using the correct WhereExpression schema format
			const result = await call(
				syncApprovalsProcedure,
				{
					limit: 100,
					where: {
						type: 'and',
						conditions: [
							{ type: 'comparison', field: ['status'], operator: 'eq', value: 'pending' },
							{
								type: 'or',
								conditions: [
									{ type: 'comparison', field: ['id'], operator: 'eq', value: pendingApproval.id },
									{ type: 'comparison', field: ['id'], operator: 'eq', value: approvedApproval.id },
								],
							},
						],
					},
				},
				{ context: makeContext(ownerUserId) },
			)

			expect(result.rows.map((r) => r.id)).toContain(pendingApproval.id)
			expect(result.rows.map((r) => r.id)).not.toContain(approvedApproval.id)
		})

		test('filters by session_id', async () => {
			const session1 = await createSession({ resourceOwnerUserId: ownerUserId, title: 'session filter 1' })
			const session2 = await createSession({ resourceOwnerUserId: ownerUserId, title: 'session filter 2' })

			const approval1 = await createApproval({
				sessionId: session1.id,
				resourceOwnerUserId: ownerUserId,
				toolName: 'session1_tool',
			})
			const approval2 = await createApproval({
				sessionId: session2.id,
				resourceOwnerUserId: ownerUserId,
				toolName: 'session2_tool',
			})

			const result = await call(
				syncApprovalsProcedure,
				{
					limit: 100,
					where: { type: 'comparison', field: ['session_id'], operator: 'eq', value: session1.id },
				},
				{ context: makeContext(ownerUserId) },
			)

			expect(result.rows.map((r) => r.id)).toContain(approval1.id)
			expect(result.rows.map((r) => r.id)).not.toContain(approval2.id)
		})
	})

	describe('Sorting', () => {
		test('sorts by created_at ascending', async () => {
			const session = await createSession({ resourceOwnerUserId: ownerUserId, title: 'sort test session' })

			// Create approvals with slight delay to ensure different timestamps
			const approval1 = await createApproval({
				sessionId: session.id,
				resourceOwnerUserId: ownerUserId,
				toolName: 'sort_first',
			})
			// Small delay to ensure different created_at
			await new Promise((resolve) => setTimeout(resolve, 10))
			const approval2 = await createApproval({
				sessionId: session.id,
				resourceOwnerUserId: ownerUserId,
				toolName: 'sort_second',
			})

			const result = await call(
				syncApprovalsProcedure,
				{
					limit: 100,
					where: {
						type: 'or',
						conditions: [
							{ type: 'comparison', field: ['id'], operator: 'eq', value: approval1.id },
							{ type: 'comparison', field: ['id'], operator: 'eq', value: approval2.id },
						],
					},
					sorts: [{ field: ['created_at'], direction: 'asc', nulls: 'last' }],
				},
				{ context: makeContext(ownerUserId) },
			)

			const ids = result.rows.map((r) => r.id)
			expect(ids.indexOf(approval1.id)).toBeLessThan(ids.indexOf(approval2.id))
		})

		test('sorts by created_at descending', async () => {
			const session = await createSession({ resourceOwnerUserId: ownerUserId, title: 'sort desc test session' })

			const approval1 = await createApproval({
				sessionId: session.id,
				resourceOwnerUserId: ownerUserId,
				toolName: 'sort_desc_first',
			})
			await new Promise((resolve) => setTimeout(resolve, 10))
			const approval2 = await createApproval({
				sessionId: session.id,
				resourceOwnerUserId: ownerUserId,
				toolName: 'sort_desc_second',
			})

			const result = await call(
				syncApprovalsProcedure,
				{
					limit: 100,
					where: {
						type: 'or',
						conditions: [
							{ type: 'comparison', field: ['id'], operator: 'eq', value: approval1.id },
							{ type: 'comparison', field: ['id'], operator: 'eq', value: approval2.id },
						],
					},
					sorts: [{ field: ['created_at'], direction: 'desc', nulls: 'last' }],
				},
				{ context: makeContext(ownerUserId) },
			)

			const ids = result.rows.map((r) => r.id)
			expect(ids.indexOf(approval2.id)).toBeLessThan(ids.indexOf(approval1.id))
		})
	})

	describe('Error handling', () => {
		test('returns BAD_REQUEST for invalid column in where clause', async () => {
			await expect(
				call(
					syncApprovalsProcedure,
					{
						limit: 100,
						where: { type: 'comparison', field: ['nonexistent_column'], operator: 'eq', value: 'test' },
					},
					{ context: makeContext(ownerUserId) },
				),
			).rejects.toThrow()
		})

		test('returns BAD_REQUEST for invalid column in sorts', async () => {
			await expect(
				call(
					syncApprovalsProcedure,
					{
						limit: 100,
						sorts: [{ field: ['nonexistent_column'], direction: 'asc', nulls: 'last' }],
					},
					{ context: makeContext(ownerUserId) },
				),
			).rejects.toThrow()
		})
	})

	describe('Organization isolation', () => {
		test('cannot see approvals from other organizations', async () => {
			// Create another organization
			const [otherOrg] = await db
				.insert(organizations)
				.values({ name: 'Other Org', workos_organization_id: `org_other_${uuidv7()}` })
				.returning()
			if (!otherOrg) throw new Error('Failed to create other org')

			// Create a session and approval in the other org
			const [otherSession] = await db
				.insert(sessions)
				.values({
					organization_id: otherOrg.id,
					resource_owner_user_id: ownerUserId,
					created_by: ownerUserId,
					host_id: hostId,
					title: 'other org session',
					working_directory: tmpdir(),
					coding_agent: 'claude',
					provider: 'anthropic',
					model: 'claude-sonnet-4-5',
					permissions_mode: 'accept_edits',
					status: 'needs_approval',
				})
				.returning()
			if (!otherSession) throw new Error('Failed to create other session')

			const [otherApproval] = await db
				.insert(approvals)
				.values({
					session_id: otherSession.id,
					organization_id: otherOrg.id,
					user_id: ownerUserId,
					host_id: hostId,
					resource_owner_user_id: ownerUserId,
					task_id: null,
					status: 'pending',
					tool_name: 'other_org_tool',
					tool_input: { command: 'ls' },
				})
				.returning()
			if (!otherApproval) throw new Error('Failed to create other approval')

			// Query from the main org - should not see the other org's approval
			const result = await call(syncApprovalsProcedure, { limit: 100 }, { context: makeContext(ownerUserId) })

			expect(result.rows.map((r) => r.id)).not.toContain(otherApproval.id)
		})
	})
})
