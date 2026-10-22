import { isAgentToolName, type ConversationEvent, type AgentEventGroup } from '../types'

/**
 * Parse Agent tool result content to extract the sub-agent's final response text.
 *
 * Agent tool results come in JSON array format:
 * [{"type":"text","text":"The actual response"},{"type":"text","text":"agentId: ..."}]
 *
 * This extracts the first text block's content that isn't metadata,
 * which is the sub-agent's final message.
 */
function parseAgentResultContent(content: string | undefined): string | undefined {
	if (!content) return undefined

	try {
		const parsed = JSON.parse(content)
		// Handle array format from Claude SDK
		if (Array.isArray(parsed)) {
			// Find the first text block that isn't metadata (agentId, etc.)
			for (const block of parsed) {
				if (block.type === 'text' && block.text && !block.text.startsWith('agentId:')) {
					return block.text
				}
			}
			// Fallback: return first text block if no non-metadata found
			const firstTextBlock = parsed.find((b: { type?: string; text?: string }) => b.type === 'text' && b.text)
			return firstTextBlock?.text
		}
		// If it's already a string (shouldn't happen, but handle gracefully)
		if (typeof parsed === 'string') {
			return parsed
		}
	} catch {
		// If JSON parse fails, return content as-is (it might already be plain text)
		return content
	}

	return undefined
}

export interface BuildAgentGroupsResult {
	agentGroups: Map<string, AgentEventGroup>
	rootEvents: ConversationEvent[]
	hasSubAgents: boolean
}

export function buildAgentGroups(
	events: ConversationEvent[],
	toolResultsByKey?: Record<string, ConversationEvent>
): BuildAgentGroupsResult {
	// Quick check: if no events have parentToolUseId, skip building agent groups
	// Still need to filter out tool_result events from rootEvents
	const hasSubAgents = events.some((e) => e.parentToolUseId)
	if (!hasSubAgents) {
		const rootEvents = events.filter((e) => e.eventType !== 'tool_result')
		return { agentGroups: new Map(), rootEvents, hasSubAgents: false }
	}

	const agentGroups = new Map<string, AgentEventGroup>()
	const rootEvents: ConversationEvent[] = []
	const eventsByParent = new Map<string, ConversationEvent[]>()

	// Single pass to categorize events
	for (const event of events) {
		if (event.parentToolUseId) {
			const siblings = eventsByParent.get(event.parentToolUseId) || []
			siblings.push(event)
			eventsByParent.set(event.parentToolUseId, siblings)
		} else if (event.eventType !== 'tool_result') {
			// tool_result events are matched inline with their tool_call, not rendered as root events
			rootEvents.push(event)
		}
	}

	// Build every agent group, including agent calls made by subagents. Root filtering above
	// still controls the top-level stream; nested groups are reached through their parent's rows.
	for (const event of events) {
		if (isAgentToolName(event.toolName) && event.toolId && eventsByParent.has(event.toolId)) {
			const subEvents = eventsByParent.get(event.toolId)!
			const toolCalls = subEvents.filter((e) => e.eventType === 'tool_call')
			const latestEvent = subEvents[subEvents.length - 1]

			// Extract final response from tool results if agent is completed
			let finalResponse: string | undefined
			if (event.isCompleted && toolResultsByKey && event.toolId) {
				const agentResult = toolResultsByKey[event.toolId]
				if (agentResult?.toolResultContent) {
					finalResponse = parseAgentResultContent(agentResult.toolResultContent)
				}
			}

			agentGroups.set(event.toolId, {
				parentAgent: event,
				subAgentEvents: subEvents,
				toolCallCount: toolCalls.length,
				latestEvent: latestEvent || null,
				hasPendingApproval: subEvents.some((e) => e.approvalStatus === 'pending'),
				finalResponse
			})
		}
	}

	return { agentGroups, rootEvents, hasSubAgents: true }
}
