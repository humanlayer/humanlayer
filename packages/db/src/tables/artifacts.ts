import { sql } from 'drizzle-orm'
import { bigint, boolean, index, jsonb, pgEnum, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core'
import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-zod'
import { uuidv7 } from 'uuidv7'
import z from 'zod/v4'

import { ARTIFACT_PUBLIC_PERMISSIONS } from '../artifact-public-permission'
import { jsonbParser } from '../utils/jsonb-parser'
import { organizations } from './organizations'

export const artifactPublicPermission = pgEnum('artifact_public_permission', ARTIFACT_PUBLIC_PERMISSIONS)

export const artifacts = pgTable(
	'artifacts',
	{
		id: uuid()
			.primaryKey()
			.default(sql`uuidv7()`)
			.$defaultFn(() => uuidv7()),

		// UUID without FK - preserves artifacts if task is deleted
		task_id: uuid('task_id'),

		task_slug: text('task_slug'),

		resource_owner_user_id: text('resource_owner_user_id').notNull(),

		organization_id: uuid('organization_id')
			.references(() => organizations.id, { onDelete: 'cascade' })
			.notNull(),

		file_name: text('file_name').notNull(),

		content: text('content').notNull(),

		// Computed server-side using hash(content) from ohash on create/update
		content_hash: text('content_hash').notNull(),

		// Parsed YAML frontmatter stored as JSONB - populated by daemon on upsert
		frontmatter: jsonb('frontmatter').$type<Record<string, unknown>>().notNull().default({}),

		created_by: text('created_by').notNull(),

		created_at: bigint('created_at', { mode: 'bigint' })
			.notNull()
			.default(sql`(extract(epoch from now()) * 1000)::bigint`)
			.$defaultFn(() => BigInt(Date.now())),

		last_updated_at: bigint('last_updated_at', { mode: 'bigint' })
			.notNull()
			.default(sql`(extract(epoch from now()) * 1000)::bigint`)
			.$defaultFn(() => BigInt(Date.now()))
			.$onUpdateFn(() => BigInt(Date.now())),

		// Shareable link fields
		share_key: text('share_key').unique(),
		shared_by: text('shared_by'),
		share_enabled: boolean('share_enabled').default(false).notNull(),
		public_permission: artifactPublicPermission('public_permission').default('off').notNull(),

		// Soft-delete tombstone — true means artifact is "deleted" but row is preserved
		is_deleted: boolean('is_deleted').notNull().default(false),

		// S3 storage support
		storage_type: text('storage_type').notNull().default('postgres'),
		s3_key: text('s3_key'),
		content_type: text('content_type'),
		file_size_bytes: bigint('file_size_bytes', { mode: 'bigint' }),
	},
	(t) => [
		unique('artifacts_task_file_unique').on(t.task_id, t.file_name),
		index('artifacts_org_owner_idx').on(t.organization_id, t.resource_owner_user_id),
	],
)

export const artifactSelectSchema = createSelectSchema(artifacts, {
	frontmatter: jsonbParser(z.record(z.string(), z.unknown())),
})
export const artifactInsertSchema = createInsertSchema(artifacts)
export const artifactUpdateSchema = createUpdateSchema(artifacts)

// Metadata-only schema for sync (excludes content column)
export const artifactMetadataSelectSchema = createSelectSchema(artifacts, {
	frontmatter: jsonbParser(z.record(z.string(), z.unknown())),
}).omit({ content: true })

/**
 * Columns a public share link never syncs: tenant, task and owner ids, the share
 * capability itself, and storage internals. Every other column is public.
 */
export const artifactColumnsHiddenFromPublic = {
	task_id: true,
	task_slug: true,
	resource_owner_user_id: true,
	organization_id: true,
	content_hash: true,
	frontmatter: true,
	created_by: true,
	share_key: true,
	shared_by: true,
	share_enabled: true,
	public_permission: true,
	is_deleted: true,
	s3_key: true,
	content_type: true,
	file_size_bytes: true,
} as const

export const publicArtifactSelectSchema = artifactSelectSchema.omit(artifactColumnsHiddenFromPublic)

export type Artifact = typeof artifacts.$inferSelect
export type ArtifactMetadata = Omit<Artifact, 'content'>
export type ArtifactMetadataRow = z.infer<typeof artifactMetadataSelectSchema>
export type PublicArtifact = z.infer<typeof publicArtifactSelectSchema>
export type NewArtifact = typeof artifacts.$inferInsert
