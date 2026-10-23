import { sql } from 'drizzle-orm'
import { bigint, boolean, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core'
import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-zod'
import { uuidv7 } from 'uuidv7'

import { organizations } from './organizations'
import { tasks } from './tasks'

export const taskUserSettings = pgTable(
	'task_user_settings',
	{
		id: uuid()
			.primaryKey()
			.default(sql`uuidv7()`)
			.$defaultFn(() => uuidv7()),

		task_id: uuid('task_id')
			.references(() => tasks.id, { onDelete: 'cascade' })
			.notNull(),

		user_id: text('user_id').notNull(),

		organization_id: uuid('organization_id')
			.references(() => organizations.id, { onDelete: 'cascade' })
			.notNull(),

		working_directory: text('working_directory'),

		host_id: text('host_id'),

		/** Expanded local workspace root on this user's machine, e.g. /Users/bob/.humanlayer/workspaces/<slug> */
		workspace_base_directory: text('workspace_base_directory'),

		/** When this user materialized the task's worktrees locally (ms epoch). NULL = not set up. */
		workspace_materialized_at: bigint('workspace_materialized_at', { mode: 'bigint' }),

		auto_advance_questions_to_research: boolean('auto_advance_questions_to_research').default(true).notNull(),

		auto_advance_research_to_design: boolean('auto_advance_research_to_design').default(false).notNull(),
		auto_advance_plan_to_worktree: boolean('auto_advance_plan_to_worktree').default(false).notNull(),
		auto_advance_worktree_to_implementation: boolean('auto_advance_worktree_to_implementation')
			.default(false)
			.notNull(),
		auto_advance_implementation_to_pr: boolean('auto_advance_implementation_to_pr').default(false).notNull(),

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
	(t) => [unique('task_user_settings_unique').on(t.organization_id, t.user_id, t.task_id)],
)

export const taskUserSettingsSelectSchema = createSelectSchema(taskUserSettings)
export const taskUserSettingsInsertSchema = createInsertSchema(taskUserSettings)
export const taskUserSettingsUpdateSchema = createUpdateSchema(taskUserSettings)
export type TaskUserSettings = typeof taskUserSettings.$inferSelect
export type NewTaskUserSettings = typeof taskUserSettings.$inferInsert
