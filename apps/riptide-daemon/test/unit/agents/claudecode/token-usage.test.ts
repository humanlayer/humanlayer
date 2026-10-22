import { describe, expect, test } from 'vitest'

import { getMessageIdFromMessage, getTokenUsageFromMessage } from '../../../../src/agents/claudecode/token-usage'

/**
 * Builds a minimal SDKAssistantMessage-shaped object. During parallel tool
 * use the Claude Agent SDK emits multiple assistant messages whose nested API
 * message shares the same `id` and carries identical `usage`; processClaudeEvents
 * dedupes token counting by that id.
 * See: https://platform.claude.com/docs/en/agent-sdk/cost-tracking
 */
function makeAssistantMessage(messageId: string, usage: Record<string, number>, uuid = `uuid-${Math.random()}`) {
	return {
		type: 'assistant',
		uuid,
		parent_tool_use_id: null,
		session_id: 'sdk-session-123',
		message: {
			id: messageId,
			role: 'assistant',
			content: [{ type: 'tool_use', id: `tool-${uuid}`, name: 'Read', input: {} }],
			usage,
		},
	}
}

const USAGE = {
	input_tokens: 100,
	output_tokens: 50,
	cache_read_input_tokens: 10,
	cache_creation_input_tokens: 5,
}

// inputTokens = input + cache_read + cache_creation = 100 + 10 + 5
const EXPECTED_INPUT_TOKENS = 115
const EXPECTED_OUTPUT_TOKENS = 50

describe('getMessageIdFromMessage', () => {
	test('extracts the inner message id', () => {
		expect(getMessageIdFromMessage(makeAssistantMessage('msg_abc', USAGE))).toBe('msg_abc')
	})

	test('returns undefined when there is no inner message', () => {
		expect(getMessageIdFromMessage({ type: 'result', usage: USAGE })).toBeUndefined()
	})

	test('returns undefined for non-string ids and non-object messages', () => {
		expect(getMessageIdFromMessage({ message: { id: 123 } })).toBeUndefined()
		expect(getMessageIdFromMessage(null)).toBeUndefined()
		expect(getMessageIdFromMessage('string')).toBeUndefined()
	})
})

describe('getTokenUsageFromMessage', () => {
	test('extracts combined usage from an assistant message', () => {
		expect(getTokenUsageFromMessage(makeAssistantMessage('msg_abc', USAGE))).toEqual({
			inputTokens: EXPECTED_INPUT_TOKENS,
			outputTokens: EXPECTED_OUTPUT_TOKENS,
			contextWindowTokens: EXPECTED_INPUT_TOKENS + EXPECTED_OUTPUT_TOKENS,
		})
	})

	test('reads top-level usage for result-shaped messages without an inner message', () => {
		expect(getTokenUsageFromMessage({ type: 'result', usage: USAGE })?.inputTokens).toBe(EXPECTED_INPUT_TOKENS)
	})

	test('returns null when the message has no usage', () => {
		const noUsage = {
			type: 'assistant',
			uuid: 'uuid-1',
			parent_tool_use_id: null,
			message: { id: 'msg_no_usage', role: 'assistant', content: [] },
		}
		expect(getTokenUsageFromMessage(noUsage)).toBeNull()
	})
})
