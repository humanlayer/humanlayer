import { pgTable, text, unique, uuid } from 'drizzle-orm/pg-core'
import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-zod'

import { organizations } from './organizations'

export const hostAliases = pgTable(
	'host_aliases',
	{
		host_id: text().notNull(),
		user_id: text().notNull(),
		organization_id: uuid()
			.references(() => organizations.id, { onDelete: 'cascade' })
			.notNull(),
		display_name: text().notNull(),
	},
	(t) => [unique('host_aliases_unique').on(t.host_id, t.user_id, t.organization_id)],
)

export const hostAliasSelectSchema = createSelectSchema(hostAliases)
export const hostAliasInsertSchema = createInsertSchema(hostAliases)
export const hostAliasUpdateSchema = createUpdateSchema(hostAliases)
export type HostAlias = typeof hostAliases.$inferSelect
export type NewHostAlias = typeof hostAliases.$inferInsert
