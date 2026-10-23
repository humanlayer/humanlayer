import { sql } from 'drizzle-orm'
import { bigint, integer, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core'
import { createInsertSchema, createSelectSchema } from 'drizzle-zod'
import { uuidv7 } from 'uuidv7'

import { artifacts } from './artifacts'
import { organizations } from './organizations'

export const artifactVersions = pgTable(
	'artifact_versions',
	{
		id: uuid()
			.primaryKey()
			.default(sql`uuidv7()`)
			.$defaultFn(() => uuidv7()),

		artifact_id: uuid('artifact_id')
			.references(() => artifacts.id, { onDelete: 'cascade' })
			.notNull(),

		// UUID without FK - preserves version history if task is deleted
		task_id: uuid('task_id'),

		task_slug: text('task_slug'),

		resource_owner_user_id: text('resource_owner_user_id').notNull(),

		organization_id: uuid('organization_id')
			.references(() => organizations.id, { onDelete: 'cascade' })
			.notNull(),

		content: text('content').notNull(),

		content_hash: text('content_hash').notNull(),

		created_by: text('created_by').notNull(),

		created_at: bigint('created_at', { mode: 'bigint' })
			.notNull()
			.default(sql`(extract(epoch from now()) * 1000)::bigint`)
			.$defaultFn(() => BigInt(Date.now())),

		version_number: integer('version_number').notNull(),
	},
	(t) => [unique('artifact_versions_artifact_version_unique').on(t.artifact_id, t.version_number)],
)

export const artifactVersionSelectSchema = createSelectSchema(artifactVersions)
export const artifactVersionInsertSchema = createInsertSchema(artifactVersions)
export type ArtifactVersion = typeof artifactVersions.$inferSelect
export type NewArtifactVersion = typeof artifactVersions.$inferInsert
