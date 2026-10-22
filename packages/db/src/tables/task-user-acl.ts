import { sql } from 'drizzle-orm'
import { bigint, index, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core'
import { createInsertSchema, createSelectSchema } from 'drizzle-zod'
import { uuidv7 } from 'uuidv7'

import { organizations } from './organizations'
import { tasks } from './tasks'

export type AclPermissionLevel = 'read' | 'edit' | 'comment'

export const taskUserAcl = pgTable(
	'task_user_acl',
	{
		id: uuid()
			.primaryKey()
			.default(sql`uuidv7()`)
			.$defaultFn(() => uuidv7()),

		task_id: uuid('task_id')
			.references(() => tasks.id, { onDelete: 'cascade' })
			.notNull(),

		subject_user_id: text('subject_user_id').notNull(),

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
		unique('task_user_acl_unique').on(t.organization_id, t.subject_user_id, t.task_id),
		index('task_user_acl_org_resource_owner_idx').on(t.organization_id, t.resource_owner_user_id),
	],
)

export const taskUserAclSelectSchema = createSelectSchema(taskUserAcl)
export const taskUserAclInsertSchema = createInsertSchema(taskUserAcl)
export type TaskUserAcl = typeof taskUserAcl.$inferSelect
export type NewTaskUserAcl = typeof taskUserAcl.$inferInsert
