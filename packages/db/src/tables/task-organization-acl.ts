import { sql } from 'drizzle-orm'
import { bigint, index, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core'
import { createInsertSchema, createSelectSchema } from 'drizzle-zod'
import { uuidv7 } from 'uuidv7'

import { organizations } from './organizations'
import type { AclPermissionLevel } from './task-user-acl'
import { tasks } from './tasks'

export const taskOrganizationAcl = pgTable(
	'task_organization_acl',
	{
		id: uuid()
			.primaryKey()
			.default(sql`uuidv7()`)
			.$defaultFn(() => uuidv7()),

		task_id: uuid('task_id')
			.references(() => tasks.id, { onDelete: 'cascade' })
			.notNull(),

		organization_id: uuid('organization_id')
			.references(() => organizations.id, { onDelete: 'cascade' })
			.notNull(),

		resource_owner_user_id: text('resource_owner_user_id').notNull(),

		permission_level: text('permission_level').notNull().$type<AclPermissionLevel>(),

		granted_by: text('granted_by').notNull(),

		created_at: bigint('created_at', { mode: 'bigint' })
			.notNull()
			.default(sql`(extract(epoch from now()) * 1000)::bigint`)
			.$defaultFn(() => BigInt(Date.now())),
	},
	(t) => [
		unique('task_organization_acl_unique').on(t.organization_id, t.task_id),
		index('task_org_acl_org_owner_idx').on(t.organization_id, t.resource_owner_user_id),
	],
)

export const taskOrganizationAclSelectSchema = createSelectSchema(taskOrganizationAcl)
export const taskOrganizationAclInsertSchema = createInsertSchema(taskOrganizationAcl)
export type TaskOrganizationAcl = typeof taskOrganizationAcl.$inferSelect
export type NewTaskOrganizationAcl = typeof taskOrganizationAcl.$inferInsert
