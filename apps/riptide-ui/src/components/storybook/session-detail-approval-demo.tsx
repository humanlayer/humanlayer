import {
	type ConversationEvent,
	ConversationStream,
	createToolResultsByKey,
	type AgentEventGroup,
} from '@humanlayer/ui/components/conversation-stream'
import { useCallback, useRef, useState } from 'react'

import { logger } from '@/lib/logger'

import { type ContinueSessionInputDenyHandle, ContinueSessionInputPure } from '../ContinueSessionInput'

interface SessionDetailApprovalDemoProps {
	events: ConversationEvent[]
	agentGroups?: Map<string, AgentEventGroup>
	workingDir?: string
	sessionStatus?: string
}

export function SessionDetailApprovalDemo({
	events: initialEvents,
	agentGroups = new Map(),
	workingDir = '/Users/dev/project',
	sessionStatus = 'needs_approval',
}: SessionDetailApprovalDemoProps) {
	const [events, setEvents] = useState(initialEvents)
	const [expandedAgents, setExpandedAgents] = useState<Set<string>>(() => {
		const expanded = new Set<string>()
		for (const [agentId, group] of agentGroups) {
			if (group.hasPendingApproval) {
				expanded.add(agentId)
			}
		}
		return expanded
	})

	// Approval state
	const [approvingApprovalId, setApprovingApprovalId] = useState<string | null>(null)
	const [denyingApproval, setDenyingApproval] = useState<{ id: string; toolName: string } | null>(null)
	const [denyFeedbackText, setDenyFeedbackText] = useState<string | null>(null)
	const hasDenyFeedback = !!denyFeedbackText?.trim()

	// Ref for triggering deny submit from inline button
	const denyRef = useRef<ContinueSessionInputDenyHandle>(null)

	const toolResultsByKey = createToolResultsByKey(events)

	// Find pending approval for keyboard shortcuts
	const pendingApproval = events.find((e) => e.approvalStatus === 'pending')

	const handleToggleAgentGroup = useCallback((agentId: string) => {
		setExpandedAgents((prev) => {
			const next = new Set(prev)
			if (next.has(agentId)) {
				next.delete(agentId)
			} else {
				next.add(agentId)
			}
			return next
		})
	}, [])

	const handleApprove = useCallback((approvalId: string) => {
		logger.info('[Demo] Approving:', approvalId)
		setApprovingApprovalId(approvalId)
		// Simulate API call
		setTimeout(() => {
			setEvents((prev) =>
				prev.map((e) => (e.approvalId === approvalId ? { ...e, approvalStatus: 'approved' as const } : e)),
			)
			setApprovingApprovalId(null)
			logger.info('[Demo] Approved!')
		}, 1000)
	}, [])

	const handleStartDeny = useCallback(
		(approvalId: string) => {
			const event = events.find((e) => e.approvalId === approvalId)
			if (event) {
				setDenyingApproval({ id: approvalId, toolName: event.toolName || 'Unknown' })
			}
		},
		[events],
	)

	const handleCancelDeny = useCallback(() => {
		setDenyingApproval(null)
		setDenyFeedbackText(null)
	}, [])

	// Handler for inline DENY button in conversation stream
	const handleInlineSubmitDeny = useCallback(() => {
		denyRef.current?.submitDeny()
	}, [])

	const handleSubmitDeny = useCallback(
		(message: string) => {
			if (!denyingApproval) return
			logger.info('[Demo] Denying:', denyingApproval.id, 'with message:', message)
			// Simulate API call
			setTimeout(() => {
				setEvents((prev) =>
					prev.map((e) =>
						e.approvalId === denyingApproval.id ? { ...e, approvalStatus: 'denied' as const } : e,
					),
				)
				setDenyingApproval(null)
				logger.info('[Demo] Denied!')
			}, 500)
		},
		[denyingApproval],
	)

	return (
		<div className="h-full flex flex-col">
			{/* Conversation Stream */}
			<div className="flex-1 min-h-0 overflow-auto">
				<ConversationStream
					events={events}
					agentGroups={agentGroups}
					toolResultsByKey={toolResultsByKey}
					workingDir={workingDir}
					expandedAgents={expandedAgents}
					onToggleAgentGroup={handleToggleAgentGroup}
					onApprove={handleApprove}
					approvingApprovalId={approvingApprovalId}
					denyingApprovalId={denyingApproval?.id ?? null}
					onStartDeny={handleStartDeny}
					onCancelDeny={handleCancelDeny}
					onSubmitDeny={handleInlineSubmitDeny}
					hasDenyFeedback={hasDenyFeedback}
				/>
			</div>

			{/* Bottom input area */}
			<div className="flex-shrink-0 border-t p-4">
				<ContinueSessionInputPure
					sessionId="00000000-0000-0000-0000-000000000000"
					canPrompt
					canManageSession
					multiplayerPromptingControl={<></>}
					sessionStatus={sessionStatus}
					onSubmit={(params) => logger.info('[Demo] Submit:', params)}
					onInterrupt={(msg) => {
						logger.info('[Demo] Interrupt:', msg)
						return undefined
					}}
					permissionsMode="default"
					contextWindowTokens={65000}
					contextWindowLimit={968000}
					model="claude-sonnet-5"
					onFocusChange={() => undefined}
					updateSessionModel={() => undefined}
					updateSessionEffort={() => undefined}
					updateSessionFastMode={() => undefined}
					// Denial mode props
					isDenying={!!denyingApproval}
					denyingToolName={denyingApproval?.toolName}
					onCancelDeny={handleCancelDeny}
					onSubmitDeny={handleSubmitDeny}
					onDenyContentChange={setDenyFeedbackText}
					denyRef={denyRef}
				/>
			</div>

			{/* Keyboard hints */}
			{pendingApproval && !denyingApproval && (
				<div className="flex-shrink-0 px-4 pb-2 text-xs text-muted-foreground">
					Press <kbd className="px-1 py-0.5 bg-muted rounded">A</kbd> to approve or{' '}
					<kbd className="px-1 py-0.5 bg-muted rounded">D</kbd> to deny the pending approval
				</div>
			)}
		</div>
	)
}
