import {
	type ConversationEvent,
	EventIcon,
	StatusBadge,
	type AgentEventGroup,
	AgentPreview,
} from '@humanlayer/ui/components/conversation-stream'
import { Tooltip, TooltipContent, TooltipTrigger } from '@humanlayer/ui/components/tooltip'
import { formatCompactRelativeTime, formatLocalAbsoluteTime } from '@humanlayer/ui/lib/time-format'
import { ChevronDown } from 'lucide-react'
import type { FC, ReactNode } from 'react'

import { AssistantMessageContent } from './AssistantMessageContent'
import { ConversationEventRow, type ConversationEventRowProps } from './ConversationEventRow'

export type { AgentEventGroup }

export interface AgentGroupEventRowProps extends Omit<
	ConversationEventRowProps,
	'event' | 'isApproving' | 'isDenying'
> {
	group: AgentEventGroup
	isExpanded: boolean
	onToggle: () => void
	toolResultsByKey: Record<string, ConversationEvent>
	focusedEventId: string | null
	approvingApprovalId: string | null
	denyingApprovalId: string | null
	isInterrupted: boolean
	isSessionActive: boolean
	isCurrentTurn: boolean
	renderChildren: boolean
}

/** Parse the agent tool input JSON, falling back to safe defaults on error. */
function parseAgentInput(toolInputJson: string | undefined | null): {
	displayName: string
	description: string
	isNamedSubagent: boolean
} {
	try {
		const agentInput = JSON.parse(toolInputJson || '{}')
		return {
			displayName: agentInput.subagent_type || 'Agent',
			description: agentInput.description || '',
			isNamedSubagent: !!agentInput.subagent_type,
		}
	} catch {
		return { displayName: 'Agent', description: '', isNamedSubagent: false }
	}
}

/** Priority-ordered status badge: interrupted > pending > running. */
function getStatusBadge({
	showInterrupted,
	hasPendingApproval,
	isRunning,
}: {
	showInterrupted: boolean
	hasPendingApproval: boolean
	isRunning: boolean
}): ReactNode {
	if (showInterrupted) return <StatusBadge status="interrupted" />
	if (hasPendingApproval) return <StatusBadge status="pending" />
	if (isRunning) return <StatusBadge status="groupRunning" />
	return null
}

/** Collapsed tool-call preview — shows the most recent tool call name/args. */
function CollapsedAgentPreview({
	toolCallCount,
	subAgentEvents,
	latestEvent,
}: {
	toolCallCount: number
	subAgentEvents: ConversationEvent[]
	latestEvent: ConversationEvent | null
}) {
	if (toolCallCount === 0) return null
	const toolCalls = subAgentEvents.filter((e) => e.eventType === 'tool_call')
	const latestToolCall = toolCalls[toolCalls.length - 1]
	// Use most recent tool call; fall back to latestEvent when no tool calls yet.
	const eventToShow = latestToolCall || latestEvent
	if (!eventToShow) return null
	return <AgentPreview latestEvent={eventToShow} toolCallCount={toolCallCount} />
}

/** Relative-time tooltip for an event's createdAt timestamp. */
function EventTimestamp({ createdAt }: { createdAt: Date | null | undefined }) {
	if (!createdAt) return null
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<div className="cursor-help text-xs text-muted-foreground/60">
					{formatCompactRelativeTime(createdAt)}
				</div>
			</TooltipTrigger>
			<TooltipContent>{formatLocalAbsoluteTime(createdAt)}</TooltipContent>
		</Tooltip>
	)
}

/** Expanded sub-event rows and optional final assistant response. */
function ExpandedChildren({
	subAgentEvents,
	toolResultsByKey,
	focusedEventId,
	approvingApprovalId,
	denyingApprovalId,
	finalResponse,
	onFocusChange,
	shouldIgnoreMouseEvent,
	rowProps,
}: {
	subAgentEvents: ConversationEvent[]
	toolResultsByKey: Record<string, ConversationEvent>
	focusedEventId?: string | null
	approvingApprovalId?: string | null
	denyingApprovalId?: string | null
	finalResponse: string | null | undefined
	onFocusChange: ConversationEventRowProps['onFocusChange']
	shouldIgnoreMouseEvent: ConversationEventRowProps['shouldIgnoreMouseEvent']
	rowProps: Omit<
		ConversationEventRowProps,
		'event' | 'isApproving' | 'isDenying' | 'isFocused' | 'onFocusChange' | 'shouldIgnoreMouseEvent'
	>
}) {
	return (
		<div className="ml-6 border-l-2 border-muted/20">
			{subAgentEvents
				.filter((e) => e.eventType !== 'tool_result')
				.map((subEvent) => (
					<ConversationEventRow
						key={subEvent.id}
						event={subEvent}
						toolResult={subEvent.toolId ? toolResultsByKey[subEvent.toolId] : undefined}
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
	)
}

export const AgentGroupEventRow: FC<AgentGroupEventRowProps> = ({
	group,
	isExpanded,
	onToggle,
	toolResultsByKey,
	isFocused,
	focusedEventId,
	onFocusChange,
	shouldIgnoreMouseEvent,
	approvingApprovalId,
	denyingApprovalId,
	isInterrupted,
	isSessionActive,
	isCurrentTurn,
	renderChildren,
	...rowProps
}) => {
	const { parentAgent, subAgentEvents, toolCallCount, latestEvent, hasPendingApproval, finalResponse } = group
	const isRunning = !parentAgent.isCompleted && isSessionActive && isCurrentTurn
	const showInterrupted = !parentAgent.isCompleted && isInterrupted && isCurrentTurn
	const isEventCompleted = parentAgent.isCompleted || showInterrupted || (!isRunning && !hasPendingApproval)
	const { displayName, description, isNamedSubagent } = parseAgentInput(parentAgent.toolInputJson)
	const statusBadge = getStatusBadge({ showInterrupted, hasPendingApproval, isRunning })
	const headerBorder = isFocused
		? 'border-l-[var(--terminal-accent)] bg-accent/5'
		: 'border-l-transparent hover:bg-muted/10'

	return (
		<div>
			{/* Collapsible header */}
			<div
				className={`flex items-start gap-2 p-4 cursor-pointer transition-colors duration-200 border-l-2 ${headerBorder}`}
				onClick={(e) => {
					e.stopPropagation()
					onToggle()
				}}
				role="button"
				aria-expanded={isExpanded}
				data-event-id={parentAgent.id}
			>
				<ChevronDown className={`w-4 h-4 mt-0.5 transition-transform ${isExpanded ? '' : '-rotate-90'}`} />

				<EventIcon
					type={parentAgent.eventType}
					toolName={parentAgent.toolName}
					isCompleted={isEventCompleted}
					isNamedSubagent={isNamedSubagent}
					size="md"
				/>

				<div className="flex-1 min-w-0">
					<div className="flex items-center gap-2">
						<span className="text-sm font-medium text-[var(--terminal-accent)]">{displayName}</span>
						{description && <span className="text-sm text-muted-foreground truncate">{description}</span>}
						{/* Status badges — interrupted > pending > running */}
						{statusBadge}
					</div>

					{/* Collapsed preview - show all tool calls with their arguments */}
					{!isExpanded && (
						<CollapsedAgentPreview
							toolCallCount={toolCallCount}
							subAgentEvents={subAgentEvents}
							latestEvent={latestEvent}
						/>
					)}
				</div>

				<EventTimestamp createdAt={parentAgent.createdAt} />
			</div>

			{/* Expanded children */}
			{isExpanded && renderChildren && (
				<ExpandedChildren
					subAgentEvents={subAgentEvents}
					toolResultsByKey={toolResultsByKey}
					focusedEventId={focusedEventId}
					approvingApprovalId={approvingApprovalId}
					denyingApprovalId={denyingApprovalId}
					finalResponse={finalResponse}
					onFocusChange={onFocusChange}
					shouldIgnoreMouseEvent={shouldIgnoreMouseEvent}
					rowProps={rowProps}
				/>
			)}
		</div>
	)
}
