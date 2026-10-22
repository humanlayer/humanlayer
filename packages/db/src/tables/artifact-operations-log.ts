import { sql } from 'drizzle-orm'
import { bigint, boolean, index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core'
import { createInsertSchema, createSelectSchema } from 'drizzle-zod'
import { uuidv7 } from 'uuidv7'

import { artifacts } from './artifacts'
import { organizations } from './organizations'
import { sessions } from './sessions'

export type ArtifactOperationType = 'Write' | 'Edit' | 'MultiEdit' | 'Read'

export const artifactOperationsLog = pgTable(
	'artifact_operations_log',
	{
		id: uuid()
			.primaryKey()
			.default(sql`uuidv7()`)
			.$defaultFn(() => uuidv7()),

		artifact_id: uuid('artifact_id')
			.references(() => artifacts.id, { onDelete: 'cascade' })
			.notNull(),

		session_id: uuid('session_id').references(() => sessions.id, { onDelete: 'set null' }),

		// UUID without FK - preserves operation history if task is deleted
		task_id: uuid('task_id'),

		task_slug: text('task_slug'),

		resource_owner_user_id: text('resource_owner_user_id').notNull(),

		created_by: text('created_by').notNull(),

		organization_id: uuid('organization_id')
			.references(() => organizations.id, { onDelete: 'cascade' })
			.notNull(),

		operation_type: text('operation_type').notNull().$type<ArtifactOperationType>(),

		operation_contents: jsonb('operation_contents').notNull(),

		version_created: boolean('version_created').default(false),

		created_at: bigint('created_at', { mode: 'bigint' })
			.notNull()
			.default(sql`(extract(epoch from now()) * 1000)::bigint`)
			.$defaultFn(() => BigInt(Date.now())),
	},
	(t) => [index('artifact_operations_log_artifact_id_idx').on(t.artifact_id)],
)

export const artifactOperationsLogSelectSchema = createSelectSchema(artifactOperationsLog)
export const artifactOperationsLogInsertSchema = createInsertSchema(artifactOperationsLog)
export type ArtifactOperationLog = typeof artifactOperationsLog.$inferSelect
export type NewArtifactOperationLog = typeof artifactOperationsLog.$inferInsert
