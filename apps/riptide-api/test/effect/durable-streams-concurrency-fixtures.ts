import type { ConversationEvent } from '@humanlayer/db/tables/conversation-events'
import type { StreamEvent } from '@humanlayer/streams/events'
import { uuidv7 } from 'uuidv7'
import { vi } from 'vitest'

export type StreamStateEvent = {
	type: StreamEvent['type']
	key: string
	value: StreamEvent
}

export function installSyncAuthMock() {
	vi.doMock('../../src/db/sync-auth', () => ({
		buildConversationEventsSyncWhere: () => undefined,
	}))
}

export function createHydratedConversationEvent(overrides: Partial<ConversationEvent> = {}): ConversationEvent {
	const now = BigInt(Date.now())
	return {
		id: uuidv7(),
		coding_agent_event_id: null,
		session_id: uuidv7(),
		organization_id: uuidv7(),
		resource_owner_user_id: 'durable-stream-concurrency-user',
		task_id: null,
		coding_agent_session_id: null,
		event_type: 'message',
		role: 'assistant',
		content: 'streamed from history',
		tool_call_id: null,
		tool_name: null,
		tool_input_json: null,
		parent_tool_use_id: null,
		tool_result_for_id: null,
		tool_result_content: null,
		approval_status: null,
		approval_id: null,
		user_id: null,
		user_name: null,
		next_step_suggestion: null,
		input_tokens: null,
		output_tokens: null,
		run_index: null,
		created_at: now,
		updated_at: now,
		...overrides,
	}
}

export function createConversationEventsDb(rows: ConversationEvent[]) {
	return {
		select: () => ({
			from: () => ({
				where: () => ({
					orderBy: async () => rows,
				}),
			}),
		}),
	}
}
