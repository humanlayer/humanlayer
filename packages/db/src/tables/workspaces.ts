import type { WorkspaceRepositories } from '@humanlayer/schemas/effect/project-workspace'
import { WorkspaceRepositoriesSchema } from '@humanlayer/schemas/zod/project-workspace'
import { sql } from 'drizzle-orm'
import { bigint, boolean, index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core'
import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-zod'
import { uuidv7 } from 'uuidv7'

import { jsonbParser } from '../utils/jsonb-parser'
import { organizations } from './organizations'
import { projects } from './projects'

export const workspaces = pgTable(
	'workspaces',
	{
		id: uuid()
			.primaryKey()
			.default(sql`uuidv7()`)
			.$defaultFn(() => uuidv7()),
		organization_id: uuid()
			.references(() => organizations.id, { onDelete: 'cascade' })
			.notNull(),
		project_id: uuid()
			.references(() => projects.id, { onDelete: 'cascade' })
			.notNull(),
		name: text().notNull(),
		description: text(),
		created_by: text().notNull(),
		resource_owner_user_id: text().notNull(),
		repositories: jsonb().$type<WorkspaceRepositories>().notNull(),
		archived: boolean().notNull().default(false),
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
	(t) => [index('workspaces_org_owner_idx').on(t.organization_id, t.resource_owner_user_id)],
)

export const workspaceSelectSchema = createSelectSchema(workspaces, {
	repositories: jsonbParser(WorkspaceRepositoriesSchema),
})
export const workspaceInsertSchema = createInsertSchema(workspaces, {
	repositories: WorkspaceRepositoriesSchema,
})
export const workspaceUpdateSchema = createUpdateSchema(workspaces, {
	repositories: WorkspaceRepositoriesSchema.optional(),
})
export type Workspace = typeof workspaces.$inferSelect
export type NewWorkspace = typeof workspaces.$inferInsert
