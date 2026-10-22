import type { ConversationEvent } from '@humanlayer/ui/components/conversation-stream'
import { describe, expect, test } from 'vitest'

import {
	eventsToMinimapEvents,
	isForkExcludedMessage,
	isSyntheticSkillPromptMessage,
	mapSyntheticSkillPromptsToToolResults,
} from './sidebar-transforms'

describe('isSyntheticSkillPromptMessage', () => {
	test('detects Claude Code skill injections', () => {
		expect(isSyntheticSkillPromptMessage('Base directory for this skill: /tmp/.claude/skills/create-plan')).toBe(
			true,
		)
	})

	test('detects CodeLayer skill injections', () => {
		expect(
			isSyntheticSkillPromptMessage(
				'<skill name="rpi:create-plan" baseDir="/tmp/plugin/skills/create-plan">\n---\nname: create-plan',
			),
		).toBe(true)
	})

	test('does not detect ordinary messages mentioning skills', () => {
		expect(isSyntheticSkillPromptMessage('Please use <skill name="rpi:create-plan"> if helpful')).toBe(false)
	})
})

describe('isForkExcludedMessage', () => {
	test('excludes CodeLayer skill injections from fork points', () => {
		expect(isForkExcludedMessage('<skill name="rpi:implement-plan">\n# Skill body')).toBe(true)
	})
})

describe('eventsToMinimapEvents', () => {
	test('filters synthetic skill injection messages', () => {
		const events: ConversationEvent[] = [
			{
				id: 'visible-message',
				sessionId: 'session-1',
				eventType: 'message',
				createdAt: new Date(0),
				role: 'user',
				content: 'Start the plan',
			},
			{
				id: 'synthetic-skill',
				sessionId: 'session-1',
				eventType: 'message',
				createdAt: new Date(1),
				role: 'user',
				content: '<skill name="rpi:create-plan">\n# Skill body',
			},
		]

		expect(eventsToMinimapEvents(events).map((event) => event.id)).toEqual(['visible-message'])
	})
})

describe('mapSyntheticSkillPromptsToToolResults', () => {
	test('maps an immediate synthetic skill prompt onto the preceding Skill tool call', () => {
		const events: ConversationEvent[] = [
			{
				id: 'skill-call-event',
				sessionId: 'session-1',
				eventType: 'tool_call',
				createdAt: new Date(0),
				role: 'assistant',
				toolId: 'skill-tool-1',
				toolName: 'Skill',
				toolInputJson: JSON.stringify({ skill: 'rpi:create-plan' }),
			},
			{
				id: 'synthetic-skill-message',
				sessionId: 'session-1',
				eventType: 'message',
				createdAt: new Date(1),
				role: 'user',
				content: 'Base directory for this skill: /tmp/.claude/skills/create-plan\n# Skill body',
			},
		]

		const result = mapSyntheticSkillPromptsToToolResults(events, {})

		expect(result['skill-tool-1']).toMatchObject({
			eventType: 'tool_result',
			toolResultForId: 'skill-tool-1',
			toolResultContent: events[1].content,
		})
	})

	test('overrides an existing tool result for the skill tool call', () => {
		const existingResult = {
			id: 'existing-result',
			sessionId: 'session-1',
			eventType: 'tool_result',
			createdAt: new Date(2),
			role: 'user',
			toolResultForId: 'skill-tool-1',
			toolResultContent: 'hidden placeholder',
		} satisfies ConversationEvent
		const syntheticPrompt = '<skill name="rpi:create-plan">\n# Skill body'
		const events: ConversationEvent[] = [
			{
				id: 'skill-call-event',
				sessionId: 'session-1',
				eventType: 'tool_call',
				createdAt: new Date(0),
				role: 'assistant',
				toolId: 'skill-tool-1',
				toolName: 'skill',
			},
			{
				id: 'synthetic-skill-message',
				sessionId: 'session-1',
				eventType: 'message',
				createdAt: new Date(1),
				role: 'user',
				content: syntheticPrompt,
			},
		]

		const result = mapSyntheticSkillPromptsToToolResults(events, { 'skill-tool-1': existingResult })

		expect(result['skill-tool-1'].toolResultContent).toBe(syntheticPrompt)
	})

	test('maps a synthetic skill prompt after the placeholder Launching Skill result', () => {
		const syntheticPrompt = 'Base directory for this skill: /tmp/.claude/skills/create-plan\n# Skill body'
		const events: ConversationEvent[] = [
			{
				id: 'skill-call-event',
				sessionId: 'session-1',
				eventType: 'tool_call',
				createdAt: new Date(0),
				role: 'assistant',
				toolId: 'skill-tool-1',
				toolName: 'Skill',
			},
			{
				id: 'placeholder-result',
				sessionId: 'session-1',
				eventType: 'tool_result',
				createdAt: new Date(1),
				role: 'user',
				toolResultForId: 'skill-tool-1',
				toolResultContent: 'Launching Skill',
			},
			{
				id: 'synthetic-skill-message',
				sessionId: 'session-1',
				eventType: 'message',
				createdAt: new Date(2),
				role: 'user',
				content: syntheticPrompt,
			},
		]

		const result = mapSyntheticSkillPromptsToToolResults(events, {
			'skill-tool-1': events[1],
		})

		expect(result['skill-tool-1'].toolResultContent).toBe(syntheticPrompt)
	})

	test('ignores non-immediate synthetic skill prompts', () => {
		const events: ConversationEvent[] = [
			{
				id: 'skill-call-event',
				sessionId: 'session-1',
				eventType: 'tool_call',
				createdAt: new Date(0),
				role: 'assistant',
				toolId: 'skill-tool-1',
				toolName: 'Skill',
			},
			{
				id: 'assistant-message',
				sessionId: 'session-1',
				eventType: 'message',
				createdAt: new Date(1),
				role: 'assistant',
				content: 'Working on it',
			},
			{
				id: 'synthetic-skill-message',
				sessionId: 'session-1',
				eventType: 'message',
				createdAt: new Date(2),
				role: 'user',
				content: 'Base directory for this skill: /tmp/.claude/skills/create-plan',
			},
		]

		expect(mapSyntheticSkillPromptsToToolResults(events, {})).toEqual({})
	})
})
