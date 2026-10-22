import { sql } from 'drizzle-orm'
import { bigint, check, index, pgTable, text, uuid } from 'drizzle-orm/pg-core'
import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-zod'
import { uuidv7 } from 'uuidv7'
import z from 'zod/v4'

import { organizations } from './organizations'

export const ProviderLoginProviderSchema = z.enum(['claude', 'codex', 'xai'])
export type ProviderLoginProvider = z.infer<typeof ProviderLoginProviderSchema>

export const ProviderLoginMethodSchema = z.enum(['browser', 'device'])
export type ProviderLoginMethod = z.infer<typeof ProviderLoginMethodSchema>

export const ProviderLoginStatusSchema = z.enum(['requested', 'awaiting_approval', 'succeeded', 'failed', 'cancelled'])
export type ProviderLoginStatus = z.infer<typeof ProviderLoginStatusSchema>

export const providerLoginRequests = pgTable(
	'provider_login_requests',
	{
		id: uuid()
			.primaryKey()
			.default(sql`uuidv7()`)
			.$defaultFn(() => uuidv7()),
		organization_id: uuid('organization_id')
			.references(() => organizations.id, { onDelete: 'cascade' })
			.notNull(),
		user_id: text('user_id').notNull(),
		host_id: text('host_id').notNull(),
		provider: text('provider').$type<ProviderLoginProvider>().notNull(),
		method: text('method').$type<ProviderLoginMethod>().default('device').notNull(),
		status: text('status').$type<ProviderLoginStatus>().default('requested').notNull(),
		url: text('url'),
		user_code: text('user_code'),
		submitted_code: text('submitted_code'),
		error: text('error'),
		account_label: text('account_label'),
		expires_at: bigint('expires_at', { mode: 'bigint' }).notNull(),
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
		check('provider_login_requests_provider_check', sql`${t.provider} in ('claude', 'codex', 'xai')`),
		check('provider_login_requests_method_check', sql`${t.method} in ('browser', 'device')`),
		check(
			'provider_login_requests_status_check',
			sql`${t.status} in ('requested', 'awaiting_approval', 'succeeded', 'failed', 'cancelled')`,
		),
		// Daemon sync filters by organization_id + host_id; the UI lists by organization_id + user_id.
		index('provider_login_requests_org_host_idx').on(t.organization_id, t.host_id),
		index('provider_login_requests_org_user_idx').on(t.organization_id, t.user_id),
	],
)

export const providerLoginRequestSelectSchema = createSelectSchema(providerLoginRequests, {
	provider: ProviderLoginProviderSchema,
	method: ProviderLoginMethodSchema,
	status: ProviderLoginStatusSchema,
})
export const providerLoginRequestInsertSchema = createInsertSchema(providerLoginRequests, {
	provider: ProviderLoginProviderSchema,
	method: ProviderLoginMethodSchema.optional(),
	status: ProviderLoginStatusSchema.optional(),
})
export const providerLoginRequestUpdateSchema = createUpdateSchema(providerLoginRequests, {
	provider: ProviderLoginProviderSchema.optional(),
	method: ProviderLoginMethodSchema.optional(),
	status: ProviderLoginStatusSchema.optional(),
})
export type ProviderLoginRequest = typeof providerLoginRequests.$inferSelect
export type NewProviderLoginRequest = typeof providerLoginRequests.$inferInsert
