import { createStateSchema, type createStreamDB } from '@durable-streams/state/db'
import {
	ConversationEventStreamSchema,
	MessageStartSchema,
	MessageStopSchema,
	TextBlockStartSchema,
	TextBlockStopSchema,
	TextDeltaSchema,
	ThinkingBlockStartSchema,
	ThinkingBlockStopSchema,
	ThinkingDeltaSchema,
} from '@humanlayer/streams/events'

export const streamSchema = createStateSchema({
	conversationEvents: {
		schema: ConversationEventStreamSchema,
		type: 'conversation_event',
		primaryKey: 'id',
	},
	messageStarts: {
		schema: MessageStartSchema,
		type: 'message_start',
		primaryKey: 'id',
	},
	messageStops: {
		schema: MessageStopSchema,
		type: 'message_stop',
		primaryKey: 'id',
	},
	textBlockStarts: {
		schema: TextBlockStartSchema,
		type: 'text_block_start',
		primaryKey: 'id',
	},
	textDeltas: {
		schema: TextDeltaSchema,
		type: 'text_delta',
		primaryKey: 'id',
	},
	textBlockStops: {
		schema: TextBlockStopSchema,
		type: 'text_block_stop',
		primaryKey: 'id',
	},
	thinkingBlockStarts: {
		schema: ThinkingBlockStartSchema,
		type: 'thinking_block_start',
		primaryKey: 'id',
	},
	thinkingDeltas: {
		schema: ThinkingDeltaSchema,
		type: 'thinking_delta',
		primaryKey: 'id',
	},
	thinkingBlockStops: {
		schema: ThinkingBlockStopSchema,
		type: 'thinking_block_stop',
		primaryKey: 'id',
	},
})

export type StreamSchema = typeof streamSchema
export type RiptideStreamDB = ReturnType<typeof createStreamDB<StreamSchema>>
