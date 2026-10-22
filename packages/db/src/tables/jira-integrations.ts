import { sql } from 'drizzle-orm'
import { bigint, boolean, index, pgTable, text, uuid } from 'drizzle-orm/pg-core'
import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-zod'
import { uuidv7 } from 'uuidv7'

import { organizations } from './organizations'

export const jiraIntegrations = pgTable(
	'jira_integrations',
	{
		id: uuid()
			.primaryKey()
			.default(sql`uuidv7()`)
			.$defaultFn(() => uuidv7()),
		organization_id: uuid()
			.references(() => organizations.id, { onDelete: 'cascade' })
			.notNull()
			.unique(),
		cloud_id: text('cloud_id').notNull(),
		site_url: text('site_url').notNull(),
		access_token: text('access_token').notNull(),
		refresh_token: text('refresh_token').notNull(),
		token_expires_at: bigint('token_expires_at', { mode: 'bigint' }).notNull(),
		scopes: text('scopes').notNull(),
		connected_by: text('connected_by').notNull(),
		needs_reauth: boolean('needs_reauth').notNull().default(false),
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
	(t) => [index('jira_integrations_organization_id_index').on(t.organization_id)],
)

export const jiraIntegrationSelectSchema = createSelectSchema(jiraIntegrations)
export const jiraIntegrationInsertSchema = createInsertSchema(jiraIntegrations)
export const jiraIntegrationUpdateSchema = createUpdateSchema(jiraIntegrations)
export type JiraIntegration = typeof jiraIntegrations.$inferSelect
export type NewJiraIntegration = typeof jiraIntegrations.$inferInsert
