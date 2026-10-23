import { sql } from 'drizzle-orm'
import { bigint, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core'
import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-zod'

import { organizations } from './organizations'
import { projects } from './projects'
import { workspaces } from './workspaces'

export const workspaceLocationsForUserForHost = pgTable(
	'workspace_locations_for_user_for_host',
	{
		organization_id: uuid()
			.references(() => organizations.id, { onDelete: 'cascade' })
			.notNull(),
		project_id: uuid()
			.references(() => projects.id, { onDelete: 'cascade' })
			.notNull(),
		workspace_id: uuid()
			.references(() => workspaces.id, { onDelete: 'cascade' })
			.notNull(),
		user_id: text().notNull(),
		host_id: text().notNull(),
		file_path: text().notNull(),
		setup_generation: bigint({ mode: 'bigint' })
			.notNull()
			.default(sql`1`),
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
			name: 'workspace_locations_for_user_for_host_pk',
			columns: [t.organization_id, t.project_id, t.workspace_id, t.user_id, t.host_id],
		}),
	],
)

export const workspaceLocationSelectSchema = createSelectSchema(workspaceLocationsForUserForHost)
export const workspaceLocationInsertSchema = createInsertSchema(workspaceLocationsForUserForHost)
export const workspaceLocationUpdateSchema = createUpdateSchema(workspaceLocationsForUserForHost)
export type WorkspaceLocationForUserForHost = typeof workspaceLocationsForUserForHost.$inferSelect
export type NewWorkspaceLocationForUserForHost = typeof workspaceLocationsForUserForHost.$inferInsert
