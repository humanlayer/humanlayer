import { describe, expect, test } from 'vitest'

import {
	MAX_TOOL_TEXT_CHARS,
	MAX_TRANSCRIPT_CHARS,
	renderConversationTranscript,
	type TranscriptEvent,
	truncateMiddle,
} from './render-conversation-transcript'

function message(role: string, content: string): TranscriptEvent {
	return { event_type: 'message', role, content, tool_name: null, tool_input_json: null, tool_result_content: null }
}

function toolResult(content: string): TranscriptEvent {
	return {
		event_type: 'tool_result',
		role: null,
		content: null,
		tool_name: null,
		tool_input_json: null,
		tool_result_content: content,
	}
}

const events: TranscriptEvent[] = [
	{
		event_type: 'message',
		role: 'user',
		content: 'Fix the auth bug',
		tool_name: null,
		tool_input_json: null,
		tool_result_content: null,
	},
	{
		event_type: 'message',
		role: 'assistant',
		content: 'Reading the file',
		tool_name: null,
		tool_input_json: null,
		tool_result_content: null,
	},
	{
		event_type: 'tool_call',
		role: 'assistant',
		content: null,
		tool_name: 'Read',
		tool_input_json: { file_path: '/auth.ts' },
		tool_result_content: null,
	},
	{
		event_type: 'tool_result',
		role: null,
		content: null,
		tool_name: null,
		tool_input_json: null,
		tool_result_content: 'export function auth() {}',
	},
	{
		event_type: 'message',
		role: 'assistant',
		content: 'Done',
		tool_name: null,
		tool_input_json: null,
		tool_result_content: null,
	},
]

describe('renderConversationTranscript', () => {
	test('renders user and assistant messages in order with tool calls off', () => {
		const transcript = renderConversationTranscript(events, { includeToolCalls: false })

		expect(transcript).toBe('## User\nFix the auth bug\n\n## Assistant\nReading the file\n\n## Assistant\nDone')
		expect(transcript).not.toContain('Tool call')
		expect(transcript).not.toContain('/auth.ts')
	})

	test('includes tool calls and results when enabled', () => {
		const transcript = renderConversationTranscript(events, { includeToolCalls: true })

		expect(transcript).toContain('### Tool call: Read')
		expect(transcript).toContain('"file_path": "/auth.ts"')
		expect(transcript).toContain('### Tool result\nexport function auth() {}')
	})

	test('skips empty message content', () => {
		const transcript = renderConversationTranscript(
			[
				{
					event_type: 'message',
					role: 'user',
					content: '   ',
					tool_name: null,
					tool_input_json: null,
					tool_result_content: null,
				},
				{
					event_type: 'message',
					role: 'assistant',
					content: 'Only this',
					tool_name: null,
					tool_input_json: null,
					tool_result_content: null,
				},
			],
			{ includeToolCalls: true },
		)

		expect(transcript).toBe('## Assistant\nOnly this')
	})

	test('labels thinking events distinctly', () => {
		const transcript = renderConversationTranscript(
			[
				{
					event_type: 'thinking',
					role: 'assistant',
					content: 'Let me plan',
					tool_name: null,
					tool_input_json: null,
					tool_result_content: null,
				},
			],
			{ includeToolCalls: false },
		)

		expect(transcript).toBe('## Assistant (thinking)\nLet me plan')
	})

	test('truncates a long tool result, keeping head and tail', () => {
		const result = `HEAD${'x'.repeat(MAX_TOOL_TEXT_CHARS * 2)}TAIL`
		const transcript = renderConversationTranscript([toolResult(result)], { includeToolCalls: true })

		expect(transcript.startsWith('### Tool result\nHEAD')).toBe(true)
		expect(transcript.endsWith('TAIL')).toBe(true)
		expect(transcript).toMatch(/\[… \d+ characters omitted …\]/)
		expect(transcript.length).toBeLessThanOrEqual('### Tool result\n'.length + MAX_TOOL_TEXT_CHARS)
	})

	test('truncates a long tool input', () => {
		const transcript = renderConversationTranscript(
			[
				{
					event_type: 'tool_call',
					role: 'assistant',
					content: null,
					tool_name: 'Write',
					tool_input_json: { content: 'y'.repeat(500) },
					tool_result_content: null,
				},
			],
			{ includeToolCalls: true, maxToolTextChars: 100 },
		)

		expect(transcript).toContain('### Tool call: Write')
		expect(transcript).toMatch(/\[… \d+ characters omitted …\]/)
		expect(transcript.length).toBeLessThanOrEqual('### Tool call: Write\n'.length + 100)
	})

	test('leaves short tool text untouched', () => {
		expect(truncateMiddle('short', MAX_TOOL_TEXT_CHARS)).toBe('short')
	})

	test('caps the total transcript, keeping the opening request and the most recent turns', () => {
		const turns = Array.from({ length: 50 }, (_, index) => message('assistant', `turn ${index} ${'z'.repeat(80)}`))
		const transcript = renderConversationTranscript([message('user', 'Original request'), ...turns], {
			includeToolCalls: false,
			maxTranscriptChars: 1_000,
		})

		expect(transcript.length).toBeLessThanOrEqual(1_000)
		expect(transcript.startsWith('## User\nOriginal request')).toBe(true)
		expect(transcript).toMatch(/\[… \d+ earlier entries omitted …\]/)
		expect(transcript).toContain('turn 49 ')
		expect(transcript).not.toContain('turn 0 ')
	})

	test('truncates the latest block when it alone exceeds the budget', () => {
		const transcript = renderConversationTranscript(
			[message('user', 'Original request'), message('assistant', `START${'q'.repeat(5_000)}END`)],
			{ includeToolCalls: false, maxTranscriptChars: 1_000 },
		)

		expect(transcript.length).toBeLessThanOrEqual(1_000)
		expect(transcript).toContain('Original request')
		expect(transcript).toContain('## Assistant\nSTART')
		expect(transcript.endsWith('END')).toBe(true)
		expect(transcript).toMatch(/\[… \d+ characters omitted …\]/)
	})

	test('leaves a transcript under the default cap untouched', () => {
		const transcript = renderConversationTranscript(events, { includeToolCalls: true })

		expect(transcript.length).toBeLessThan(MAX_TRANSCRIPT_CHARS)
		expect(transcript).not.toContain('omitted')
	})
})
