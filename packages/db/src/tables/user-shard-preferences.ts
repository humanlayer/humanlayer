import { sql } from 'drizzle-orm'
import { bigint, index, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core'
import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-zod'
import { uuidv7 } from 'uuidv7'
import z from 'zod/v4'

import { contextShards } from './context-shards'
import { organizations } from './organizations'

export const UserShardStateSchema = z.enum(['enabled', 'disabled', 'dismissed'])
export type UserShardState = z.infer<typeof UserShardStateSchema>

/**
 * Sparse per-user state for a released organization context shard.
 * A missing row means the shard is off for that user.
 */
export const userShardPreferences = pgTable(
	'user_shard_preferences',
	{
		id: uuid()
			.primaryKey()
			.default(sql`uuidv7()`)
			.$defaultFn(() => uuidv7()),

		user_id: text('user_id').notNull(),

		organization_id: uuid('organization_id')
			.references(() => organizations.id, { onDelete: 'cascade' })
			.notNull(),

		shard_id: uuid('shard_id')
			.references(() => contextShards.id, { onDelete: 'cascade' })
			.notNull(),

		shard_state: text('shard_state').$type<UserShardState>().notNull(),

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
	(t) => [
		unique('user_shard_preferences_org_user_shard_unique').on(t.organization_id, t.user_id, t.shard_id),
		index('user_shard_preferences_shard_id_idx').on(t.shard_id),
	],
)

export const userShardPreferenceSelectSchema = createSelectSchema(userShardPreferences, {
	shard_state: UserShardStateSchema,
})
export const userShardPreferenceInsertSchema = createInsertSchema(userShardPreferences, {
	shard_state: UserShardStateSchema,
})
export const userShardPreferenceUpdateSchema = createUpdateSchema(userShardPreferences, {
	shard_state: UserShardStateSchema,
})
export type UserShardPreference = typeof userShardPreferences.$inferSelect
export type NewUserShardPreference = typeof userShardPreferences.$inferInsert
