import type { ConversationEvent } from '@humanlayer/ui/components/conversation-stream'
import { describe, expect, test } from 'vitest'

import { getLatestInvokedRpiPhase } from './phase-tips'

function toolCall(overrides: Partial<ConversationEvent> = {}): ConversationEvent {
	return {
		id: 'event-1',
		sessionId: 'session-1',
		eventType: 'tool_call',
		createdAt: new Date(0),
		toolName: 'Skill',
		toolInputJson: JSON.stringify({ skill: 'rpi:create-research' }),
		...overrides,
	}
}

describe('getLatestInvokedRpiPhase', () => {
	test('derives the phase from an RPI Skill tool call', () => {
		expect(getLatestInvokedRpiPhase([toolCall()])).toBe('research')
	})

	test('supports lowercase tool names and name-based skill input', () => {
		expect(
			getLatestInvokedRpiPhase([
				toolCall({ toolName: 'skill', toolInputJson: JSON.stringify({ name: 'rpi:implement-plan' }) }),
			]),
		).toBe('implementation')
	})

	test('returns the phase from the latest RPI skill invocation', () => {
		expect(
			getLatestInvokedRpiPhase([
				toolCall(),
				toolCall({ id: 'event-2', toolInputJson: JSON.stringify({ skill: 'rpi:create-prd' }) }),
			]),
		).toBe('design-prd')
	})

	test('ignores messages, malformed input, and non-RPI skills', () => {
		expect(
			getLatestInvokedRpiPhase([
				toolCall({ eventType: 'message' }),
				toolCall({ id: 'event-2', toolInputJson: '{' }),
				toolCall({ id: 'event-3', toolInputJson: JSON.stringify({ skill: 'show-me' }) }),
			]),
		).toBeNull()
	})
})
