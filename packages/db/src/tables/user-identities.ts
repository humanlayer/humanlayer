import { sql } from 'drizzle-orm'
import { bigint, index, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-zod'
import { uuidv7 } from 'uuidv7'

import { organizations } from './organizations'

export type UserIdentityProvider = 'github'
export type UserIdentitySource = 'daemon_gh_cli' | 'admin_manual' | 'oauth'

/**
 * Provider-keyed external identity for a WorkOS user, e.g. their GitHub account.
 *
 * New table, not `user_settings` columns: (a) `user_settings` is user-editable via the
 * settings-update endpoint — identity there would be spoofable merged-PR credit; (b) a
 * provider-keyed table supports the Phase 2 admin manual-merge UI and future providers;
 * (c) provenance per identity row.
 */
export const userIdentities = pgTable(
	'user_identities',
	{
		id: uuid()
			.primaryKey()
			.default(sql`uuidv7()`)
			.$defaultFn(() => uuidv7()),
		organization_id: uuid()
			.references(() => organizations.id, { onDelete: 'cascade' })
			.notNull(),
		user_id: text('user_id').notNull(), // WorkOS user id
		provider: text('provider').$type<UserIdentityProvider>().notNull(),
		external_id: text('external_id').notNull(), // GitHub numeric id as text — stable across renames
		external_login: text('external_login').notNull(), // mutable display login
		email: text('email'), // from `gh api user`
		source: text('source').$type<UserIdentitySource>().notNull(),
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
		// One GitHub identity per user per org — upsert target
		uniqueIndex('user_identities_org_provider_user_idx').on(t.organization_id, t.provider, t.user_id),
		// Metrics join from `pull_requests.author_github_login`
		index('user_identities_org_provider_login_idx').on(t.organization_id, t.provider, t.external_login),
	],
)

export const userIdentitySelectSchema = createSelectSchema(userIdentities)
export const userIdentityInsertSchema = createInsertSchema(userIdentities)
export const userIdentityUpdateSchema = createUpdateSchema(userIdentities)
export type UserIdentity = typeof userIdentities.$inferSelect
export type NewUserIdentity = typeof userIdentities.$inferInsert
