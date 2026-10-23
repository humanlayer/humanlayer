import { sql } from 'drizzle-orm'
import { bigint, boolean, index, pgTable, text, uuid } from 'drizzle-orm/pg-core'
import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-zod'
import { uuidv7 } from 'uuidv7'

import { organizations } from './organizations'

export const slackNotificationAutomations = pgTable(
	'slack_notification_automations',
	{
		id: uuid()
			.primaryKey()
			.default(sql`uuidv7()`)
			.$defaultFn(() => uuidv7()),
		organization_id: uuid()
			.references(() => organizations.id, { onDelete: 'cascade' })
			.notNull(),
		name: text('name').notNull(),
		channel_id: text('channel_id').notNull(),
		channel_name: text('channel_name'),
		channel_is_private: boolean('channel_is_private').notNull().default(false),
		event_types: text('event_types').array().notNull(),
		owner_user_ids: text('owner_user_ids').array(),
		enabled: boolean('enabled').notNull().default(true),
		created_by_user_id: text('created_by_user_id').notNull(),
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
	(table) => [index('slack_notification_automations_org_idx').on(table.organization_id)],
)

export const slackNotificationAutomationSelectSchema = createSelectSchema(slackNotificationAutomations)
export const slackNotificationAutomationInsertSchema = createInsertSchema(slackNotificationAutomations)
export const slackNotificationAutomationUpdateSchema = createUpdateSchema(slackNotificationAutomations)
export type SlackNotificationAutomation = typeof slackNotificationAutomations.$inferSelect
export type NewSlackNotificationAutomation = typeof slackNotificationAutomations.$inferInsert
