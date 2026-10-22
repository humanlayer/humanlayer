import { sql } from 'drizzle-orm'
import { bigint, boolean, index, pgTable, text, uuid } from 'drizzle-orm/pg-core'
import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-zod'
import { uuidv7 } from 'uuidv7'
import z from 'zod/v4'

import { organizations } from './organizations'
import { sessions } from './sessions'
import { tasks } from './tasks'

export const queuedMessages = pgTable(
	'queued_messages',
	{
		id: uuid()
			.primaryKey()
			.default(sql`uuidv7()`)
			.$defaultFn(() => uuidv7()),
		session_id: uuid('session_id')
			.references(() => sessions.id, { onDelete: 'cascade' })
			.notNull(),
		task_id: uuid('task_id').references(() => tasks.id, { onDelete: 'set null' }),
		organization_id: uuid('organization_id')
			.references(() => organizations.id, { onDelete: 'cascade' })
			.notNull(),
		resource_owner_user_id: text('resource_owner_user_id').notNull(),
		user_id: text('user_id'),
		author_display_name: text('author_display_name'),
		multiplayer_prompting_active: boolean('multiplayer_prompting_active'),
		content: text('content').notNull(),
		status: text('status').notNull().$type<'pending' | 'delivered'>().default('pending'),
		deliver_on_interrupt: boolean('deliver_on_interrupt').notNull().default(false),
		created_at: bigint('created_at', { mode: 'bigint' })
			.notNull()
			.default(sql`(extract(epoch from now()) * 1000)::bigint`)
			.$defaultFn(() => BigInt(Date.now())),
		updated_at: bigint('updated_at', { mode: 'bigint' })
			.notNull()
			.default(sql`(extract(epoch from now()) * 1000)::bigint`)
			.$defaultFn(() => BigInt(Date.now()))
			.$onUpdateFn(() => BigInt(Date.now())),
	},
	(t) => [
		index('queued_messages_session_status_created_at_idx').on(t.session_id, t.status, t.created_at),
		index('queued_messages_org_owner_session_idx').on(t.organization_id, t.resource_owner_user_id, t.session_id),
		index('queued_messages_org_task_session_idx').on(t.organization_id, t.task_id, t.session_id),
	],
)

export const queuedMessageSelectSchema = createSelectSchema(queuedMessages, {
	created_at: z.preprocess((v) => (typeof v === 'string' ? BigInt(v) : v), z.bigint()),
	updated_at: z.preprocess((v) => (typeof v === 'string' ? BigInt(v) : v), z.bigint()),
})

export const queuedMessageInsertSchema = createInsertSchema(queuedMessages)
export const queuedMessageUpdateSchema = createUpdateSchema(queuedMessages)

export type QueuedMessage = typeof queuedMessages.$inferSelect
export type QueuedMessageInsert = typeof queuedMessages.$inferInsert
