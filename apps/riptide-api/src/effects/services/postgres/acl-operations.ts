import { aclOperationsLog } from '@humanlayer/db/tables/acl-operations-log'
import { taskOrganizationAcl } from '@humanlayer/db/tables/task-organization-acl'
import { type AclPermissionLevel, taskUserAcl } from '@humanlayer/db/tables/task-user-acl'
import { eq } from 'drizzle-orm'
import { Effect } from 'effect'

import type { PostgresTransaction } from './postgres-db.service'

/**
 * Effect-based ACL operations with automatic operations logging.
 * These functions are designed to work within an Effect transaction context.
 */

// ============================================================================
// Task User ACL Operations
// ============================================================================

export interface CreateTaskUserAclParams {
	organizationId: string
	subjectUserId: string
	taskId: string
	resourceOwnerUserId: string
	permissionLevel: AclPermissionLevel
	grantedBy: string
}

/**
 * Create a task user ACL entry with automatic operations logging.
 */
export function createTaskUserAcl(tx: PostgresTransaction, params: CreateTaskUserAclParams) {
	return Effect.gen(function* () {
		// Create the ACL entry
		const [aclEntry] = yield* tx.query(
			tx.client
				.insert(taskUserAcl)
				.values({
					organization_id: params.organizationId,
					subject_user_id: params.subjectUserId,
					task_id: params.taskId,
					resource_owner_user_id: params.resourceOwnerUserId,
					permission_level: params.permissionLevel,
					granted_by: params.grantedBy,
				})
				.returning(),
		)

		if (!aclEntry) {
			return yield* Effect.fail(new Error('Failed to create task user ACL entry'))
		}

		// Log the operation
		yield* tx.query(
			tx.client.insert(aclOperationsLog).values({
				acl_type: 'task_user_acl',
				acl_entry_id: aclEntry.id,
				task_id: params.taskId,
				organization_id: params.organizationId,
				target_user_id: params.subjectUserId,
				target_organization_id: null,
				operation: 'create',
				performed_by: params.grantedBy,
				permission_level_before: null,
				permission_level_after: params.permissionLevel,
				resource_owner_user_id: params.resourceOwnerUserId,
			}),
		)

		return aclEntry
	})
}

export interface UpdateTaskUserAclParams {
	aclEntryId: string
	newPermissionLevel: AclPermissionLevel
	updatedBy: string
}

/**
 * Update a task user ACL entry with automatic operations logging.
 */
export function updateTaskUserAcl(tx: PostgresTransaction, params: UpdateTaskUserAclParams) {
	return Effect.gen(function* () {
		// Get the existing ACL entry
		const [existingEntry] = yield* tx.query(
			tx.client.select().from(taskUserAcl).where(eq(taskUserAcl.id, params.aclEntryId)).limit(1),
		)

		if (!existingEntry) {
			return yield* Effect.fail(new Error('ACL entry not found'))
		}

		const oldPermissionLevel = existingEntry.permission_level

		// Update the ACL entry
		const [updatedEntry] = yield* tx.query(
			tx.client
				.update(taskUserAcl)
				.set({ permission_level: params.newPermissionLevel })
				.where(eq(taskUserAcl.id, params.aclEntryId))
				.returning(),
		)

		if (!updatedEntry) {
			return yield* Effect.fail(new Error('Failed to update task user ACL entry'))
		}

		// Log the operation
		yield* tx.query(
			tx.client.insert(aclOperationsLog).values({
				acl_type: 'task_user_acl',
				acl_entry_id: params.aclEntryId,
				task_id: existingEntry.task_id,
				organization_id: existingEntry.organization_id,
				target_user_id: existingEntry.subject_user_id,
				target_organization_id: null,
				operation: 'update',
				performed_by: params.updatedBy,
				permission_level_before: oldPermissionLevel,
				permission_level_after: params.newPermissionLevel,
				resource_owner_user_id: existingEntry.resource_owner_user_id,
			}),
		)

		return updatedEntry
	})
}

export interface DeleteTaskUserAclParams {
	aclEntryId: string
	deletedBy: string
}

/**
 * Delete a task user ACL entry with automatic operations logging.
 */
export function deleteTaskUserAcl(tx: PostgresTransaction, params: DeleteTaskUserAclParams) {
	return Effect.gen(function* () {
		// Get the existing ACL entry before deleting
		const [existingEntry] = yield* tx.query(
			tx.client.select().from(taskUserAcl).where(eq(taskUserAcl.id, params.aclEntryId)).limit(1),
		)

		if (!existingEntry) {
			return yield* Effect.fail(new Error('ACL entry not found'))
		}

		const oldPermissionLevel = existingEntry.permission_level

		// Delete the ACL entry
		yield* tx.query(tx.client.delete(taskUserAcl).where(eq(taskUserAcl.id, params.aclEntryId)))

		// Log the operation
		yield* tx.query(
			tx.client.insert(aclOperationsLog).values({
				acl_type: 'task_user_acl',
				acl_entry_id: params.aclEntryId,
				task_id: existingEntry.task_id,
				organization_id: existingEntry.organization_id,
				target_user_id: existingEntry.subject_user_id,
				target_organization_id: null,
				operation: 'delete',
				performed_by: params.deletedBy,
				permission_level_before: oldPermissionLevel,
				permission_level_after: null,
				resource_owner_user_id: existingEntry.resource_owner_user_id,
			}),
		)

		return existingEntry
	})
}

// ============================================================================
// Task Organization ACL Operations
// ============================================================================

export interface CreateTaskOrganizationAclParams {
	organizationId: string
	taskId: string
	resourceOwnerUserId: string
	permissionLevel: AclPermissionLevel
	grantedBy: string
}

/**
 * Create a task organization ACL entry with automatic operations logging.
 */
export function createTaskOrganizationAcl(tx: PostgresTransaction, params: CreateTaskOrganizationAclParams) {
	return Effect.gen(function* () {
		// Create the ACL entry
		const [aclEntry] = yield* tx.query(
			tx.client
				.insert(taskOrganizationAcl)
				.values({
					organization_id: params.organizationId,
					task_id: params.taskId,
					resource_owner_user_id: params.resourceOwnerUserId,
					permission_level: params.permissionLevel,
					granted_by: params.grantedBy,
				})
				.returning(),
		)

		if (!aclEntry) {
			return yield* Effect.fail(new Error('Failed to create task organization ACL entry'))
		}

		// Log the operation
		yield* tx.query(
			tx.client.insert(aclOperationsLog).values({
				acl_type: 'task_organization_acl',
				acl_entry_id: aclEntry.id,
				task_id: params.taskId,
				organization_id: params.organizationId,
				target_user_id: null,
				target_organization_id: params.organizationId,
				operation: 'create',
				performed_by: params.grantedBy,
				permission_level_before: null,
				permission_level_after: params.permissionLevel,
				resource_owner_user_id: params.resourceOwnerUserId,
			}),
		)

		return aclEntry
	})
}

export interface UpdateTaskOrganizationAclParams {
	aclEntryId: string
	newPermissionLevel: AclPermissionLevel
	updatedBy: string
}

/**
 * Update a task organization ACL entry with automatic operations logging.
 */
export function updateTaskOrganizationAcl(tx: PostgresTransaction, params: UpdateTaskOrganizationAclParams) {
	return Effect.gen(function* () {
		// Get the existing ACL entry
		const [existingEntry] = yield* tx.query(
			tx.client.select().from(taskOrganizationAcl).where(eq(taskOrganizationAcl.id, params.aclEntryId)).limit(1),
		)

		if (!existingEntry) {
			return yield* Effect.fail(new Error('ACL entry not found'))
		}

		const oldPermissionLevel = existingEntry.permission_level

		// Update the ACL entry
		const [updatedEntry] = yield* tx.query(
			tx.client
				.update(taskOrganizationAcl)
				.set({ permission_level: params.newPermissionLevel })
				.where(eq(taskOrganizationAcl.id, params.aclEntryId))
				.returning(),
		)

		if (!updatedEntry) {
			return yield* Effect.fail(new Error('Failed to update task organization ACL entry'))
		}

		// Log the operation
		yield* tx.query(
			tx.client.insert(aclOperationsLog).values({
				acl_type: 'task_organization_acl',
				acl_entry_id: params.aclEntryId,
				task_id: existingEntry.task_id,
				organization_id: existingEntry.organization_id,
				target_user_id: null,
				target_organization_id: existingEntry.organization_id,
				operation: 'update',
				performed_by: params.updatedBy,
				permission_level_before: oldPermissionLevel,
				permission_level_after: params.newPermissionLevel,
				resource_owner_user_id: existingEntry.resource_owner_user_id,
			}),
		)

		return updatedEntry
	})
}

export interface DeleteTaskOrganizationAclParams {
	aclEntryId: string
	deletedBy: string
}

/**
 * Delete a task organization ACL entry with automatic operations logging.
 */
export function deleteTaskOrganizationAcl(tx: PostgresTransaction, params: DeleteTaskOrganizationAclParams) {
	return Effect.gen(function* () {
		// Get the existing ACL entry before deleting
		const [existingEntry] = yield* tx.query(
			tx.client.select().from(taskOrganizationAcl).where(eq(taskOrganizationAcl.id, params.aclEntryId)).limit(1),
		)

		if (!existingEntry) {
			return yield* Effect.fail(new Error('ACL entry not found'))
		}

		const oldPermissionLevel = existingEntry.permission_level

		// Delete the ACL entry
		yield* tx.query(tx.client.delete(taskOrganizationAcl).where(eq(taskOrganizationAcl.id, params.aclEntryId)))

		// Log the operation
		yield* tx.query(
			tx.client.insert(aclOperationsLog).values({
				acl_type: 'task_organization_acl',
				acl_entry_id: params.aclEntryId,
				task_id: existingEntry.task_id,
				organization_id: existingEntry.organization_id,
				target_user_id: null,
				target_organization_id: existingEntry.organization_id,
				operation: 'delete',
				performed_by: params.deletedBy,
				permission_level_before: oldPermissionLevel,
				permission_level_after: null,
				resource_owner_user_id: existingEntry.resource_owner_user_id,
			}),
		)

		return existingEntry
	})
}
