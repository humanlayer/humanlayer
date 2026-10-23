import { sql } from 'drizzle-orm'
import { bigint, pgTable, text, uuid } from 'drizzle-orm/pg-core'
import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-zod'
import { uuidv7 } from 'uuidv7'

import { organizations } from './organizations'

export const slackIntegrationInstallStates = pgTable('slack_integration_install_states', {
	id: uuid()
		.primaryKey()
		.default(sql`uuidv7()`)
		.$defaultFn(() => uuidv7()),
	state_token_hash: text('state_token_hash').notNull().unique(),
	organization_id: uuid()
		.references(() => organizations.id, { onDelete: 'cascade' })
		.notNull(),
	requested_by_user_id: text('requested_by_user_id').notNull(),
	expires_at: bigint('expires_at', { mode: 'bigint' }).notNull(),
	consumed_at: bigint('consumed_at', { mode: 'bigint' }),
	created_at: bigint('created_at', { mode: 'bigint' })
		.notNull()
		.default(sql`(extract(epoch from now()) * 1000)::bigint`)
		.$defaultFn(() => BigInt(Date.now())),
})

export const slackIntegrationInstallStateSelectSchema = createSelectSchema(slackIntegrationInstallStates)
export const slackIntegrationInstallStateInsertSchema = createInsertSchema(slackIntegrationInstallStates)
export const slackIntegrationInstallStateUpdateSchema = createUpdateSchema(slackIntegrationInstallStates)
export type SlackIntegrationInstallState = typeof slackIntegrationInstallStates.$inferSelect
