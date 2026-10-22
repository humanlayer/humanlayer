import { sql } from 'drizzle-orm'
import { bigint, boolean, index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core'
import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-zod'
import { uuidv7 } from 'uuidv7'

import { jsonbParser } from '../utils/jsonb-parser'
import { type DiffCommentAnchor, DiffCommentAnchorSchema } from '../zodschemas/diff-comment-anchor'
import { organizations } from './organizations'
import { tasks } from './tasks'

export const diffComments = pgTable(
	'diff_comments',
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
		created_by_user_id: text('created_by_user_id').notNull(),
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
		anchor_json: jsonb('anchor_json').$type<DiffCommentAnchor>(),
		is_resolved: boolean('is_resolved').notNull().default(false),
		resolved_by_user_id: text('resolved_by_user_id'),
		is_deleted: boolean('is_deleted').notNull().default(false),
		created_by_agent: boolean('created_by_agent').notNull().default(false),
	},
	(t) => [index('diff_comments_org_task_idx').on(t.organization_id, t.task_id)],
)

export const diffCommentSelectSchema = createSelectSchema(diffComments, {
	anchor_json: jsonbParser(DiffCommentAnchorSchema.nullable()),
})
export const diffCommentInsertSchema = createInsertSchema(diffComments, {
	anchor_json: DiffCommentAnchorSchema.nullish(),
})
export const diffCommentUpdateSchema = createUpdateSchema(diffComments, {
	anchor_json: DiffCommentAnchorSchema.nullish(),
})

export type DiffComment = typeof diffComments.$inferSelect
export type NewDiffComment = typeof diffComments.$inferInsert
