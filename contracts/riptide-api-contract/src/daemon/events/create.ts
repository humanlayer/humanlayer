import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'

// Coding-agent tool ids are short (`call_…`, `toolu_…`). Some providers append a large
// reasoning/thought-continuity blob that can exceed Postgres's ~2704-byte btree limit and break
// conversation_events_tool_correlation_idx. Cap the length at the write boundary: truncate (not
// .max/reject, which would drop the event) so the write still succeeds, and cap both id columns
// identically so the tool_call ↔ tool_result correlation the index serves is preserved.
const TOOL_ID_MAX = 256
const toolId = z.string().transform((s) => s.slice(0, TOOL_ID_MAX))

// Input schema - what the daemon sends
export const CreateEventInputSchema = z.object({
	eventId: z.uuid().optional(),
	sessionId: z.uuid(),
	codingAgentSessionId: z.string(),
	codingAgentEventId: z.string().optional(),

	eventType: z.enum(['message', 'tool_call', 'tool_result', 'thinking', 'system']),
	role: z.enum(['user', 'assistant', 'system']),
	content: z.string().optional(),

	// Tool call fields
	toolCallId: toolId.optional(),
	toolName: z.string().optional(),
	toolInputJson: z.any().optional(),
	parentToolUseId: z.string().nullable().optional(),

	// Tool result fields
	toolResultForId: toolId.optional(),
	toolResultContent: z.string().optional(),

	// Token usage fields
	inputTokens: z.number().int().optional(),
	outputTokens: z.number().int().optional(),
})

// Output schema - what the API returns
export const CreateEventOutputSchema = z.object({
	eventId: z.uuid(),
	transactionId: z.string(),
})

export const createEventContract = contractBuilder.input(CreateEventInputSchema).output(CreateEventOutputSchema)
