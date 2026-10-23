import { type CodingAgent, CodingAgentZodSchema } from '@humanlayer/schemas/coding-agent'
import { sql } from 'drizzle-orm'
import { bigint, doublePrecision, index, integer, jsonb, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core'
import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-zod'
import { uuidv7 } from 'uuidv7'
import z from 'zod/v4'

import { jsonbParser } from '../utils/jsonb-parser'
import { organizations } from './organizations'
import { sessions } from './sessions'
import { tasks } from './tasks'

export type SessionUsageSource = 'claude_sdk_result' | 'codelayer_run' | 'fold_run' | 'backfill'

/**
 * Append-only token usage events: one immutable row per (usage report, model).
 *
 * A "report" is one run's usage, keyed by the same usageReportKey that
 * sessions.update uses to merge snapshots (result-event uuid for claude,
 * run-minted uuid for codelayer, 'backfill:<session_id>' for backfill).
 * Counters are cumulative PER RUN (reset on resume), so rows sum across runs.
 *
 * TOKEN SEMANTICS: `tokens` stores RAW provider fields (Anthropic semantics):
 * `input_tokens` EXCLUDES cache_read/cache_creation (separate, additive keys).
 * This differs from conversation_events.input_tokens (COMBINED total).
 * Conventional keys: input_tokens, output_tokens, cache_read_input_tokens,
 * cache_creation_input_tokens; open map so new categories need no migration.
 * Hoisted int columns mirror the four conventional keys for cheap SQL.
 *
 * cost_usd is frozen at ingest (SDK-reported per-model cost); never repriced.
 * Rows are immutable — never UPDATE; rollups are derived projections.
 */
export const sessionUsageEvents = pgTable(
	'session_usage_events',
	{
		id: uuid()
			.primaryKey()
			.default(sql`uuidv7()`)
			.$defaultFn(() => uuidv7()),

		session_id: uuid()
			.references(() => sessions.id, { onDelete: 'cascade' })
			.notNull(),

		organization_id: uuid()
			.references(() => organizations.id, { onDelete: 'cascade' })
			.notNull(),

		resource_owner_user_id: text('resource_owner_user_id').notNull(),

		// sessions.created_by at ingest: whose daemon spent these tokens. Task owner
		// reassignment rewrites resource_owner_user_id and must leave this alone.
		session_creator_user_id: text('session_creator_user_id').notNull(),

		task_id: uuid('task_id').references(() => tasks.id, { onDelete: 'set null' }),

		coding_agent: text().notNull().$type<CodingAgent>(),

		// 'backfill' is inserted directly (batch SQL), never through the daemon
		// procedure — the daemon contract's source enum deliberately omits it.
		source: text().notNull().$type<SessionUsageSource>(),

		/** Producer-generated idempotency key; equals the run's usageReportKey. */
		report_key: text().notNull(),

		model: text().notNull(),

		/** Raw open token map (Anthropic semantics; see table doc). */
		tokens: jsonb().$type<Record<string, number>>().notNull(),

		// Hoisted from `tokens` at the single API write site for indexed SQL aggregation.
		input_tokens: integer().notNull().default(0),
		output_tokens: integer().notNull().default(0),
		cache_read_tokens: integer().notNull().default(0),
		cache_creation_tokens: integer().notNull().default(0),

		/**
		 * Per-model cost frozen at ingest; null when the producer has no estimate.
		 * double precision (not real) so summing many rows in a rollup doesn't
		 * accumulate single-precision error on a money value.
		 */
		cost_usd: doublePrecision(),

		/** Event time (daemon clock). Rollups bucket on this. */
		occurred_at: bigint('occurred_at', { mode: 'bigint' }).notNull(),

		created_at: bigint('created_at', { mode: 'bigint' })
			.notNull()
			.default(sql`(extract(epoch from now()) * 1000)::bigint`)
			.$defaultFn(() => BigInt(Date.now())),
	},
	(t) => [
		// The leading column of this unique constraint doubles as the session_id
		// index (per-session lookups + FK cascade), so no separate one is needed.
		unique('session_usage_events_report_model_unique').on(t.session_id, t.report_key, t.model),
		index('session_usage_events_org_occurred_idx').on(t.organization_id, t.occurred_at),
		index('session_usage_events_org_creator_occurred_idx').on(
			t.organization_id,
			t.session_creator_user_id,
			t.occurred_at,
		),
	],
)

export const sessionUsageEventSelectSchema = createSelectSchema(sessionUsageEvents, {
	coding_agent: CodingAgentZodSchema,
	tokens: jsonbParser(z.record(z.string(), z.number())),
})
export const sessionUsageEventInsertSchema = createInsertSchema(sessionUsageEvents, {
	coding_agent: CodingAgentZodSchema,
})
export const sessionUsageEventUpdateSchema = createUpdateSchema(sessionUsageEvents, {
	coding_agent: CodingAgentZodSchema.optional(),
})
export type SessionUsageEvent = typeof sessionUsageEvents.$inferSelect
export type NewSessionUsageEvent = typeof sessionUsageEvents.$inferInsert
