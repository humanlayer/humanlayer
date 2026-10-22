import { sql } from 'drizzle-orm'
import { bigint, boolean, index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core'
import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-zod'
import { uuidv7 } from 'uuidv7'
import z from 'zod/v4'

import { organizations } from './organizations'

/**
 * One denormalized evidence record for a generated context shard.
 *
 * Evidence is resolved from compact inference citation tags at generation time
 * and stored immutably, so the admin review UI never joins back to
 * conversation_events to display a citation.
 *
 * `conversationEventId` is null when the cited message came from
 * `sessions.prompt` (the human launch prompt), which has no conversation event
 * row of its own.
 */
export const ContextShardEvidenceSchema = z.object({
	citation: z.string().min(1),
	conversationEventId: z.uuid().nullable(),
	sessionId: z.uuid(),
	taskId: z.uuid().nullable(),
	sourceUserId: z.string(),
	role: z.enum(['user', 'assistant']),
})

export const ContextShardEvidenceListSchema = z.array(ContextShardEvidenceSchema).max(5)
export type ContextShardEvidence = z.infer<typeof ContextShardEvidenceSchema>

export const contextShards = pgTable(
	'context_shards',
	{
		id: uuid()
			.primaryKey()
			.default(sql`uuidv7()`)
			.$defaultFn(() => uuidv7()),

		organization_id: uuid('organization_id')
			.references(() => organizations.id, { onDelete: 'cascade' })
			.notNull(),

		shard_text: text('shard_text').notNull(),

		reasoning_text: text('reasoning_text').notNull(),

		evidence_json: jsonb('evidence_json').$type<ContextShardEvidence[]>().notNull(),

		released_to_org: boolean('released_to_org').notNull().default(false),

		dismissed: boolean('dismissed').notNull().default(false),

		dismissed_at: bigint('dismissed_at', { mode: 'bigint' }),

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
	(t) => [
		index('context_shards_org_released_idx').on(t.organization_id, t.released_to_org, t.dismissed, t.id),
		index('context_shards_org_review_idx').on(t.organization_id, t.dismissed, t.created_at, t.id),
	],
)

// Electric sends JSONB as strings over the wire, so we need to parse them
const jsonbParser = <T extends z.ZodTypeAny>(schema: T) =>
	z.preprocess((val) => {
		if (typeof val === 'string') {
			try {
				return JSON.parse(val)
			} catch {
				return val
			}
		}
		return val
	}, schema)

export const contextShardSelectSchema = createSelectSchema(contextShards, {
	evidence_json: jsonbParser(ContextShardEvidenceListSchema),
})
export const contextShardInsertSchema = createInsertSchema(contextShards, {
	evidence_json: ContextShardEvidenceListSchema,
})
export const contextShardUpdateSchema = createUpdateSchema(contextShards, {
	evidence_json: ContextShardEvidenceListSchema,
})
export type ContextShard = typeof contextShards.$inferSelect
export type NewContextShard = typeof contextShards.$inferInsert
