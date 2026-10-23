import { z } from 'zod/v4'

const StreamEventBase = z.object({
	id: z.string().uuid().describe('Unique stream event row ID for StreamDB primary key'),
	session_id: z.string().uuid().describe('Session this event belongs to'),
	message_seq: z.number().int().describe('Monotonic counter for messages in this session'),
	timestamp: z.number().int().describe('Unix timestamp (ms) when daemon emitted this event'),
})

export const ConversationEventStreamSchema = StreamEventBase.extend({
	type: z.literal('conversation_event'),
	conversation_event_id: z.string().uuid().describe('ID of the persisted conversation_events row'),
	coding_agent_event_id: z.string().nullable().optional(),
	coding_agent_session_id: z.string().nullable().optional(),
	organization_id: z.string().uuid().nullable().optional(),
	resource_owner_user_id: z.string().nullable().optional(),
	task_id: z.string().uuid().nullable().optional(),
	event_type: z.enum(['message', 'tool_call', 'tool_result', 'thinking', 'system']),
	role: z.enum(['user', 'assistant', 'system']),
	content: z.string().nullable().optional(),
	tool_call_id: z.string().nullable().optional(),
	tool_name: z.string().nullable().optional(),
	tool_input_json: z.unknown().nullable().optional(),
	parent_tool_use_id: z.string().nullable().optional(),
	tool_result_for_id: z.string().nullable().optional(),
	tool_result_content: z.string().nullable().optional(),
	approval_status: z.enum(['pending', 'approved', 'denied']).nullable().optional(),
	approval_id: z.string().uuid().nullable().optional(),
	user_id: z.string().nullable().optional(),
	user_name: z.string().nullable().optional(),
	next_step_suggestion: z.unknown().nullable().optional(),
	input_tokens: z.number().int().nullable().optional(),
	output_tokens: z.number().int().nullable().optional(),
	run_index: z.number().int().nullable().optional(),
	created_at: z.number().int(),
	updated_at: z.number().int(),
})

export const MessageStartSchema = StreamEventBase.extend({ type: z.literal('message_start') })
export const MessageStopSchema = StreamEventBase.extend({ type: z.literal('message_stop') })

export const TextBlockStartSchema = StreamEventBase.extend({
	type: z.literal('text_block_start'),
	block_seq: z.number().int().describe('Index of this block within the current message'),
	conversation_event_id: z.string().uuid().describe('ID that will be used when this block persists to Electric'),
})

export const TextDeltaSchema = StreamEventBase.extend({
	type: z.literal('text_delta'),
	block_seq: z.number().int(),
	delta_seq: z.number().int().describe('Monotonic counter for deltas within this block'),
	conversation_event_id: z.string().uuid(),
	content: z.string().describe('Incremental text chunk'),
})

export const TextBlockStopSchema = StreamEventBase.extend({
	type: z.literal('text_block_stop'),
	block_seq: z.number().int(),
	conversation_event_id: z.string().uuid(),
})

export const ThinkingBlockStartSchema = StreamEventBase.extend({
	type: z.literal('thinking_block_start'),
	block_seq: z.number().int(),
	conversation_event_id: z.string().uuid(),
})

export const ThinkingDeltaSchema = StreamEventBase.extend({
	type: z.literal('thinking_delta'),
	block_seq: z.number().int(),
	delta_seq: z.number().int().describe('Monotonic counter for deltas within this block'),
	conversation_event_id: z.string().uuid(),
	content: z.string().describe('Incremental thinking chunk'),
})

export const ThinkingBlockStopSchema = StreamEventBase.extend({
	type: z.literal('thinking_block_stop'),
	block_seq: z.number().int(),
	conversation_event_id: z.string().uuid(),
})

export const StreamEventSchema = z.discriminatedUnion('type', [
	ConversationEventStreamSchema,
	MessageStartSchema,
	MessageStopSchema,
	TextBlockStartSchema,
	TextDeltaSchema,
	TextBlockStopSchema,
	ThinkingBlockStartSchema,
	ThinkingDeltaSchema,
	ThinkingBlockStopSchema,
])

export type ConversationEventStream = z.infer<typeof ConversationEventStreamSchema>
export type MessageStart = z.infer<typeof MessageStartSchema>
export type MessageStop = z.infer<typeof MessageStopSchema>
export type TextBlockStart = z.infer<typeof TextBlockStartSchema>
export type TextDelta = z.infer<typeof TextDeltaSchema>
export type TextBlockStop = z.infer<typeof TextBlockStopSchema>
export type ThinkingBlockStart = z.infer<typeof ThinkingBlockStartSchema>
export type ThinkingDelta = z.infer<typeof ThinkingDeltaSchema>
export type ThinkingBlockStop = z.infer<typeof ThinkingBlockStopSchema>
export type StreamEvent = z.infer<typeof StreamEventSchema>
