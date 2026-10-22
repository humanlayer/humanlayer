import { sql } from 'drizzle-orm'
import { bigint, index, pgTable, text, uuid } from 'drizzle-orm/pg-core'
import { createInsertSchema, createSelectSchema } from 'drizzle-zod'
import { uuidv7 } from 'uuidv7'

import type { AclPermissionLevel } from './task-user-acl'

export type AclOperationType = 'create' | 'read' | 'update' | 'delete'
export type AclType = 'task_user_acl' | 'task_organization_acl'

export const aclOperationsLog = pgTable(
	'acl_operations_log',
	{
		id: uuid()
			.primaryKey()
			.default(sql`uuidv7()`)
			.$defaultFn(() => uuidv7()),

		acl_type: text('acl_type').notNull().$type<AclType>(),

		acl_entry_id: uuid('acl_entry_id').notNull(),

		task_id: uuid('task_id').notNull(),

		organization_id: uuid('organization_id').notNull(),

		target_user_id: text('target_user_id'),

		target_organization_id: uuid('target_organization_id'),

		operation: text('operation').notNull().$type<AclOperationType>(),

		performed_by: text('performed_by').notNull(),

		permission_level_before: text('permission_level_before').$type<AclPermissionLevel | null>(),

		permission_level_after: text('permission_level_after').$type<AclPermissionLevel | null>(),

		resource_owner_user_id: text('resource_owner_user_id').notNull(),

		created_at: bigint('created_at', { mode: 'bigint' })
			.notNull()
			.default(sql`(extract(epoch from now()) * 1000)::bigint`)
			.$defaultFn(() => BigInt(Date.now())),
	},
	(t) => [
		index('acl_operations_log_task_id_idx').on(t.task_id),
		index('acl_operations_log_performed_by_idx').on(t.performed_by),
	],
)

export const aclOperationsLogSelectSchema = createSelectSchema(aclOperationsLog)
export const aclOperationsLogInsertSchema = createInsertSchema(aclOperationsLog)
export type AclOperationLog = typeof aclOperationsLog.$inferSelect
export type NewAclOperationLog = typeof aclOperationsLog.$inferInsert
