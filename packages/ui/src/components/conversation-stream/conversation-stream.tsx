import { cn } from '@humanlayer/ui/lib/utils'
import type { FC } from 'react'
import { ConversationEventRow } from './conversation-event-row'
import { AgentGroupEventRow, type AgentEventGroup } from './agent-group-event-row'
import type { ConversationEvent } from './types'

export interface ConversationStreamProps {
	events: ConversationEvent[]
	agentGroups?: Map<string, AgentEventGroup>
	toolResultsByKey?: Record<string, ConversationEvent>
	workingDir?: string

	// Focus state
	focusedEventId?: string | null
	onFocusChange?: (eventId: string | null, source: 'mouse' | 'keyboard') => void
	shouldIgnoreMouseEvent?: () => boolean

	// Task expansion
	expandedAgents?: Set<string>
	onToggleAgentGroup?: (agentId: string) => void

	// Modal expansion
	onRequestModal?: (toolCall: ConversationEvent, toolResult?: ConversationEvent) => void

	// File operations
	onOpenFile?: (filePath: string) => void

	// Approval handlers
	onApprove?: (approvalId: string) => void
	onDeny?: (approvalId: string, reason: string) => void
	onStartDeny?: (approvalId: string) => void
	onCancelDeny?: () => void
	/** Called when DENY button is clicked in denying mode */
	onSubmitDeny?: () => void
	approvingApprovalId?: string | null
	denyingApprovalId?: string | null
	/** Whether there's text in the denial feedback input (enables DENY button) */
	hasDenyFeedback?: boolean

	// Copy handler for message content
	onCopy?: (content: string) => void

	// Styling
	className?: string
}

export const ConversationStream: FC<ConversationStreamProps> = ({
	events,
	agentGroups = new Map(),
	toolResultsByKey = {},
	workingDir,
	focusedEventId,
	onFocusChange,
	shouldIgnoreMouseEvent,
	expandedAgents = new Set(),
	onToggleAgentGroup,
	onRequestModal,
	onOpenFile,
	onApprove,
	onDeny,
	onStartDeny,
	onCancelDeny,
	onSubmitDeny,
	approvingApprovalId,
	denyingApprovalId,
	hasDenyFeedback = false,
	onCopy,
	className,
}) => {
	// Filter out tool results (they're matched inline) and get root events
	const hasSubAgents = agentGroups.size > 0
	const rootEvents = hasSubAgents
		? events.filter((e) => !e.parentToolUseId && e.eventType !== 'tool_result')
		: events.filter((e) => e.eventType !== 'tool_result')

	return (
		<div className={cn('flex flex-col overflow-y-auto', className)} data-conversation-container>
			{rootEvents.map((event, index) => {
				const agentGroup = event.toolId ? agentGroups.get(event.toolId) : undefined

				if (agentGroup) {
					return (
						<AgentGroupEventRow
							key={event.id}
							group={agentGroup}
							isExpanded={expandedAgents.has(event.toolId!)}
							onToggle={() => onToggleAgentGroup?.(event.toolId!)}
							toolResultsByKey={toolResultsByKey}
							isFocused={focusedEventId === event.id}
							focusedEventId={focusedEventId}
							workingDir={workingDir}
							onFocusChange={onFocusChange}
							shouldIgnoreMouseEvent={shouldIgnoreMouseEvent}
							onRequestModal={onRequestModal}
							onOpenFile={onOpenFile}
							onApprove={onApprove}
							onDeny={onDeny}
							onStartDeny={onStartDeny}
							onCancelDeny={onCancelDeny}
							onSubmitDeny={onSubmitDeny}
							approvingApprovalId={approvingApprovalId}
							denyingApprovalId={denyingApprovalId}
							hasDenyFeedback={hasDenyFeedback}
							onCopy={onCopy}
						/>
					)
				}

				return (
					<ConversationEventRow
						key={event.id}
						event={event}
						toolResult={event.toolId ? toolResultsByKey[event.toolId] : undefined}
						isFocused={focusedEventId === event.id}
						isLast={index === rootEvents.length - 1}
						workingDir={workingDir}
						onFocusChange={onFocusChange}
						shouldIgnoreMouseEvent={shouldIgnoreMouseEvent}
						onRequestModal={onRequestModal}
						onOpenFile={onOpenFile}
						onApprove={onApprove}
						onDeny={onDeny}
						onStartDeny={onStartDeny}
						onCancelDeny={onCancelDeny}
						onSubmitDeny={onSubmitDeny}
						isApproving={approvingApprovalId === event.approvalId}
						isDenying={denyingApprovalId === event.approvalId}
						hasDenyFeedback={hasDenyFeedback}
						onCopy={onCopy}
					/>
				)
			})}
		</div>
	)
}
