import { sql } from 'drizzle-orm'
import {
	bigint,
	boolean,
	check,
	foreignKey,
	index,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from 'drizzle-orm/pg-core'
import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-zod'
import { uuidv7 } from 'uuidv7'
import type z from 'zod/v4'

import { jsonbParser } from '../utils/jsonb-parser'
import { type ArtifactCommentAnchor, ArtifactCommentAnchorSchema } from '../zodschemas/artifact-comment-anchor'
import { CommentKindSchema } from '../zodschemas/artifact-comment-kind'
import { artifactVersions } from './artifact-versions'
import { artifacts } from './artifacts'
import { organizations } from './organizations'
import { tasks } from './tasks'

export const anonymousArtifactCommenters = pgTable(
	'anonymous_artifact_commenters',
	{
		id: uuid('id').primaryKey(),
		artifact_id: uuid('artifact_id')
			.notNull()
			.references(() => artifacts.id, { onDelete: 'cascade' }),
		display_name: text('display_name').notNull(),
		email: text('email'),
		created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		last_used_at: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [uniqueIndex('anonymous_artifact_commenters_artifact_id_id_idx').on(t.artifact_id, t.id)],
)

export const artifactComments = pgTable(
	'artifact_comments',
	{
		id: uuid()
			.primaryKey()
			.default(sql`uuidv7()`)
			.$defaultFn(() => uuidv7()),

		organization_id: uuid()
			.notNull()
			.references(() => organizations.id, { onDelete: 'cascade' }),

		resource_owner_user_id: text('resource_owner_user_id').notNull(),

		task_id: uuid('task_id')
			.notNull()
			.references(() => tasks.id, { onDelete: 'cascade' }),

		created_by_user_id: text('created_by_user_id'),
		anonymous_author_id: uuid('anonymous_author_id'),
		anonymous_guest_name: text('anonymous_guest_name'),
		created_via_public_share: boolean('created_via_public_share').notNull().default(false),

		reply_to_comment_id: uuid('reply_to_comment_id'),

		created_at: bigint('created_at', { mode: 'bigint' })
			.notNull()
			.default(sql`(extract(epoch from now()) * 1000)::bigint`)
			.$defaultFn(() => BigInt(Date.now())),

		updated_at: bigint('updated_at', { mode: 'bigint' })
			.notNull()
			.default(sql`(extract(epoch from now()) * 1000)::bigint`)
			.$defaultFn(() => BigInt(Date.now()))
			.$onUpdateFn(() => BigInt(Date.now())),

		content_text: text('content_text').notNull(),
		content_json: jsonb('content_json'),

		artifact_id: uuid('artifact_id')
			.notNull()
			.references(() => artifacts.id, { onDelete: 'cascade' }),

		created_at_artifact_version_id: uuid('created_at_artifact_version_id').references(() => artifactVersions.id),

		/** Text content of the block that was commented on */
		commented_upon_block_text: text('commented_upon_block_text'),
		/** Text content of the block before the commented block (null if first block) */
		previous_block_text: text('previous_block_text'),
		/** Text content of the block after the commented block (null if last block) */
		next_block_text: text('next_block_text'),

		/**
		 * Versioned Artifact Viewer V2 anchor envelope (`{ v: 2, ... }`).
		 *
		 * Null means "not a desktop V2-anchored comment" — the legacy triplet
		 * columns above remain the V1 anchor. The two desktop formats partition
		 * whole threads by the ROOT row: a root with `anchor_json` is V2-only, a
		 * root without it is legacy/V1, and replies follow their root. Null never
		 * triggers compatibility matching in V2, and V2 writes never derive the
		 * legacy triplet from this envelope.
		 */
		anchor_json: jsonb('anchor_json').$type<ArtifactCommentAnchor>(),

		/**
		 * Typed review vocabulary: `comment` (free-form, the default and every
		 * legacy/V1 row), `deletion`, or `approval`. The kind — not parsing the
		 * body text — is the authoritative machine-readable verdict signal. Only
		 * desktop Artifact Viewer V2 writes non-default kinds today.
		 */
		kind: text('kind').notNull().default('comment'),

		is_resolved: boolean('is_resolved').notNull().default(false),
		resolved_by_user_id: text('resolved_by_user_id'),

		is_deleted: boolean('is_deleted').notNull().default(false),

		/** True if this comment was created by an AI agent (via MCP tool) */
		created_by_agent: boolean('created_by_agent').notNull().default(false),
	},
	(t) => [
		foreignKey({
			name: 'artifact_comments_anonymous_author_fk',
			columns: [t.artifact_id, t.anonymous_author_id],
			foreignColumns: [anonymousArtifactCommenters.artifact_id, anonymousArtifactCommenters.id],
		}),
		check(
			'artifact_comments_exactly_one_author_check',
			sql`((${t.created_by_user_id} IS NOT NULL AND ${t.anonymous_author_id} IS NULL AND ${t.anonymous_guest_name} IS NULL) OR (${t.created_by_user_id} IS NULL AND ${t.anonymous_author_id} IS NOT NULL AND ${t.anonymous_guest_name} IS NOT NULL))`,
		),
		index('artifact_comments_org_owner_idx').on(t.organization_id, t.resource_owner_user_id),
		index('artifact_comments_org_task_idx').on(t.organization_id, t.task_id),
		index('artifact_comments_artifact_id_idx').on(t.artifact_id),
	],
)

export const artifactCommentSelectSchema = createSelectSchema(artifactComments, {
	anchor_json: jsonbParser(ArtifactCommentAnchorSchema.nullable()),
})
/**
 * Columns a public share link never syncs: tenant, task and owner ids, version
 * ids, and quoted-block text. Every other column is public.
 */
export const artifactCommentColumnsHiddenFromPublic = {
	organization_id: true,
	resource_owner_user_id: true,
	task_id: true,
	created_at_artifact_version_id: true,
	commented_upon_block_text: true,
	previous_block_text: true,
	next_block_text: true,
	resolved_by_user_id: true,
} as const

export const publicArtifactCommentSelectSchema = artifactCommentSelectSchema.omit(
	artifactCommentColumnsHiddenFromPublic,
)
export const artifactCommentInsertSchema = createInsertSchema(artifactComments, {
	anchor_json: ArtifactCommentAnchorSchema.nullish(),
	kind: CommentKindSchema.optional(),
})
export const artifactCommentUpdateSchema = createUpdateSchema(artifactComments, {
	anchor_json: ArtifactCommentAnchorSchema.nullish(),
	kind: CommentKindSchema.optional(),
})
export type StoredArtifactComment = typeof artifactComments.$inferSelect
/** Authenticated comment surfaces historically require a user author. Public-share readers use the public schema. */
export type ArtifactComment = Omit<StoredArtifactComment, 'created_by_user_id'> & { created_by_user_id: string }
export type ArtifactCommentRow = z.infer<typeof artifactCommentSelectSchema>
export type NewArtifactComment = typeof artifactComments.$inferInsert
