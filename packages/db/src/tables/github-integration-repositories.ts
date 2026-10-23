import { sql } from 'drizzle-orm'
import { bigint, boolean, index, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-zod'
import { uuidv7 } from 'uuidv7'

import { githubIntegrations } from './github-integrations'

export const githubIntegrationRepositories = pgTable(
	'github_integration_repositories',
	{
		id: uuid()
			.primaryKey()
			.default(sql`uuidv7()`)
			.$defaultFn(() => uuidv7()),
		integration_id: uuid()
			.references(() => githubIntegrations.id, { onDelete: 'cascade' })
			.notNull(),
		github_repository_id: text('github_repository_id').notNull(),
		owner_login: text('owner_login').notNull(),
		repository_name: text('repository_name').notNull(),
		full_name: text('full_name').notNull(),
		private: boolean('private').notNull(),
		default_branch: text('default_branch').notNull(),
		archived: boolean('archived').notNull().default(false),
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
		uniqueIndex('github_repositories_integration_repository_unique').on(
			table.integration_id,
			table.github_repository_id,
		),
		uniqueIndex('github_repositories_integration_full_name_unique').on(table.integration_id, table.full_name),
		// `full_name` is stored mixed-case as GitHub returns it, while every `repo_full_name`
		// elsewhere is lowercased, so this index goes through `lower()`.
		index('github_repositories_full_name_lower_idx').on(sql`lower(${table.full_name})`),
	],
)

export const githubIntegrationRepositorySelectSchema = createSelectSchema(githubIntegrationRepositories)
export const githubIntegrationRepositoryInsertSchema = createInsertSchema(githubIntegrationRepositories)
export const githubIntegrationRepositoryUpdateSchema = createUpdateSchema(githubIntegrationRepositories)
export type GitHubIntegrationRepository = typeof githubIntegrationRepositories.$inferSelect
