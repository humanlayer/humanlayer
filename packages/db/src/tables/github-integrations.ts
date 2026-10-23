import { sql } from 'drizzle-orm'
import { bigint, boolean, check, index, jsonb, pgEnum, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-zod'
import { uuidv7 } from 'uuidv7'

import {
	GitHubInstallationPermissionsSchema,
	type GitHubInstallationPermissions,
} from '../zodschemas/github-installation-permissions'
import { organizations } from './organizations'

export const githubAccountType = pgEnum('github_account_type', ['Organization', 'User'])
export const githubRepositorySelection = pgEnum('github_repository_selection', ['all', 'selected'])
export const githubInstallationStatus = pgEnum('github_installation_status', ['active', 'unclaimed', 'suspended'])

export const githubIntegrations = pgTable(
	'github_integrations',
	{
		id: uuid()
			.primaryKey()
			.default(sql`uuidv7()`)
			.$defaultFn(() => uuidv7()),
		organization_id: uuid().references(() => organizations.id, { onDelete: 'cascade' }),
		installation_id: text('installation_id').notNull(),
		account_id: text('account_id').notNull(),
		account_login: text('account_login').notNull(),
		account_type: githubAccountType('account_type').notNull(),
		access_token: text('access_token'),
		token_expires_at: bigint('token_expires_at', { mode: 'bigint' }),
		token_generation: bigint('token_generation', { mode: 'number' }).notNull().default(0),
		repository_selection: githubRepositorySelection('repository_selection').notNull(),
		permissions: jsonb('permissions').notNull().$type<GitHubInstallationPermissions>(),
		installation_status: githubInstallationStatus('installation_status').notNull(),
		suspended_at: bigint('suspended_at', { mode: 'bigint' }),
		suspended_by_id: text('suspended_by_id'),
		suspended_by_login: text('suspended_by_login'),
		needs_reauth: boolean('needs_reauth').notNull().default(false),
		connected_by_user_id: text('connected_by_user_id'),
		last_reconciled_at: bigint('last_reconciled_at', { mode: 'bigint' }).notNull(),
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
		index('github_integrations_organization_id_index').on(table.organization_id),
		uniqueIndex('github_integrations_installation_id_unique').on(table.installation_id),
		check(
			'github_integrations_claim_fields_check',
			sql`(${table.installation_status} = 'unclaimed' AND ${table.organization_id} IS NULL AND ${table.connected_by_user_id} IS NULL) OR (${table.installation_status} = 'active' AND ${table.organization_id} IS NOT NULL AND ${table.connected_by_user_id} IS NOT NULL) OR (${table.installation_status} = 'suspended')`,
		),
	],
)

export const githubIntegrationSelectSchema = createSelectSchema(githubIntegrations, {
	permissions: GitHubInstallationPermissionsSchema,
})
export const githubIntegrationInsertSchema = createInsertSchema(githubIntegrations)
export const githubIntegrationUpdateSchema = createUpdateSchema(githubIntegrations)
export type GitHubIntegration = typeof githubIntegrations.$inferSelect
export type NewGitHubIntegration = typeof githubIntegrations.$inferInsert
export type GitHubAccountType = (typeof githubAccountType.enumValues)[number]
export type GitHubRepositorySelection = (typeof githubRepositorySelection.enumValues)[number]
export type GitHubInstallationStatus = (typeof githubInstallationStatus.enumValues)[number]
