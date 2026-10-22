import { sql } from 'drizzle-orm'
import { bigint, index, integer, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core'
import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-zod'
import { uuidv7 } from 'uuidv7'

import { jsonbParser } from '../utils/jsonb-parser'
import { type NextStepSuggestion, NextStepSuggestionSchema } from '../zodschemas/next-step'
import { approvals } from './approvals'
import { organizations } from './organizations'
import { sessions } from './sessions'
import { tasks } from './tasks'

export const conversationEvents = pgTable(
	'conversation_events',
	{
		id: uuid()
			.primaryKey()
			.default(sql`uuidv7()`)
			.$defaultFn(() => uuidv7()),

		coding_agent_event_id: text(),

		session_id: uuid()
			.references(() => sessions.id, { onDelete: 'cascade' })
			.notNull(),

		organization_id: uuid()
			.references(() => organizations.id, { onDelete: 'cascade' })
			.notNull(),

		resource_owner_user_id: text('resource_owner_user_id').notNull(),

		task_id: uuid('task_id').references(() => tasks.id, { onDelete: 'set null' }),

		coding_agent_session_id: text(),

		event_type: text().notNull().$type<'message' | 'tool_call' | 'tool_result' | 'thinking' | 'system'>(),

		role: text().notNull().$type<'user' | 'assistant' | 'system'>(),

		content: text(),

		tool_call_id: text(),

		tool_name: text(),

		tool_input_json: jsonb(),

		parent_tool_use_id: text(),

		tool_result_for_id: text(),

		tool_result_content: text(),

		approval_status: text().$type<'pending' | 'approved' | 'denied'>(),

		approval_id: uuid().references(() => approvals.id, { onDelete: 'cascade' }),

		user_id: text(),

		user_name: text(),

		/**
		 * AI-extracted next step suggestion for this message
		 * Only populated for assistant messages that trigger a next step
		 */
		next_step_suggestion: jsonb().$type<NextStepSuggestion>(),

		/**
		 * Input tokens for this message (from SDK usage)
		 */
		input_tokens: integer(),

		/**
		 * Output tokens for this message (from SDK usage)
		 */
		output_tokens: integer(),

		run_index: integer('run_index'),

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
		index('conversation_events_org_owner_session_idx').on(
			t.organization_id,
			t.resource_owner_user_id,
			t.session_id,
		),
		index('conversation_events_org_task_session_idx').on(t.organization_id, t.task_id, t.session_id),
		index('conversation_events_session_id_idx').on(t.session_id),
		index('conversation_events_tool_correlation_idx')
			.on(t.session_id, t.event_type, t.tool_result_for_id, t.tool_call_id, t.created_at)
			.where(
				sql`(${t.event_type} = 'tool_call' AND ${t.tool_call_id} IS NOT NULL) OR ${t.tool_result_for_id} IS NOT NULL`,
			),
	],
)

export const conversationEventSelectSchema = createSelectSchema(conversationEvents, {
	next_step_suggestion: jsonbParser(NextStepSuggestionSchema.nullable()),
})
export const conversationEventInsertSchema = createInsertSchema(conversationEvents, {
	next_step_suggestion: NextStepSuggestionSchema.nullish(),
})
export const conversationEventUpdateSchema = createUpdateSchema(conversationEvents, {
	next_step_suggestion: NextStepSuggestionSchema.nullish(),
})
export type ConversationEvent = typeof conversationEvents.$inferSelect
export type NewConversationEvent = typeof conversationEvents.$inferInsert
