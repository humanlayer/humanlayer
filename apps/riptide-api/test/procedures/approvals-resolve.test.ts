import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'

import { approvals } from '@humanlayer/db/tables/approvals'
import { organizations } from '@humanlayer/db/tables/organizations'
import { sessions } from '@humanlayer/db/tables/sessions'
import { taskUserAcl } from '@humanlayer/db/tables/task-user-acl'
import { tasks } from '@humanlayer/db/tables/tasks'
import type { PermissionUpdate } from '@humanlayer/db/zodschemas/permission-update'
import { call } from '@orpc/server'
import { eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import type { AppRuntime } from '../../src/effects/app-runtime'
import { resolveApprovalEffectProcedure as liveProcedure } from '../../src/orpc/api/approvals/resolve.effect'
import { createMockApiAuth, createMockApiContext } from '../mocks'
import { bindProcedureToRuntime, createRuntimeWithTestPostgresLayer } from '../utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

/**
 * Approvals Resolve Tests - Authorization & Session Status
 *
 * Tests the two authorization paths for resolving approvals:
 * 1. Task-based: User must have write permission on the task
 * 2. Owner-based: User must be the resource_owner_user_id
 *
 * Also verifies session status transitions:
 * - Status updates to 'running' when last approval is resolved
 * - Status stays 'needs_approval' when pending approvals remain
 */
describe('api/approvals/resolve - Access Control', async () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let effectRuntime: AppRuntime
	let resolveApprovalProcedure: typeof liveProcedure

	let organizationId: string
	const workosOrganizationId = 'org_abc123'

	// Three actors
	const ownerUserId = 'user_owner_123'
	const aclHolderUserId = 'user_acl_holder_456'
	const strangerUserId = 'user_stranger_789'

	const hostId = randomUUID()

	async function createOwnerPendingApproval(title = 'owner session for applied suggestions') {
		const [session] = await db
			.insert(sessions)
			.values({
				organization_id: organizationId,
				resource_owner_user_id: ownerUserId,
				created_by: ownerUserId,
				host_id: hostId,
				title,
				working_directory: tmpdir(),
				coding_agent: 'claude',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissions_mode: 'accept_edits',
				status: 'needs_approval',
			})
			.returning()

		if (!session) throw new Error('Failed to create session')

		const [approval] = await db
			.insert(approvals)
			.values({
				session_id: session.id,
				organization_id: organizationId,
				user_id: ownerUserId,
				host_id: hostId,
				resource_owner_user_id: ownerUserId,
				task_id: null,
				status: 'pending',
				tool_name: 'bash',
				tool_input: { command: 'git push origin main' },
			})
			.returning()

		if (!approval) throw new Error('Failed to create approval')
		return approval
	}

	async function resolveAsOwner(input: {
		approvalId: string
		decision: 'approve' | 'deny'
		appliedSuggestions?: PermissionUpdate[]
	}) {
		return call(resolveApprovalProcedure, input, {
			context: createMockApiContext({
				auth: createMockApiAuth({ userId: ownerUserId, organizationId, workosOrganizationId }),
				services: { db, dbReadReplica: db },
			}),
		})
	}

	async function readAppliedSuggestions(approvalId: string) {
		const [row] = await db
			.select({ applied_suggestions: approvals.applied_suggestions })
			.from(approvals)
			.where(eq(approvals.id, approvalId))
			.limit(1)
		return row?.applied_suggestions
	}

	beforeAll(async () => {
		const testDb = await createTestDb('approvals_resolve')
		cleanupTestDb = testDb.cleanup
		db = testDb.db
		effectRuntime = createRuntimeWithTestPostgresLayer(db)
		resolveApprovalProcedure = bindProcedureToRuntime(liveProcedure, effectRuntime)

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

	describe('Owner scenarios (approval WITHOUT task_id)', () => {
		test('Owner can approve their own approval (no task_id)', async () => {
			// Create session owned by ownerUserId (no task_id)
			const [session] = await db
				.insert(sessions)
				.values({
					organization_id: organizationId,
					resource_owner_user_id: ownerUserId,
					created_by: ownerUserId,
					host_id: hostId,
					title: 'owner session for approval',
					working_directory: tmpdir(),
					coding_agent: 'claude',
					provider: 'anthropic',
					model: 'claude-sonnet-4-5',
					permissions_mode: 'accept_edits',
					status: 'needs_approval',
				})
				.returning()

			if (!session) throw new Error('Failed to create session')

			// Create pending approval (no task_id)
			const [approval] = await db
				.insert(approvals)
				.values({
					session_id: session.id,
					organization_id: organizationId,
					user_id: ownerUserId,
					host_id: hostId,
					resource_owner_user_id: ownerUserId,
					task_id: null,
					status: 'pending',
					tool_name: 'bash',
					tool_input: { command: 'ls' },
				})
				.returning()

			if (!approval) throw new Error('Failed to create approval')

			// Owner approves the approval
			const result = await call(
				resolveApprovalProcedure,
				{ approvalId: approval.id, decision: 'approve' },
				{
					context: createMockApiContext({
						auth: createMockApiAuth({ userId: ownerUserId, organizationId, workosOrganizationId }),
						services: { db, dbReadReplica: db },
					}),
				},
			)

			expect(result.success).toBe(true)

			// Verify approval is now approved
			const [updatedApproval] = await db.select().from(approvals).where(eq(approvals.id, approval.id)).limit(1)

			expect(updatedApproval?.status).toBe('approved')
			expect(updatedApproval?.approved_by_user_id).toBe(ownerUserId)
			expect(updatedApproval?.responded_at).toBeTruthy()

			// Verify session status updated to 'running'
			const [updatedSession] = await db.select().from(sessions).where(eq(sessions.id, session.id)).limit(1)

			expect(updatedSession?.status).toBe('running')
		})

		test('Owner can deny their own approval (no task_id)', async () => {
			// Create session owned by ownerUserId (no task_id)
			const [session] = await db
				.insert(sessions)
				.values({
					organization_id: organizationId,
					resource_owner_user_id: ownerUserId,
					created_by: ownerUserId,
					host_id: hostId,
					title: 'owner session for denial',
					working_directory: tmpdir(),
					coding_agent: 'claude',
					provider: 'anthropic',
					model: 'claude-sonnet-4-5',
					permissions_mode: 'accept_edits',
					status: 'needs_approval',
				})
				.returning()

			if (!session) throw new Error('Failed to create session')

			// Create pending approval (no task_id)
			const [approval] = await db
				.insert(approvals)
				.values({
					session_id: session.id,
					organization_id: organizationId,
					user_id: ownerUserId,
					host_id: hostId,
					resource_owner_user_id: ownerUserId,
					task_id: null,
					status: 'pending',
					tool_name: 'bash',
					tool_input: { command: 'rm -rf /' },
				})
				.returning()

			if (!approval) throw new Error('Failed to create approval')

			// Owner denies the approval
			const result = await call(
				resolveApprovalProcedure,
				{ approvalId: approval.id, decision: 'deny', comment: 'Too dangerous' },
				{
					context: createMockApiContext({
						auth: createMockApiAuth({ userId: ownerUserId, organizationId, workosOrganizationId }),
						services: { db, dbReadReplica: db },
					}),
				},
			)

			expect(result.success).toBe(true)

			// Verify approval is now denied
			const [updatedApproval] = await db.select().from(approvals).where(eq(approvals.id, approval.id)).limit(1)

			expect(updatedApproval?.status).toBe('denied')
			expect(updatedApproval?.approved_by_user_id).toBe(ownerUserId)
			expect(updatedApproval?.comment).toBe('The user denied this tool call with feedback: Too dangerous')
			expect(updatedApproval?.responded_at).toBeTruthy()

			// Verify session status updated to 'running'
			const [updatedSession] = await db.select().from(sessions).where(eq(sessions.id, session.id)).limit(1)

			expect(updatedSession?.status).toBe('running')
		})

		test('Session status updates to running when last approval resolved', async () => {
			// Create session with multiple pending approvals
			const [session] = await db
				.insert(sessions)
				.values({
					organization_id: organizationId,
					resource_owner_user_id: ownerUserId,
					created_by: ownerUserId,
					host_id: hostId,
					title: 'session with multiple approvals',
					working_directory: tmpdir(),
					coding_agent: 'claude',
					provider: 'anthropic',
					model: 'claude-sonnet-4-5',
					permissions_mode: 'accept_edits',
					status: 'needs_approval',
				})
				.returning()

			if (!session) throw new Error('Failed to create session')

			// Create two pending approvals
			const [approval1] = await db
				.insert(approvals)
				.values({
					session_id: session.id,
					organization_id: organizationId,
					user_id: ownerUserId,
					host_id: hostId,
					resource_owner_user_id: ownerUserId,
					task_id: null,
					status: 'pending',
					tool_name: 'bash',
					tool_input: { command: 'ls' },
				})
				.returning()

			const [approval2] = await db
				.insert(approvals)
				.values({
					session_id: session.id,
					organization_id: organizationId,
					user_id: ownerUserId,
					host_id: hostId,
					resource_owner_user_id: ownerUserId,
					task_id: null,
					status: 'pending',
					tool_name: 'bash',
					tool_input: { command: 'pwd' },
				})
				.returning()

			if (!approval1 || !approval2) throw new Error('Failed to create approvals')

			// Resolve first approval
			await call(
				resolveApprovalProcedure,
				{ approvalId: approval1.id, decision: 'approve' },
				{
					context: createMockApiContext({
						auth: createMockApiAuth({ userId: ownerUserId, organizationId, workosOrganizationId }),
						services: { db, dbReadReplica: db },
					}),
				},
			)

			// Session should still be needs_approval (one pending approval remains)
			const [sessionAfterFirst] = await db.select().from(sessions).where(eq(sessions.id, session.id)).limit(1)

			expect(sessionAfterFirst?.status).toBe('needs_approval')

			// Resolve second approval
			await call(
				resolveApprovalProcedure,
				{ approvalId: approval2.id, decision: 'approve' },
				{
					context: createMockApiContext({
						auth: createMockApiAuth({ userId: ownerUserId, organizationId, workosOrganizationId }),
						services: { db, dbReadReplica: db },
					}),
				},
			)

			// Now session should be running (no pending approvals)
			const [sessionAfterSecond] = await db.select().from(sessions).where(eq(sessions.id, session.id)).limit(1)

			expect(sessionAfterSecond?.status).toBe('running')
		})

		test('Session status stays needs_approval when pending approvals remain', async () => {
			// Create session with multiple pending approvals
			const [session] = await db
				.insert(sessions)
				.values({
					organization_id: organizationId,
					resource_owner_user_id: ownerUserId,
					created_by: ownerUserId,
					host_id: hostId,
					title: 'session with remaining pending',
					working_directory: tmpdir(),
					coding_agent: 'claude',
					provider: 'anthropic',
					model: 'claude-sonnet-4-5',
					permissions_mode: 'accept_edits',
					status: 'needs_approval',
				})
				.returning()

			if (!session) throw new Error('Failed to create session')

			// Create three pending approvals
			const [approval1] = await db
				.insert(approvals)
				.values({
					session_id: session.id,
					organization_id: organizationId,
					user_id: ownerUserId,
					host_id: hostId,
					resource_owner_user_id: ownerUserId,
					task_id: null,
					status: 'pending',
					tool_name: 'bash',
					tool_input: { command: 'ls' },
				})
				.returning()

			await db.insert(approvals).values({
				session_id: session.id,
				organization_id: organizationId,
				user_id: ownerUserId,
				host_id: hostId,
				resource_owner_user_id: ownerUserId,
				task_id: null,
				status: 'pending',
				tool_name: 'bash',
				tool_input: { command: 'pwd' },
			})

			if (!approval1) throw new Error('Failed to create approval1')

			// Resolve only first approval
			await call(
				resolveApprovalProcedure,
				{ approvalId: approval1.id, decision: 'approve' },
				{
					context: createMockApiContext({
						auth: createMockApiAuth({ userId: ownerUserId, organizationId, workosOrganizationId }),
						services: { db, dbReadReplica: db },
					}),
				},
			)

			// Session should still be needs_approval
			const [updatedSession] = await db.select().from(sessions).where(eq(sessions.id, session.id)).limit(1)

			expect(updatedSession?.status).toBe('needs_approval')
		})
	})

	describe('Task-based scenarios (approval WITH task_id)', () => {
		test('Session creator with task write ACL can approve approval', async () => {
			// Create task owned by ownerUserId
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'shared task for approval',
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

			// Create session with task_id, created by aclHolderUserId (they are the session creator)
			const [session] = await db
				.insert(sessions)
				.values({
					organization_id: organizationId,
					resource_owner_user_id: ownerUserId,
					created_by: aclHolderUserId,
					host_id: hostId,
					task_id: task.id,
					title: 'task-based session',
					working_directory: tmpdir(),
					coding_agent: 'claude',
					provider: 'anthropic',
					model: 'claude-sonnet-4-5',
					permissions_mode: 'accept_edits',
					status: 'needs_approval',
				})
				.returning()

			if (!session) throw new Error('Failed to create session')

			// Create pending approval with task_id
			const [approval] = await db
				.insert(approvals)
				.values({
					session_id: session.id,
					organization_id: organizationId,
					user_id: aclHolderUserId,
					host_id: hostId,
					resource_owner_user_id: ownerUserId,
					task_id: task.id,
					status: 'pending',
					tool_name: 'bash',
					tool_input: { command: 'ls' },
				})
				.returning()

			if (!approval) throw new Error('Failed to create approval')

			// Session creator (aclHolderUserId) approves (has write permission AND is the creator)
			const result = await call(
				resolveApprovalProcedure,
				{ approvalId: approval.id, decision: 'approve' },
				{
					context: createMockApiContext({
						auth: createMockApiAuth({ userId: aclHolderUserId, organizationId, workosOrganizationId }),
						services: { db, dbReadReplica: db },
					}),
				},
			)

			expect(result.success).toBe(true)

			// Verify approval is approved by ACL holder
			const [updatedApproval] = await db.select().from(approvals).where(eq(approvals.id, approval.id)).limit(1)

			expect(updatedApproval?.status).toBe('approved')
			expect(updatedApproval?.approved_by_user_id).toBe(aclHolderUserId)
		})

		test('Session creator with task write ACL can deny approval', async () => {
			// Create task owned by ownerUserId
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'shared task for denial',
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

			// Create session with task_id, created by aclHolderUserId (they are the session creator)
			const [session] = await db
				.insert(sessions)
				.values({
					organization_id: organizationId,
					resource_owner_user_id: ownerUserId,
					created_by: aclHolderUserId,
					host_id: hostId,
					task_id: task.id,
					title: 'task-based session for denial',
					working_directory: tmpdir(),
					coding_agent: 'claude',
					provider: 'anthropic',
					model: 'claude-sonnet-4-5',
					permissions_mode: 'accept_edits',
					status: 'needs_approval',
				})
				.returning()

			if (!session) throw new Error('Failed to create session')

			// Create pending approval with task_id
			const [approval] = await db
				.insert(approvals)
				.values({
					session_id: session.id,
					organization_id: organizationId,
					user_id: aclHolderUserId,
					host_id: hostId,
					resource_owner_user_id: ownerUserId,
					task_id: task.id,
					status: 'pending',
					tool_name: 'bash',
					tool_input: { command: 'rm important.txt' },
				})
				.returning()

			if (!approval) throw new Error('Failed to create approval')

			// Session creator (aclHolderUserId) denies (has write permission AND is the creator)
			const result = await call(
				resolveApprovalProcedure,
				{ approvalId: approval.id, decision: 'deny' },
				{
					context: createMockApiContext({
						auth: createMockApiAuth({ userId: aclHolderUserId, organizationId, workosOrganizationId }),
						services: { db, dbReadReplica: db },
					}),
				},
			)

			expect(result.success).toBe(true)

			// Verify approval is denied by ACL holder
			const [updatedApproval] = await db.select().from(approvals).where(eq(approvals.id, approval.id)).limit(1)

			expect(updatedApproval?.status).toBe('denied')
			expect(updatedApproval?.approved_by_user_id).toBe(aclHolderUserId)
		})

		test('Task owner can approve approval', async () => {
			// Create task owned by ownerUserId
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'owner task for approval',
					resource_owner_user_id: ownerUserId,
					created_by: ownerUserId,
					default_working_directory: tmpdir(),
					setup_status: 'completed',
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			// Create session with task_id
			const [session] = await db
				.insert(sessions)
				.values({
					organization_id: organizationId,
					resource_owner_user_id: ownerUserId,
					created_by: ownerUserId,
					host_id: hostId,
					task_id: task.id,
					title: 'owner task session',
					working_directory: tmpdir(),
					coding_agent: 'claude',
					provider: 'anthropic',
					model: 'claude-sonnet-4-5',
					permissions_mode: 'accept_edits',
					status: 'needs_approval',
				})
				.returning()

			if (!session) throw new Error('Failed to create session')

			// Create pending approval with task_id
			const [approval] = await db
				.insert(approvals)
				.values({
					session_id: session.id,
					organization_id: organizationId,
					user_id: ownerUserId,
					host_id: hostId,
					resource_owner_user_id: ownerUserId,
					task_id: task.id,
					status: 'pending',
					tool_name: 'bash',
					tool_input: { command: 'ls' },
				})
				.returning()

			if (!approval) throw new Error('Failed to create approval')

			// Owner approves
			const result = await call(
				resolveApprovalProcedure,
				{ approvalId: approval.id, decision: 'approve' },
				{
					context: createMockApiContext({
						auth: createMockApiAuth({ userId: ownerUserId, organizationId, workosOrganizationId }),
						services: { db, dbReadReplica: db },
					}),
				},
			)

			expect(result.success).toBe(true)

			// Verify approval is approved by owner
			const [updatedApproval] = await db.select().from(approvals).where(eq(approvals.id, approval.id)).limit(1)

			expect(updatedApproval?.status).toBe('approved')
			expect(updatedApproval?.approved_by_user_id).toBe(ownerUserId)
		})
	})

	describe('ADVERSARIAL - Negative tests (CRITICAL)', () => {
		test('Stranger CANNOT resolve approval (task-based) - returns FORBIDDEN', async () => {
			// Create task owned by ownerUserId
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'task for stranger test',
					resource_owner_user_id: ownerUserId,
					created_by: ownerUserId,
					default_working_directory: tmpdir(),
					setup_status: 'completed',
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			// Create session with task_id
			const [session] = await db
				.insert(sessions)
				.values({
					organization_id: organizationId,
					resource_owner_user_id: ownerUserId,
					created_by: ownerUserId,
					host_id: hostId,
					task_id: task.id,
					title: 'session for stranger attack',
					working_directory: tmpdir(),
					coding_agent: 'claude',
					provider: 'anthropic',
					model: 'claude-sonnet-4-5',
					permissions_mode: 'accept_edits',
					status: 'needs_approval',
				})
				.returning()

			if (!session) throw new Error('Failed to create session')

			// Create pending approval with task_id
			const [approval] = await db
				.insert(approvals)
				.values({
					session_id: session.id,
					organization_id: organizationId,
					user_id: ownerUserId,
					host_id: hostId,
					resource_owner_user_id: ownerUserId,
					task_id: task.id,
					status: 'pending',
					tool_name: 'bash',
					tool_input: { command: 'ls' },
				})
				.returning()

			if (!approval) throw new Error('Failed to create approval')

			// Stranger tries to approve (no access to task)
			await expect(
				call(
					resolveApprovalProcedure,
					{ approvalId: approval.id, decision: 'approve' },
					{
						context: createMockApiContext({
							auth: createMockApiAuth({ userId: strangerUserId, organizationId, workosOrganizationId }),
							services: { db, dbReadReplica: db },
						}),
					},
				),
			).rejects.toThrow()

			// Verify approval is still pending (DB unchanged)
			const [unchangedApproval] = await db.select().from(approvals).where(eq(approvals.id, approval.id)).limit(1)

			expect(unchangedApproval?.status).toBe('pending')
			expect(unchangedApproval?.approved_by_user_id).toBeNull()
		})

		test('Stranger CANNOT resolve approval (owner-based) - returns FORBIDDEN', async () => {
			// Create session owned by ownerUserId (no task_id)
			const [session] = await db
				.insert(sessions)
				.values({
					organization_id: organizationId,
					resource_owner_user_id: ownerUserId,
					created_by: ownerUserId,
					host_id: hostId,
					title: 'owner session for stranger attack',
					working_directory: tmpdir(),
					coding_agent: 'claude',
					provider: 'anthropic',
					model: 'claude-sonnet-4-5',
					permissions_mode: 'accept_edits',
					status: 'needs_approval',
				})
				.returning()

			if (!session) throw new Error('Failed to create session')

			// Create pending approval (no task_id)
			const [approval] = await db
				.insert(approvals)
				.values({
					session_id: session.id,
					organization_id: organizationId,
					user_id: ownerUserId,
					host_id: hostId,
					resource_owner_user_id: ownerUserId,
					task_id: null,
					status: 'pending',
					tool_name: 'bash',
					tool_input: { command: 'ls' },
				})
				.returning()

			if (!approval) throw new Error('Failed to create approval')

			// Stranger tries to approve (not resource owner)
			await expect(
				call(
					resolveApprovalProcedure,
					{ approvalId: approval.id, decision: 'approve' },
					{
						context: createMockApiContext({
							auth: createMockApiAuth({ userId: strangerUserId, organizationId, workosOrganizationId }),
							services: { db, dbReadReplica: db },
						}),
					},
				),
			).rejects.toThrow()

			// Verify approval is still pending (DB unchanged)
			const [unchangedApproval] = await db.select().from(approvals).where(eq(approvals.id, approval.id)).limit(1)

			expect(unchangedApproval?.status).toBe('pending')
			expect(unchangedApproval?.approved_by_user_id).toBeNull()
		})

		test('User with only read ACL CANNOT resolve approval - returns FORBIDDEN', async () => {
			// Create task owned by ownerUserId
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'task for read-only test',
					resource_owner_user_id: ownerUserId,
					created_by: ownerUserId,
					default_working_directory: tmpdir(),
					setup_status: 'completed',
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			// Grant read-only ACL to aclHolderUserId
			await db.insert(taskUserAcl).values({
				organization_id: organizationId,
				subject_user_id: aclHolderUserId,
				task_id: task.id,
				resource_owner_user_id: ownerUserId,
				permission_level: 'read',
				granted_by: ownerUserId,
			})

			// Create session with task_id
			const [session] = await db
				.insert(sessions)
				.values({
					organization_id: organizationId,
					resource_owner_user_id: ownerUserId,
					created_by: ownerUserId,
					host_id: hostId,
					task_id: task.id,
					title: 'read-only session',
					working_directory: tmpdir(),
					coding_agent: 'claude',
					provider: 'anthropic',
					model: 'claude-sonnet-4-5',
					permissions_mode: 'accept_edits',
					status: 'needs_approval',
				})
				.returning()

			if (!session) throw new Error('Failed to create session')

			// Create pending approval with task_id
			const [approval] = await db
				.insert(approvals)
				.values({
					session_id: session.id,
					organization_id: organizationId,
					user_id: ownerUserId,
					host_id: hostId,
					resource_owner_user_id: ownerUserId,
					task_id: task.id,
					status: 'pending',
					tool_name: 'bash',
					tool_input: { command: 'ls' },
				})
				.returning()

			if (!approval) throw new Error('Failed to create approval')

			// User with read-only ACL tries to approve
			await expect(
				call(
					resolveApprovalProcedure,
					{ approvalId: approval.id, decision: 'approve' },
					{
						context: createMockApiContext({
							auth: createMockApiAuth({ userId: aclHolderUserId, organizationId, workosOrganizationId }),
							services: { db, dbReadReplica: db },
						}),
					},
				),
			).rejects.toThrow()

			// Verify approval is still pending
			const [unchangedApproval] = await db.select().from(approvals).where(eq(approvals.id, approval.id)).limit(1)

			expect(unchangedApproval?.status).toBe('pending')
			expect(unchangedApproval?.approved_by_user_id).toBeNull()
		})

		test('User with only comment ACL CANNOT resolve approval - returns FORBIDDEN', async () => {
			// Create task owned by ownerUserId
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					name: 'task for comment-only test',
					resource_owner_user_id: ownerUserId,
					created_by: ownerUserId,
					default_working_directory: tmpdir(),
					setup_status: 'completed',
				})
				.returning()

			if (!task) throw new Error('Failed to create task')

			// Grant comment-only ACL to aclHolderUserId
			await db.insert(taskUserAcl).values({
				organization_id: organizationId,
				subject_user_id: aclHolderUserId,
				task_id: task.id,
				resource_owner_user_id: ownerUserId,
				permission_level: 'comment',
				granted_by: ownerUserId,
			})

			// Create session with task_id
			const [session] = await db
				.insert(sessions)
				.values({
					organization_id: organizationId,
					resource_owner_user_id: ownerUserId,
					created_by: ownerUserId,
					host_id: hostId,
					task_id: task.id,
					title: 'comment-only session',
					working_directory: tmpdir(),
					coding_agent: 'claude',
					provider: 'anthropic',
					model: 'claude-sonnet-4-5',
					permissions_mode: 'accept_edits',
					status: 'needs_approval',
				})
				.returning()

			if (!session) throw new Error('Failed to create session')

			// Create pending approval with task_id
			const [approval] = await db
				.insert(approvals)
				.values({
					session_id: session.id,
					organization_id: organizationId,
					user_id: ownerUserId,
					host_id: hostId,
					resource_owner_user_id: ownerUserId,
					task_id: task.id,
					status: 'pending',
					tool_name: 'bash',
					tool_input: { command: 'ls' },
				})
				.returning()

			if (!approval) throw new Error('Failed to create approval')

			// User with comment-only ACL tries to approve
			await expect(
				call(
					resolveApprovalProcedure,
					{ approvalId: approval.id, decision: 'approve' },
					{
						context: createMockApiContext({
							auth: createMockApiAuth({ userId: aclHolderUserId, organizationId, workosOrganizationId }),
							services: { db, dbReadReplica: db },
						}),
					},
				),
			).rejects.toThrow()

			// Verify approval is still pending
			const [unchangedApproval] = await db.select().from(approvals).where(eq(approvals.id, approval.id)).limit(1)

			expect(unchangedApproval?.status).toBe('pending')
			expect(unchangedApproval?.approved_by_user_id).toBeNull()
		})

		test('Non-existent approval returns NOT_FOUND', async () => {
			const fakeApprovalId = randomUUID()

			await expect(
				call(
					resolveApprovalProcedure,
					{ approvalId: fakeApprovalId, decision: 'approve' },
					{
						context: createMockApiContext({
							auth: createMockApiAuth({ userId: ownerUserId, organizationId, workosOrganizationId }),
							services: { db, dbReadReplica: db },
						}),
					},
				),
			).rejects.toThrow()
		})

		test('Approve with empty appliedSuggestions stores an empty array', async () => {
			const approval = await createOwnerPendingApproval('empty applied suggestions')

			const result = await resolveAsOwner({
				approvalId: approval.id,
				decision: 'approve',
				appliedSuggestions: [],
			})

			expect(result.success).toBe(true)
			expect(await readAppliedSuggestions(approval.id)).toEqual([])
		})

		test('Approve with appliedSuggestions stores the array verbatim', async () => {
			const approval = await createOwnerPendingApproval('single applied suggestion')
			const appliedSuggestions: PermissionUpdate[] = [
				{
					type: 'addRules',
					rules: [{ toolName: 'Bash', ruleContent: 'git push *' }],
					behavior: 'allow',
					destination: 'localSettings',
				},
			]

			const result = await resolveAsOwner({ approvalId: approval.id, decision: 'approve', appliedSuggestions })

			expect(result.success).toBe(true)
			expect(await readAppliedSuggestions(approval.id)).toEqual(appliedSuggestions)
		})

		test('Approve with mixed appliedSuggestions stores all suggestion types', async () => {
			const approval = await createOwnerPendingApproval('mixed applied suggestions')
			const appliedSuggestions: PermissionUpdate[] = [
				{
					type: 'addRules',
					rules: [{ toolName: 'Bash', ruleContent: 'git push *' }],
					behavior: 'allow',
					destination: 'localSettings',
				},
				{ type: 'setMode', mode: 'acceptEdits', destination: 'session' },
				{ type: 'addDirectories', directories: ['/tmp'], destination: 'session' },
			]

			const result = await resolveAsOwner({ approvalId: approval.id, decision: 'approve', appliedSuggestions })

			expect(result.success).toBe(true)
			expect(await readAppliedSuggestions(approval.id)).toEqual(appliedSuggestions)
		})

		test('Deny ignores appliedSuggestions and stores null', async () => {
			const approval = await createOwnerPendingApproval('deny applied suggestions')
			const appliedSuggestions: PermissionUpdate[] = [
				{
					type: 'addRules',
					rules: [{ toolName: 'Bash', ruleContent: 'git push *' }],
					behavior: 'allow',
					destination: 'localSettings',
				},
			]

			const result = await resolveAsOwner({ approvalId: approval.id, decision: 'deny', appliedSuggestions })

			expect(result.success).toBe(true)
			expect(await readAppliedSuggestions(approval.id)).toBeNull()
		})

		test('Approve without appliedSuggestions stores null', async () => {
			const approval = await createOwnerPendingApproval('omitted applied suggestions')

			const result = await resolveAsOwner({ approvalId: approval.id, decision: 'approve' })

			expect(result.success).toBe(true)
			expect(await readAppliedSuggestions(approval.id)).toBeNull()
		})

		test('Idempotent re-resolve preserves original appliedSuggestions', async () => {
			const approval = await createOwnerPendingApproval('idempotent applied suggestions')
			const original: PermissionUpdate[] = [
				{
					type: 'addRules',
					rules: [{ toolName: 'Bash', ruleContent: 'git push *' }],
					behavior: 'allow',
					destination: 'localSettings',
				},
			]
			const replacement: PermissionUpdate[] = [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }]

			const first = await resolveAsOwner({
				approvalId: approval.id,
				decision: 'approve',
				appliedSuggestions: original,
			})
			const second = await resolveAsOwner({
				approvalId: approval.id,
				decision: 'approve',
				appliedSuggestions: replacement,
			})

			expect(first.success).toBe(true)
			expect(second.success).toBe(true)
			expect(second.transactionId).toBeTruthy()
			expect(await readAppliedSuggestions(approval.id)).toEqual(original)
		})

		test('Already resolved approval with same decision is idempotent', async () => {
			// Create session
			const [session] = await db
				.insert(sessions)
				.values({
					organization_id: organizationId,
					resource_owner_user_id: ownerUserId,
					created_by: ownerUserId,
					host_id: hostId,
					title: 'session with resolved approval',
					working_directory: tmpdir(),
					coding_agent: 'claude',
					provider: 'anthropic',
					model: 'claude-sonnet-4-5',
					permissions_mode: 'accept_edits',
					status: 'running',
				})
				.returning()

			if (!session) throw new Error('Failed to create session')

			// Create already-approved approval
			const [approval] = await db
				.insert(approvals)
				.values({
					session_id: session.id,
					organization_id: organizationId,
					user_id: ownerUserId,
					host_id: hostId,
					resource_owner_user_id: ownerUserId,
					task_id: null,
					status: 'approved',
					approved_by_user_id: ownerUserId,
					tool_name: 'bash',
					tool_input: { command: 'ls' },
				})
				.returning()

			if (!approval) throw new Error('Failed to create approval')

			// Approving again with same decision succeeds (idempotent)
			const result = await call(
				resolveApprovalProcedure,
				{ approvalId: approval.id, decision: 'approve' },
				{
					context: createMockApiContext({
						auth: createMockApiAuth({ userId: ownerUserId, organizationId, workosOrganizationId }),
						services: { db, dbReadReplica: db },
					}),
				},
			)

			expect(result.success).toBe(true)

			// Verify approval status is still 'approved' (not changed)
			const [unchangedApproval] = await db.select().from(approvals).where(eq(approvals.id, approval.id)).limit(1)

			expect(unchangedApproval?.status).toBe('approved')
		})

		test('Already resolved approval with different decision still returns success', async () => {
			// Create session
			const [session] = await db
				.insert(sessions)
				.values({
					organization_id: organizationId,
					resource_owner_user_id: ownerUserId,
					created_by: ownerUserId,
					host_id: hostId,
					title: 'session with resolved approval for cross-decision',
					working_directory: tmpdir(),
					coding_agent: 'claude',
					provider: 'anthropic',
					model: 'claude-sonnet-4-5',
					permissions_mode: 'accept_edits',
					status: 'running',
				})
				.returning()

			if (!session) throw new Error('Failed to create session')

			// Create already-approved approval
			const [approval] = await db
				.insert(approvals)
				.values({
					session_id: session.id,
					organization_id: organizationId,
					user_id: ownerUserId,
					host_id: hostId,
					resource_owner_user_id: ownerUserId,
					task_id: null,
					status: 'approved',
					approved_by_user_id: ownerUserId,
					tool_name: 'bash',
					tool_input: { command: 'ls' },
				})
				.returning()

			if (!approval) throw new Error('Failed to create approval')

			// Trying to deny an already-approved approval succeeds (idempotent)
			const result = await call(
				resolveApprovalProcedure,
				{ approvalId: approval.id, decision: 'deny' },
				{
					context: createMockApiContext({
						auth: createMockApiAuth({ userId: ownerUserId, organizationId, workosOrganizationId }),
						services: { db, dbReadReplica: db },
					}),
				},
			)

			expect(result.success).toBe(true)

			// Verify approval status was not changed
			const [unchangedApproval] = await db.select().from(approvals).where(eq(approvals.id, approval.id)).limit(1)
			expect(unchangedApproval?.status).toBe('approved')
		})
	})

	afterAll(async () => {
		await effectRuntime?.dispose()
		await cleanupTestDb?.()
	}, 30000)
})
