import { type CodingAgent, CodingAgentZodSchema } from '@humanlayer/schemas/coding-agent'
import type { SessionModelUsage } from '@humanlayer/schemas/effect/model-usage'
import type { SessionErrorReason } from '@humanlayer/schemas/effect/session/session-error-reason'
import type { SessionStatus } from '@humanlayer/schemas/effect/session/session-status'
import { SessionErrorReasonSchema } from '@humanlayer/schemas/zod/session/session-error-reason'
import { SessionStatusSchema } from '@humanlayer/schemas/zod/session/session-status'
import { sql } from 'drizzle-orm'
import {
	type AnyPgColumn,
	bigint,
	boolean,
	index,
	integer,
	jsonb,
	pgTable,
	real,
	text,
	uuid,
} from 'drizzle-orm/pg-core'
import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-zod'
import { uuidv7 } from 'uuidv7'
import z from 'zod/v4'

import { jsonbParser } from '../utils/jsonb-parser'
import { type NextStepSuggestion, NextStepSuggestionSchema } from '../zodschemas/next-step'
import { type SessionSummary, SessionSummarySchema } from '../zodschemas/session-summary'
import { organizations } from './organizations'
import { tasks } from './tasks'
export type { SessionStatus }

export const DAEMON_ACTIVE_SESSION_STATUSES = [
	'launching',
	'running',
	'needs_approval',
	'waiting_for_usage_limit',
	'resuming',
] as const satisfies readonly SessionStatus[]

export type SessionLabel = { name: string; title: string }

export const permissionsModeSchema = z.enum(['default', 'accept_edits', 'auto', 'bypass'])
export type PermissionsMode = z.infer<typeof permissionsModeSchema>
export const multiplayerPromptingUserIdsSchema = z.array(z.string())

export type { ModelTokenUsage, SessionModelUsage } from '@humanlayer/schemas/effect/model-usage'

export const sessions = pgTable(
	'sessions',
	{
		id: uuid()
			.primaryKey()
			.default(sql`uuidv7()`)
			.$defaultFn(() => uuidv7()),

		task_id: uuid().references(() => tasks.id, { onDelete: 'set null' }),
		organization_id: uuid().references(() => organizations.id, { onDelete: 'cascade' }),

		forked_from_session_id: uuid('forked_from_session_id').references((): AnyPgColumn => sessions.id, {
			onDelete: 'set null',
		}),

		handoff_source_session_id: uuid('handoff_source_session_id').references((): AnyPgColumn => sessions.id, {
			onDelete: 'set null',
		}),

		created_by: text().notNull(),

		resource_owner_user_id: text('resource_owner_user_id').notNull(),

		coding_agent: text().notNull().$type<CodingAgent>().default('claude'),

		coding_agent_session_id: text(),

		host_id: text().notNull(),

		working_directory: text().notNull(),

		model: text(),

		/**
		 * The model the coding agent actually ran, as reported by its init event
		 * (e.g. 'haiku' resolves to 'claude-haiku-4-5-20251001', or a us.anthropic.*
		 * ID on Bedrock). Consumed in a few places (non-exhaustive): context window
		 * limit calculation, and the UI may surface it to the user ("running as …").
		 * `model` stays the user-selected value and remains the continuation/resume
		 * channel; only explicit downgrades (model-refusal fallback) may rewrite `model`.
		 */
		resolved_model: text(),

		provider: text(),

		effort: text(),

		fast_mode: boolean().notNull().default(false),

		title: text(),

		summary: text(),

		status: text().notNull().$type<SessionStatus>(),

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

		/**
		 * Track the latest meaningful session activity, including conversation events,
		 * user lifecycle intent, and daemon progress into launching or running.
		 */
		last_activity_at: bigint('last_activity_at', { mode: 'bigint' })
			.notNull()
			.default(sql`(extract(epoch from now()) * 1000)::bigint`)
			.$defaultFn(() => BigInt(Date.now())),

		num_events: integer().notNull().default(0),

		/**
		 * Current context window usage (input + output tokens of latest message)
		 */
		context_window_tokens: integer().default(0),

		/**
		 * Effective context window limit for this session's model
		 */
		context_window_limit: integer().default(168000),

		is_compacting: boolean().notNull().default(false),

		/**
		 * Total cost in USD for this session (cumulative across all API calls)
		 * Updated from result event's total_cost_usd field
		 */
		total_cost_usd: real(),

		/**
		 * Cumulative model usage breakdown by model name
		 * Format: { [modelName: string]: { input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens } }
		 * Updated from result event's modelUsage field
		 */
		model_usage: jsonb().$type<SessionModelUsage>(),

		/**
		 * Idempotency keys of recently applied usage reports (bounded list, newest last).
		 * The daemon sends one usage report per coding-agent run (keyed by the SDK result event
		 * uuid, or a daemon-generated uuid); retries re-send the same key so the API can skip
		 * reports it has already applied — including a delayed retry that arrives after a newer
		 * run's report has already advanced the totals.
		 */
		applied_usage_report_keys: jsonb().$type<string[]>(),

		error_message: text(),

		// Set by the daemon when it can classify the failure, so the UI drives affordances (e.g. an
		// in-app sign-in prompt) off a typed reason instead of grepping error_message. Null = uncategorized.
		error_reason: text().$type<SessionErrorReason>(),

		permissions_mode: text().notNull().$type<PermissionsMode>().default('default'),

		multiplayer_prompting_user_ids: jsonb('multiplayer_prompting_user_ids').$type<string[]>().notNull().default([]),
		multiplayer_prompting_started_at: bigint('multiplayer_prompting_started_at', { mode: 'bigint' }),
		multiplayer_prompting_expires_at: bigint('multiplayer_prompting_expires_at', { mode: 'bigint' }),

		archived: boolean().notNull().default(false),

		fork_data: jsonb(),

		workflow_type: text(),

		prompt: text(), // used for the session launcher state

		labels: jsonb().$type<SessionLabel[]>().default([]),

		/**
		 * AI-extracted next step suggestions from sessions that reached ready_for_input
		 * Array for future extensibility, currently single item
		 */
		next_step_suggestions: jsonb().$type<NextStepSuggestion[]>(),

		/**
		 * AI-extracted structured summary of the session conversation
		 * Generated when session transitions to ready_for_input status
		 */
		structured_summary: jsonb().$type<SessionSummary>(),
	},
	(t) => [
		index('sessions_org_owner_host_idx').on(t.organization_id, t.resource_owner_user_id, t.host_id),
		index('sessions_org_creator_host_idx').on(t.organization_id, t.created_by, t.host_id),
		index('sessions_org_task_idx').on(t.organization_id, t.task_id),
		index('sessions_lost_candidates_idx')
			.on(t.status, t.last_activity_at, t.id)
			.where(sql`${t.status} IN ('running', 'launching', 'resuming', 'interrupt_requested')`),
	],
)

export const sessionSelectSchema = createSelectSchema(sessions, {
	coding_agent: CodingAgentZodSchema,
	status: SessionStatusSchema,
	error_reason: SessionErrorReasonSchema.nullable(),
	permissions_mode: permissionsModeSchema,
	// Electric sends JSONB as strings over the wire, so we need to parse them
	next_step_suggestions: jsonbParser(z.array(NextStepSuggestionSchema).nullable()),
	structured_summary: jsonbParser(SessionSummarySchema.nullable()),
	labels: jsonbParser(z.array(z.object({ name: z.string(), title: z.string() })).nullable()),
	multiplayer_prompting_user_ids: jsonbParser(multiplayerPromptingUserIdsSchema),
	multiplayer_prompting_started_at: z.bigint().nullable().default(null),
	multiplayer_prompting_expires_at: z.bigint().nullable().default(null),
})
export const sessionInsertSchema = createInsertSchema(sessions, {
	coding_agent: CodingAgentZodSchema.optional(),
	next_step_suggestions: z.array(NextStepSuggestionSchema).nullish(),
	structured_summary: SessionSummarySchema.nullish(),
})
export const sessionUpdateSchema = createUpdateSchema(sessions, {
	coding_agent: CodingAgentZodSchema.optional(),
	next_step_suggestions: z.array(NextStepSuggestionSchema).nullish(),
	structured_summary: SessionSummarySchema.nullish(),
})
export type Session = typeof sessions.$inferSelect
export type SessionRow = z.infer<typeof sessionSelectSchema>
export type NewSession = typeof sessions.$inferInsert
