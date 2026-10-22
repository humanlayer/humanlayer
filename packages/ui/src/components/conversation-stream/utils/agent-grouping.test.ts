import { describe, expect, it } from 'vitest'
import { buildAgentGroups } from './agent-grouping'
import type { ConversationEvent } from '../types'

describe('buildAgentGroups', () => {
	it('should return empty groups when no sub-agents exist', () => {
		const events: ConversationEvent[] = [
			{
				id: '1',
				sessionId: 'test',
				eventType: 'message',
				createdAt: new Date(),
				role: 'user',
				content: 'Hello'
			}
		]

		const result = buildAgentGroups(events)

		expect(result.hasSubAgents).toBe(false)
		expect(result.agentGroups.size).toBe(0)
		expect(result.rootEvents).toEqual(events)
	})

	it('should group sub-agents under parent Task', () => {
		const parentAgent: ConversationEvent = {
			id: '1',
			sessionId: 'test',
			eventType: 'tool_call',
			createdAt: new Date(),
			toolName: 'Task',
			toolId: 'task-1',
			isCompleted: false
		}

		const subAgent: ConversationEvent = {
			id: '2',
			sessionId: 'test',
			eventType: 'tool_call',
			createdAt: new Date(),
			toolName: 'Read',
			parentToolUseId: 'task-1'
		}

		const events = [parentAgent, subAgent]
		const result = buildAgentGroups(events)

		expect(result.hasSubAgents).toBe(true)
		expect(result.agentGroups.size).toBe(1)
		expect(result.agentGroups.get('task-1')).toBeDefined()
		expect(result.agentGroups.get('task-1')?.subAgentEvents).toContain(subAgent)
	})

	it('should group sub-agents under parent Agent (new SDK tool name)', () => {
		const parentAgent: ConversationEvent = {
			id: '1',
			sessionId: 'test',
			eventType: 'tool_call',
			createdAt: new Date(),
			toolName: 'Agent',
			toolId: 'agent-1',
			isCompleted: false
		}

		const subAgent: ConversationEvent = {
			id: '2',
			sessionId: 'test',
			eventType: 'tool_call',
			createdAt: new Date(),
			toolName: 'Read',
			parentToolUseId: 'agent-1'
		}

		const events = [parentAgent, subAgent]
		const result = buildAgentGroups(events)

		expect(result.hasSubAgents).toBe(true)
		expect(result.agentGroups.size).toBe(1)
		expect(result.agentGroups.get('agent-1')).toBeDefined()
		expect(result.agentGroups.get('agent-1')?.subAgentEvents).toContain(subAgent)
	})

	it('should extract final response from completed task', () => {
		const parentAgent: ConversationEvent = {
			id: '1',
			sessionId: 'test',
			eventType: 'tool_call',
			createdAt: new Date(),
			toolName: 'Task',
			toolId: 'task-1',
			isCompleted: true
		}

		const subAgent: ConversationEvent = {
			id: '2',
			sessionId: 'test',
			eventType: 'tool_call',
			createdAt: new Date(),
			toolName: 'Read',
			parentToolUseId: 'task-1'
		}

		const agentResult: ConversationEvent = {
			id: '3',
			sessionId: 'test',
			eventType: 'tool_result',
			createdAt: new Date(),
			toolResultForId: 'task-1',
			toolResultContent: 'Task completed successfully with findings.'
		}

		const events = [parentAgent, subAgent]
		const toolResultsByKey = { 'task-1': agentResult }

		const result = buildAgentGroups(events, toolResultsByKey)

		expect(result.agentGroups.get('task-1')?.finalResponse).toBe('Task completed successfully with findings.')
	})

	it('should not include final response for incomplete tasks', () => {
		const parentAgent: ConversationEvent = {
			id: '1',
			sessionId: 'test',
			eventType: 'tool_call',
			createdAt: new Date(),
			toolName: 'Task',
			toolId: 'task-1',
			isCompleted: false  // Not completed
		}

		const agentResult: ConversationEvent = {
			id: '2',
			sessionId: 'test',
			eventType: 'tool_result',
			createdAt: new Date(),
			toolResultForId: 'task-1',
			toolResultContent: 'Some content'
		}

		const events = [parentAgent]
		const toolResultsByKey = { 'task-1': agentResult }

		const result = buildAgentGroups(events, toolResultsByKey)

		expect(result.agentGroups.get('task-1')?.finalResponse).toBeUndefined()
	})

	it('should handle multiple tasks with different states', () => {
		const task1: ConversationEvent = {
			id: '1',
			sessionId: 'test',
			eventType: 'tool_call',
			createdAt: new Date(),
			toolName: 'Task',
			toolId: 'task-1',
			isCompleted: true
		}

		const task2: ConversationEvent = {
			id: '2',
			sessionId: 'test',
			eventType: 'tool_call',
			createdAt: new Date(),
			toolName: 'Task',
			toolId: 'task-2',
			isCompleted: false
		}

		const subAgent1: ConversationEvent = {
			id: '3',
			sessionId: 'test',
			eventType: 'tool_call',
			createdAt: new Date(),
			parentToolUseId: 'task-1'
		}

		const subAgent2: ConversationEvent = {
			id: '4',
			sessionId: 'test',
			eventType: 'tool_call',
			createdAt: new Date(),
			parentToolUseId: 'task-2'
		}

		const events = [task1, task2, subAgent1, subAgent2]
		const toolResultsByKey = {
			'task-1': {
				id: '5',
				sessionId: 'test',
				eventType: 'tool_result',
				createdAt: new Date(),
				toolResultContent: 'Task 1 complete'
			},
			'task-2': {
				id: '6',
				sessionId: 'test',
				eventType: 'tool_result',
				createdAt: new Date(),
				toolResultContent: 'Task 2 result'
			}
		} as Record<string, ConversationEvent>

		const result = buildAgentGroups(events, toolResultsByKey)

		expect(result.agentGroups.size).toBe(2)
		expect(result.agentGroups.get('task-1')?.finalResponse).toBe('Task 1 complete')
		expect(result.agentGroups.get('task-2')?.finalResponse).toBeUndefined() // Not completed
	})

	it('should handle agents with pending approvals', () => {
		const parentAgent: ConversationEvent = {
			id: '1',
			sessionId: 'test',
			eventType: 'tool_call',
			createdAt: new Date(),
			toolName: 'Task',
			toolId: 'task-1',
			isCompleted: false
		}

		const pendingSubTask: ConversationEvent = {
			id: '2',
			sessionId: 'test',
			eventType: 'tool_call',
			createdAt: new Date(),
			parentToolUseId: 'task-1',
			approvalStatus: 'pending'
		}

		const events = [parentAgent, pendingSubTask]
		const result = buildAgentGroups(events)

		expect(result.agentGroups.get('task-1')?.hasPendingApproval).toBe(true)
	})

	it('should handle tasks without sub-events', () => {
		const parentAgent: ConversationEvent = {
			id: '1',
			sessionId: 'test',
			eventType: 'tool_call',
			createdAt: new Date(),
			toolName: 'Task',
			toolId: 'task-1',
			isCompleted: false
		}

		const events = [parentAgent]
		const result = buildAgentGroups(events)

		expect(result.hasSubAgents).toBe(false)
		expect(result.agentGroups.size).toBe(0)
		expect(result.rootEvents).toContain(parentAgent)
	})

	it('should calculate tool call count correctly', () => {
		const parentAgent: ConversationEvent = {
			id: '1',
			sessionId: 'test',
			eventType: 'tool_call',
			createdAt: new Date(),
			toolName: 'Task',
			toolId: 'task-1',
			isCompleted: false
		}

		const toolCall1: ConversationEvent = {
			id: '2',
			sessionId: 'test',
			eventType: 'tool_call',
			createdAt: new Date(),
			toolName: 'Read',
			parentToolUseId: 'task-1'
		}

		const toolCall2: ConversationEvent = {
			id: '3',
			sessionId: 'test',
			eventType: 'tool_call',
			createdAt: new Date(),
			toolName: 'Write',
			parentToolUseId: 'task-1'
		}

		const toolResult: ConversationEvent = {
			id: '4',
			sessionId: 'test',
			eventType: 'tool_result',
			createdAt: new Date(),
			parentToolUseId: 'task-1'
		}

		const events = [parentAgent, toolCall1, toolCall2, toolResult]
		const result = buildAgentGroups(events)

		expect(result.agentGroups.get('task-1')?.toolCallCount).toBe(2)
	})

	it('should identify latest event correctly', () => {
		const parentAgent: ConversationEvent = {
			id: '1',
			sessionId: 'test',
			eventType: 'tool_call',
			createdAt: new Date(),
			toolName: 'Task',
			toolId: 'task-1',
			isCompleted: false
		}

		const firstEvent: ConversationEvent = {
			id: '2',
			sessionId: 'test',
			eventType: 'tool_call',
			createdAt: new Date(),
			toolName: 'Read',
			parentToolUseId: 'task-1'
		}

		const lastEvent: ConversationEvent = {
			id: '3',
			sessionId: 'test',
			eventType: 'tool_result',
			createdAt: new Date(),
			parentToolUseId: 'task-1'
		}

		const events = [parentAgent, firstEvent, lastEvent]
		const result = buildAgentGroups(events)

		expect(result.agentGroups.get('task-1')?.latestEvent).toBe(lastEvent)
	})

	it('builds nested agent groups for agent calls made by subagents', () => {
		const rootAgent: ConversationEvent = {
			id: 'root-agent-event',
			sessionId: 'test',
			eventType: 'tool_call',
			createdAt: new Date(),
			toolName: 'agent',
			toolId: 'root-agent-call'
		}
		const nestedAgent: ConversationEvent = {
			id: 'nested-agent-event',
			sessionId: 'test',
			eventType: 'tool_call',
			createdAt: new Date(),
			toolName: 'agent',
			toolId: 'nested-agent-call',
			parentToolUseId: 'root-agent-call'
		}
		const grandchildThinking: ConversationEvent = {
			id: 'grandchild-thinking',
			sessionId: 'test',
			eventType: 'thinking',
			role: 'assistant',
			content: 'nested reasoning',
			createdAt: new Date(),
			parentToolUseId: 'nested-agent-call'
		}
		const grandchildMessage: ConversationEvent = {
			id: 'grandchild-message',
			sessionId: 'test',
			eventType: 'message',
			role: 'assistant',
			content: 'nested result',
			createdAt: new Date(),
			parentToolUseId: 'nested-agent-call'
		}

		const result = buildAgentGroups([rootAgent, nestedAgent, grandchildThinking, grandchildMessage])

		expect(result.rootEvents).toEqual([rootAgent])
		expect(result.agentGroups.get('root-agent-call')?.subAgentEvents).toEqual([nestedAgent])
		expect(result.agentGroups.get('nested-agent-call')?.subAgentEvents).toEqual([
			grandchildThinking,
			grandchildMessage
		])
		expect(result.agentGroups.get('nested-agent-call')?.toolCallCount).toBe(0)
	})

	it('should not extract final response when toolResultsByKey is not provided', () => {
		const parentAgent: ConversationEvent = {
			id: '1',
			sessionId: 'test',
			eventType: 'tool_call',
			createdAt: new Date(),
			toolName: 'Task',
			toolId: 'task-1',
			isCompleted: true
		}

		const subAgent: ConversationEvent = {
			id: '2',
			sessionId: 'test',
			eventType: 'tool_call',
			createdAt: new Date(),
			parentToolUseId: 'task-1'
		}

		const events = [parentAgent, subAgent]
		const result = buildAgentGroups(events) // No toolResultsByKey

		expect(result.agentGroups.get('task-1')?.finalResponse).toBeUndefined()
	})

	it('should not extract final response when task result is empty', () => {
		const parentAgent: ConversationEvent = {
			id: '1',
			sessionId: 'test',
			eventType: 'tool_call',
			createdAt: new Date(),
			toolName: 'Task',
			toolId: 'task-1',
			isCompleted: true
		}

		const subAgent: ConversationEvent = {
			id: '2',
			sessionId: 'test',
			eventType: 'tool_call',
			createdAt: new Date(),
			parentToolUseId: 'task-1'
		}

		const agentResult: ConversationEvent = {
			id: '3',
			sessionId: 'test',
			eventType: 'tool_result',
			createdAt: new Date(),
			toolResultForId: 'task-1',
			toolResultContent: undefined // Empty content
		}

		const events = [parentAgent, subAgent]
		const toolResultsByKey = { 'task-1': agentResult }

		const result = buildAgentGroups(events, toolResultsByKey)

		expect(result.agentGroups.get('task-1')?.finalResponse).toBeUndefined()
	})
})
