import { sql } from 'drizzle-orm'
import { bigint, index, integer, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core'
import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-zod'
import { uuidv7 } from 'uuidv7'

import { conversationEvents } from './conversation-events'
import { organizations } from './organizations'
import { sessions } from './sessions'
import { tasks } from './tasks'

export const codelayerAgentStateSnapshots = pgTable(
	'codelayer_agent_state_snapshots',
	{
		id: uuid('id')
			.primaryKey()
			.default(sql`uuidv7()`)
			.$defaultFn(() => uuidv7()),

		session_id: uuid('session_id')
			.notNull()
			.references(() => sessions.id, { onDelete: 'cascade' }),

		organization_id: uuid('organization_id')
			.notNull()
			.references(() => organizations.id, { onDelete: 'cascade' }),

		resource_owner_user_id: text('resource_owner_user_id').notNull(),

		task_id: uuid('task_id').references(() => tasks.id, { onDelete: 'set null' }),

		run_index: integer('run_index').notNull(),

		root_user_event_id: uuid('root_user_event_id').references(() => conversationEvents.id, {
			onDelete: 'set null',
		}),

		copied_from_snapshot_id: uuid('copied_from_snapshot_id'),

		state: jsonb('state'),

		tombstoned_at: bigint('tombstoned_at', { mode: 'bigint' }),

		tombstone_reason: text('tombstone_reason'),

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
	(table) => [
		index('codelayer_agent_state_snapshots_org_owner_session_idx').on(
			table.organization_id,
			table.resource_owner_user_id,
			table.session_id,
		),
		index('codelayer_agent_state_snapshots_session_run_idx').on(table.session_id, table.run_index),
	],
)

export const codelayerAgentStateSnapshotSelectSchema = createSelectSchema(codelayerAgentStateSnapshots)
export const codelayerAgentStateSnapshotInsertSchema = createInsertSchema(codelayerAgentStateSnapshots)
export const codelayerAgentStateSnapshotUpdateSchema = createUpdateSchema(codelayerAgentStateSnapshots)
export type CodelayerAgentStateSnapshot = typeof codelayerAgentStateSnapshots.$inferSelect
export type NewCodelayerAgentStateSnapshot = typeof codelayerAgentStateSnapshots.$inferInsert
