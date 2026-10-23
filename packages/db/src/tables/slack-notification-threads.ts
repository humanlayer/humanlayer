import { sql } from 'drizzle-orm'
import { bigint, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core'
import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-zod'
import { uuidv7 } from 'uuidv7'

import { organizations } from './organizations'
import { slackNotificationAutomations } from './slack-notification-automations'

export type SlackNotificationThreadStatus = 'pending' | 'ready' | 'failed'

export const slackNotificationThreads = pgTable(
	'slack_notification_threads',
	{
		id: uuid()
			.primaryKey()
			.default(sql`uuidv7()`)
			.$defaultFn(() => uuidv7()),
		organization_id: uuid()
			.references(() => organizations.id, { onDelete: 'cascade' })
			.notNull(),
		automation_id: uuid()
			.references(() => slackNotificationAutomations.id, { onDelete: 'cascade' })
			.notNull(),
		task_id: uuid('task_id').notNull(),
		channel_id: text('channel_id').notNull(),
		root_thread_ts: text('root_thread_ts'),
		root_message_ts: text('root_message_ts'),
		status: text('status').$type<SlackNotificationThreadStatus>().notNull().default('pending'),
		last_error_code: text('last_error_code'),
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
		unique('slack_notification_threads_automation_channel_task_unique').on(
			table.automation_id,
			table.channel_id,
			table.task_id,
		),
	],
)

export const slackNotificationThreadSelectSchema = createSelectSchema(slackNotificationThreads)
export const slackNotificationThreadInsertSchema = createInsertSchema(slackNotificationThreads)
export const slackNotificationThreadUpdateSchema = createUpdateSchema(slackNotificationThreads)
export type SlackNotificationThread = typeof slackNotificationThreads.$inferSelect
export type NewSlackNotificationThread = typeof slackNotificationThreads.$inferInsert
