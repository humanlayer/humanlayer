import { sql } from 'drizzle-orm'
import { bigint, boolean, pgTable, text, uuid } from 'drizzle-orm/pg-core'
import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-zod'
import { uuidv7 } from 'uuidv7'

import { organizations } from './organizations'

export const slackIntegrations = pgTable('slack_integrations', {
	id: uuid()
		.primaryKey()
		.default(sql`uuidv7()`)
		.$defaultFn(() => uuidv7()),
	organization_id: uuid()
		.references(() => organizations.id, { onDelete: 'cascade' })
		.notNull()
		.unique(),
	bot_access_token: text('bot_access_token').notNull(),
	bot_user_id: text('bot_user_id').notNull(),
	scopes: text('scopes').notNull(),
	slack_team_id: text('slack_team_id'),
	slack_team_name: text('slack_team_name'),
	app_id: text('app_id'),
	connected_by_user_id: text('connected_by_user_id').notNull(),
	needs_reauth: boolean('needs_reauth').notNull().default(false),
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
})

export const slackIntegrationSelectSchema = createSelectSchema(slackIntegrations)
export const slackIntegrationInsertSchema = createInsertSchema(slackIntegrations)
export const slackIntegrationUpdateSchema = createUpdateSchema(slackIntegrations)
export type SlackIntegration = typeof slackIntegrations.$inferSelect
export type NewSlackIntegration = typeof slackIntegrations.$inferInsert
