import { Badge } from '@humanlayer/ui/components/badge'
import { ChevronDown } from 'lucide-react'
import type { FC } from 'react'
import { ConversationEventRow, type ConversationEventRowProps } from './conversation-event-row'
import { EventIcon } from './event-icon'
import { AgentPreview } from './agent-preview'
import { AssistantMessageContent } from './message-content'
import type { ConversationEvent, AgentEventGroup } from './types'

export type { AgentEventGroup }

export interface AgentGroupEventRowProps extends Omit<ConversationEventRowProps, 'event' | 'isApproving' | 'isDenying'> {
	group: AgentEventGroup
	isExpanded: boolean
	onToggle: () => void
	toolResultsByKey?: Record<string, ConversationEvent>
	focusedEventId?: string | null
	approvingApprovalId?: string | null
	denyingApprovalId?: string | null
}

export const AgentGroupEventRow: FC<AgentGroupEventRowProps> = ({
	group,
	isExpanded,
	onToggle,
	toolResultsByKey = {},
	isFocused,
	focusedEventId,
	onFocusChange,
	shouldIgnoreMouseEvent,
	approvingApprovalId,
	denyingApprovalId,
	...rowProps
}) => {
	const { parentAgent, subAgentEvents, toolCallCount, latestEvent, hasPendingApproval, finalResponse } = group

	// Parse task input for display
	let displayName = 'Agent'
	let description = ''
	let isNamedSubagent = false
	try {
		const agentInput = JSON.parse(parentAgent.toolInputJson || '{}')
		displayName = agentInput.subagent_type || 'Agent'
		description = agentInput.description || ''
		isNamedSubagent = !!agentInput.subagent_type
	} catch {
		// Ignore parse errors
	}

	return (
		<div className="border-b last:border-b-0">
			{/* Collapsible header */}
			<div
				className={`flex items-start gap-2 p-4 cursor-pointer transition-colors duration-200 ${
					isFocused
						? 'border-l-2 border-l-[var(--terminal-accent)] bg-accent/10'
						: 'border-l-2 border-l-transparent hover:bg-muted/10'
				}`}
				onClick={(e) => {
				e.stopPropagation()
				onToggle()
			}}
				role="button"
				aria-expanded={isExpanded}
				data-event-id={parentAgent.id}
			>
				<ChevronDown className={`w-4 h-4 mt-0.5 transition-transform ${!isExpanded ? '-rotate-90' : ''}`} />

				<EventIcon
					type={parentAgent.eventType}
					toolName={parentAgent.toolName}
					isCompleted={parentAgent.isCompleted}
					isNamedSubagent={isNamedSubagent}
					size="md"
				/>

				<div className="flex-1 min-w-0">
					<div className="flex items-center gap-2">
						<span className="text-sm font-medium text-[var(--terminal-accent)]">{displayName}</span>
						{description && <span className="text-sm text-muted-foreground truncate">{description}</span>}
					</div>

					{/* Status badges */}
					{hasPendingApproval && (
						<div className="flex items-center gap-2 mt-1">
							<Badge
								variant="outline"
								className="text-[var(--terminal-warning)] border-[var(--terminal-warning)]/50 text-xs"
							>
								pending
							</Badge>
						</div>
					)}

					{/* Collapsed preview - show all tool calls with their arguments */}
					{!isExpanded && toolCallCount > 0 && (() => {
						// Get all tool calls to show their names and arguments
						const toolCalls = subAgentEvents.filter(e => e.eventType === 'tool_call')
						const latestToolCall = toolCalls[toolCalls.length - 1]

						// If we don't have a latest tool call but have a latestEvent, use it as fallback
						const eventToShow = latestToolCall || latestEvent

						return eventToShow ? (
							<AgentPreview latestEvent={eventToShow} toolCallCount={toolCallCount} />
						) : null
					})()}
				</div>

				<div className="text-xs text-muted-foreground/60">
					{parentAgent.createdAt && new Date(parentAgent.createdAt).toLocaleTimeString()}
				</div>
			</div>

			{/* Expanded children */}
			{isExpanded && (
				<div className="ml-6 border-l-2 border-muted/20">
					{subAgentEvents
						.filter((e) => e.eventType !== 'tool_result')
						.map((subEvent, index) => (
							<ConversationEventRow
								key={subEvent.id}
								event={subEvent}
								toolResult={subEvent.toolId ? toolResultsByKey[subEvent.toolId] : undefined}
								isLast={index === subAgentEvents.length - 1}
								isGroupItem={true}
								isFocused={focusedEventId === subEvent.id}
								onFocusChange={onFocusChange}
								shouldIgnoreMouseEvent={shouldIgnoreMouseEvent}
								{...rowProps}
								isApproving={approvingApprovalId === subEvent.approvalId}
								isDenying={denyingApprovalId === subEvent.approvalId}
							/>
						))}

					{/* Final assistant response */}
					{finalResponse && (
						<div className="flex items-start gap-2 p-4 border-t border-muted/10">
							<EventIcon type="message" role="assistant" size="md" />
							<div className="flex-1 min-w-0">
								<AssistantMessageContent content={finalResponse} />
							</div>
						</div>
					)}
				</div>
			)}
		</div>
	)
}
