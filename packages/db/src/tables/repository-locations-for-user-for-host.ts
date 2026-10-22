import type { WorkspaceRepositorySourceKind } from '@humanlayer/schemas/effect/project-workspace'
import {
	NormalizedRepositoryIdentitySchema,
	WorkspaceRepositorySourceKindSchema,
} from '@humanlayer/schemas/zod/project-workspace'
import { sql } from 'drizzle-orm'
import { bigint, check, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core'
import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-zod'

import { organizations } from './organizations'

export const repositoryLocationsForUserForHost = pgTable(
	'repository_locations_for_user_for_host',
	{
		organization_id: uuid()
			.references(() => organizations.id, { onDelete: 'cascade' })
			.notNull(),
		user_id: text().notNull(),
		host_id: text().notNull(),
		repository_identity: text().notNull(),
		source_path: text(),
		source_kind: text().$type<WorkspaceRepositorySourceKind>().notNull(),
		created_at: bigint({ mode: 'bigint' })
			.notNull()
			.default(sql`(extract(epoch from now()) * 1000)::bigint`)
			.$defaultFn(() => BigInt(Date.now())),
		updated_at: bigint({ mode: 'bigint' })
			.notNull()
			.default(sql`(extract(epoch from now()) * 1000)::bigint`)
			.$defaultFn(() => BigInt(Date.now()))
			.$onUpdateFn(() => BigInt(Date.now())),
	},
	(t) => [
		primaryKey({
			name: 'repository_locations_for_user_for_host_pk',
			columns: [t.organization_id, t.user_id, t.host_id, t.repository_identity],
		}),
		check('repository_locations_source_kind_check', sql`${t.source_kind} in ('filesystem', 'managed_clone')`),
		check(
			'repository_locations_source_path_check',
			sql`(${t.source_kind} = 'filesystem' and ${t.source_path} is not null and length(${t.source_path}) > 0) or (${t.source_kind} = 'managed_clone' and ${t.source_path} is null)`,
		),
	],
)

export const repositoryLocationSelectSchema = createSelectSchema(repositoryLocationsForUserForHost, {
	repository_identity: NormalizedRepositoryIdentitySchema,
	source_kind: WorkspaceRepositorySourceKindSchema,
})
export const repositoryLocationInsertSchema = createInsertSchema(repositoryLocationsForUserForHost, {
	repository_identity: NormalizedRepositoryIdentitySchema,
	source_kind: WorkspaceRepositorySourceKindSchema,
})
export const repositoryLocationUpdateSchema = createUpdateSchema(repositoryLocationsForUserForHost, {
	repository_identity: NormalizedRepositoryIdentitySchema.optional(),
	source_kind: WorkspaceRepositorySourceKindSchema.optional(),
})
export type RepositoryLocationForUserForHost = typeof repositoryLocationsForUserForHost.$inferSelect
export type NewRepositoryLocationForUserForHost = typeof repositoryLocationsForUserForHost.$inferInsert
