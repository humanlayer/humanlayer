import { sql } from 'drizzle-orm'
import { bigint, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core'

import { sessions } from './sessions'
import { tasks } from './tasks'

/**
 * The immutable result of a task launch. The task row cannot identify its
 * original session once later sessions have been created, so replay reads this
 * record instead of inferring an earliest session.
 */
export const taskLaunches = pgTable(
	'task_launches',
	{
		task_id: uuid('task_id')
			.primaryKey()
			.references(() => tasks.id, { onDelete: 'cascade' }),
		first_session_id: uuid('first_session_id')
			.notNull()
			.references(() => sessions.id),
		launch_transaction_id: text('launch_transaction_id').notNull(),
		created_at: bigint('created_at', { mode: 'bigint' })
			.notNull()
			.default(sql`(extract(epoch from now()) * 1000)::bigint`)
			.$defaultFn(() => BigInt(Date.now())),
	},
	(table) => [unique('task_launches_first_session_id_unique').on(table.first_session_id)],
)

export type TaskLaunch = typeof taskLaunches.$inferSelect
export type NewTaskLaunch = typeof taskLaunches.$inferInsert
