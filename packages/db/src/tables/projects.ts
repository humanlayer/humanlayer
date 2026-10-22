import type { ProjectRepositories } from '@humanlayer/schemas/effect/project-workspace'
import { ProjectRepositoriesSchema } from '@humanlayer/schemas/zod/project-workspace'
import { sql } from 'drizzle-orm'
import { bigint, boolean, index, jsonb, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core'
import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-zod'
import { uuidv7 } from 'uuidv7'

import { jsonbParser } from '../utils/jsonb-parser'
import { organizations } from './organizations'
import { teams } from './teams'

export const projects = pgTable(
	'project',
	{
		id: uuid()
			.primaryKey()
			.default(sql`uuidv7()`)
			.$defaultFn(() => uuidv7()),
		team_id: uuid().references(() => teams.id, { onDelete: 'cascade' }),
		organization_id: uuid()
			.references(() => organizations.id, { onDelete: 'cascade' })
			.notNull(),

		created_at: bigint('created_at', { mode: 'bigint' })
			.notNull()
			.default(sql`(extract(epoch from now()) * 1000)::bigint`)
			.$defaultFn(() => BigInt(Date.now())),
		/**
		 * Track the time the session was last updated
		 */
		updated_at: bigint('updated_at', { mode: 'bigint' })
			.notNull()
			.default(sql`(extract(epoch from now()) * 1000)::bigint`)
			.$defaultFn(() => BigInt(Date.now()))
			.$onUpdateFn(() => BigInt(Date.now())),

		name: text().notNull(),
		description: text(),
		private: boolean().notNull().default(false),
		created_by: text().notNull(),
		resource_owner_user_id: text().notNull(),
		repositories: jsonb().$type<ProjectRepositories>().notNull(),
		archived: boolean().notNull().default(false),
	},
	(t) => [
		index('projects_organization_id_index').on(t.organization_id),
		unique('projects_organization_id_id_unique').on(t.organization_id, t.id),
	],
)

export const projectSelectSchema = createSelectSchema(projects, {
	repositories: jsonbParser(ProjectRepositoriesSchema),
})
export const projectInsertSchema = createInsertSchema(projects, {
	repositories: ProjectRepositoriesSchema,
})
export const projectUpdateSchema = createUpdateSchema(projects, {
	repositories: ProjectRepositoriesSchema.optional(),
})
export type Project = typeof projects.$inferSelect
export type NewProject = typeof projects.$inferInsert
