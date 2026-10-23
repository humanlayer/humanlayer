import { sql } from 'drizzle-orm'
import { bigint, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core'
import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-zod'
import { uuidv7 } from 'uuidv7'

import { organizations } from './organizations'
import { sessions } from './sessions'
import { tasks } from './tasks'

export const codelayerAgentState = pgTable('codelayer_agent_state', {
	id: uuid()
		.primaryKey()
		.default(sql`uuidv7()`)
		.$defaultFn(() => uuidv7()),

	session_id: uuid()
		.references(() => sessions.id, { onDelete: 'cascade' })
		.notNull()
		.unique(),

	organization_id: uuid()
		.references(() => organizations.id, { onDelete: 'cascade' })
		.notNull(),

	resource_owner_user_id: text('resource_owner_user_id').notNull(),

	task_id: uuid('task_id').references(() => tasks.id, { onDelete: 'set null' }),

	state: jsonb('state').notNull(),

	created_at: bigint('created_at', { mode: 'bigint' })
		.notNull()
		.default(sql`(extract(epoch from now()) * 1000)::bigint`)
		.$defaultFn(() => BigInt(Date.now())),

	updated_at: bigint('updated_at', { mode: 'bigint' })
		.notNull()
		.default(sql`(extract(epoch from now()) * 1000)::bigint`)
		.$defaultFn(() => BigInt(Date.now()))
		.$onUpdateFn(() => BigInt(Date.now())),
})

export const codelayerAgentStateSelectSchema = createSelectSchema(codelayerAgentState)
export const codelayerAgentStateInsertSchema = createInsertSchema(codelayerAgentState)
export const codelayerAgentStateUpdateSchema = createUpdateSchema(codelayerAgentState)
export type CodelayerAgentState = typeof codelayerAgentState.$inferSelect
export type NewCodelayerAgentState = typeof codelayerAgentState.$inferInsert
