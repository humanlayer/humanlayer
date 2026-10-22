import { aclOperationsLog } from '@humanlayer/db/tables/acl-operations-log'
import { taskOrganizationAcl } from '@humanlayer/db/tables/task-organization-acl'
import { type AclPermissionLevel, taskUserAcl } from '@humanlayer/db/tables/task-user-acl'
import { eq } from 'drizzle-orm'
import type { PgDatabase } from 'drizzle-orm/pg-core'
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js'

/**
 * Discriminated union for database or transaction context.
 * Use { type: 'db', db } when you want these operations to create their own transaction.
 * Use { type: 'tx', tx } when you want to run within an existing transaction.
 */
export type DbOrTx =
	| { type: 'db'; db: PgDatabase<PostgresJsQueryResultHKT> }
	| { type: 'tx'; tx: PgDatabase<PostgresJsQueryResultHKT> }

/**
 * Helper to execute operations in a transaction context.
 * If given a db, creates a new transaction.
 * If given a tx, uses it directly.
 */
async function withTransaction<T>(
	dbOrTx: DbOrTx,
	fn: (tx: PgDatabase<PostgresJsQueryResultHKT>) => Promise<T>,
): Promise<T> {
	if (dbOrTx.type === 'tx') {
		return fn(dbOrTx.tx)
	}
	return dbOrTx.db.transaction(fn)
}

/**
 * Create a task user ACL entry with automatic operations logging
 */
export async function createTaskUserAcl(
	dbOrTx: DbOrTx,
	params: {
		organizationId: string
		subjectUserId: string
		taskId: string
		resourceOwnerUserId: string
		permissionLevel: AclPermissionLevel
		grantedBy: string
	},
) {
	return await withTransaction(dbOrTx, async (tx) => {
		// Create the ACL entry
		const [aclEntry] = await tx
			.insert(taskUserAcl)
			.values({
				organization_id: params.organizationId,
				subject_user_id: params.subjectUserId,
				task_id: params.taskId,
				resource_owner_user_id: params.resourceOwnerUserId,
				permission_level: params.permissionLevel,
				granted_by: params.grantedBy,
			})
			.returning()

		if (!aclEntry) {
			throw new Error('Failed to create task user ACL entry')
		}

		// Log the operation
		await tx.insert(aclOperationsLog).values({
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
		})

		return aclEntry
	})
}

/**
 * Update a task user ACL entry with automatic operations logging
 */
export async function updateTaskUserAcl(
	dbOrTx: DbOrTx,
	params: {
		aclEntryId: string
		newPermissionLevel: AclPermissionLevel
		updatedBy: string
	},
) {
	return await withTransaction(dbOrTx, async (tx) => {
		// Get the existing ACL entry
		const [existingEntry] = await tx
			.select()
			.from(taskUserAcl)
			.where(eq(taskUserAcl.id, params.aclEntryId))
			.limit(1)

		if (!existingEntry) {
			throw new Error('ACL entry not found')
		}

		const oldPermissionLevel = existingEntry.permission_level

		// Update the ACL entry
		const [updatedEntry] = await tx
			.update(taskUserAcl)
			.set({ permission_level: params.newPermissionLevel })
			.where(eq(taskUserAcl.id, params.aclEntryId))
			.returning()

		if (!updatedEntry) {
			throw new Error('Failed to update task user ACL entry')
		}

		// Log the operation
		await tx.insert(aclOperationsLog).values({
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
		})

		return updatedEntry
	})
}

/**
 * Delete a task user ACL entry with automatic operations logging
 */
export async function deleteTaskUserAcl(
	dbOrTx: DbOrTx,
	params: {
		aclEntryId: string
		deletedBy: string
	},
) {
	return await withTransaction(dbOrTx, async (tx) => {
		// Get the existing ACL entry before deleting
		const [existingEntry] = await tx
			.select()
			.from(taskUserAcl)
			.where(eq(taskUserAcl.id, params.aclEntryId))
			.limit(1)

		if (!existingEntry) {
			throw new Error('ACL entry not found')
		}

		const oldPermissionLevel = existingEntry.permission_level

		// Delete the ACL entry
		await tx.delete(taskUserAcl).where(eq(taskUserAcl.id, params.aclEntryId))

		// Log the operation
		await tx.insert(aclOperationsLog).values({
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
		})

		return existingEntry
	})
}

/**
 * Create a task organization ACL entry with automatic operations logging
 */
export async function createTaskOrganizationAcl(
	dbOrTx: DbOrTx,
	params: {
		organizationId: string
		taskId: string
		resourceOwnerUserId: string
		permissionLevel: AclPermissionLevel
		grantedBy: string
	},
) {
	return await withTransaction(dbOrTx, async (tx) => {
		// Create the ACL entry
		const [aclEntry] = await tx
			.insert(taskOrganizationAcl)
			.values({
				organization_id: params.organizationId,
				task_id: params.taskId,
				resource_owner_user_id: params.resourceOwnerUserId,
				permission_level: params.permissionLevel,
				granted_by: params.grantedBy,
			})
			.returning()

		if (!aclEntry) {
			throw new Error('Failed to create task organization ACL entry')
		}

		// Log the operation
		await tx.insert(aclOperationsLog).values({
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
		})

		return aclEntry
	})
}

/**
 * Update a task organization ACL entry with automatic operations logging
 */
export async function updateTaskOrganizationAcl(
	dbOrTx: DbOrTx,
	params: {
		aclEntryId: string
		newPermissionLevel: AclPermissionLevel
		updatedBy: string
	},
) {
	return await withTransaction(dbOrTx, async (tx) => {
		// Get the existing ACL entry
		const [existingEntry] = await tx
			.select()
			.from(taskOrganizationAcl)
			.where(eq(taskOrganizationAcl.id, params.aclEntryId))
			.limit(1)

		if (!existingEntry) {
			throw new Error('ACL entry not found')
		}

		const oldPermissionLevel = existingEntry.permission_level

		// Update the ACL entry
		const [updatedEntry] = await tx
			.update(taskOrganizationAcl)
			.set({ permission_level: params.newPermissionLevel })
			.where(eq(taskOrganizationAcl.id, params.aclEntryId))
			.returning()

		if (!updatedEntry) {
			throw new Error('Failed to update task organization ACL entry')
		}

		// Log the operation
		await tx.insert(aclOperationsLog).values({
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
		})

		return updatedEntry
	})
}

/**
 * Delete a task organization ACL entry with automatic operations logging
 */
export async function deleteTaskOrganizationAcl(
	dbOrTx: DbOrTx,
	params: {
		aclEntryId: string
		deletedBy: string
	},
) {
	return await withTransaction(dbOrTx, async (tx) => {
		// Get the existing ACL entry before deleting
		const [existingEntry] = await tx
			.select()
			.from(taskOrganizationAcl)
			.where(eq(taskOrganizationAcl.id, params.aclEntryId))
			.limit(1)

		if (!existingEntry) {
			throw new Error('ACL entry not found')
		}

		const oldPermissionLevel = existingEntry.permission_level

		// Delete the ACL entry
		await tx.delete(taskOrganizationAcl).where(eq(taskOrganizationAcl.id, params.aclEntryId))

		// Log the operation
		await tx.insert(aclOperationsLog).values({
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
		})

		return existingEntry
	})
}
