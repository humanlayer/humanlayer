import type { PermissionUpdate } from '@humanlayer/db/zodschemas/permission-update'
import type { ConversationEvent, AgentEventGroup } from '@humanlayer/ui/components/conversation-stream'
import { and, eq, useLiveQuery } from '@tanstack/react-db'
import { memo, useCallback, useMemo } from 'react'
import { toast } from 'sonner'

import { useSync } from '@/components/providers/SyncProvider'
import { useSessionDetail } from '@/components/session-detail/session-detail-context'
import { useApprovalStore } from '@/hooks/stores/approvalStore'
import { useExpansionStore } from '@/hooks/stores/expansionStore'
import { useFocusStore } from '@/hooks/stores/focusStore'
import { useApprovalActions } from '@/hooks/useApprovalActions'
import { bigintToNumber } from '@/utils/session-transforms'

import { AgentGroupEventRow } from './AgentGroupEventRow'

export interface WiredAgentGroupEventRowProps {
	parentAgentEventId: string
	sessionId: string
}

/**
 * Wired agent-group row. The virtualized parent passes only stable identifiers;
 * this leaf queries its parent event and reads the remaining session/group data
 * at the surface that renders it.
 */
export const WiredAgentGroupEventRow = memo(
	function WiredAgentGroupEventRow({ parentAgentEventId, sessionId }: WiredAgentGroupEventRowProps) {
		const { eventsCollection } = useSync()
		const { session, conversation, canResolveApproval, handleRequestModal, handleOpenFile, handleCopy } =
			useSessionDetail()
		const { approve, approveWithSuggestions, deny } = useApprovalActions()

		const { data: parentRows } = useLiveQuery(
			(q) =>
				q
					.from({ event: eventsCollection })
					.where(({ event }) => and(eq(event.id, parentAgentEventId), eq(event.session_id, sessionId))),
			[eventsCollection, parentAgentEventId, sessionId],
		)

		const contextGroup = useMemo(
			() =>
				[...conversation.agentGroups.values()].find(
					(candidate) => candidate.parentAgent.id === parentAgentEventId,
				) ?? null,
			[conversation.agentGroups, parentAgentEventId],
		)
		const parentRow = parentRows[0]

		const parentAgent = useMemo((): ConversationEvent | null => {
			if (!contextGroup) return null
			if (!parentRow) return contextGroup.parentAgent

			return {
				...contextGroup.parentAgent,
				id: parentRow.id,
				sessionId: parentRow.session_id,
				eventType: parentRow.event_type as ConversationEvent['eventType'],
				role: parentRow.role as ConversationEvent['role'],
				content: parentRow.content ?? undefined,
				toolId: parentRow.tool_call_id ?? undefined,
				toolName: parentRow.tool_name ?? undefined,
				toolInputJson: parentRow.tool_input_json
					? typeof parentRow.tool_input_json === 'string'
						? parentRow.tool_input_json
						: JSON.stringify(parentRow.tool_input_json)
					: undefined,
				parentToolUseId: parentRow.parent_tool_use_id ?? undefined,
				toolResultForId: parentRow.tool_result_for_id ?? undefined,
				toolResultContent: parentRow.tool_result_content ?? undefined,
				createdAt: new Date(bigintToNumber(parentRow.created_at) ?? Date.now()),
			}
		}, [contextGroup, parentRow])

		const group = useMemo((): AgentEventGroup | null => {
			if (!contextGroup || !parentAgent) return null
			return { ...contextGroup, parentAgent }
		}, [contextGroup, parentAgent])

		const agentId = parentAgent?.toolId
		const isInterrupted = session.status === 'interrupted' || session.status === 'interrupt_requested'
		const isSessionActive = session.status === 'running' || session.status === 'launching'
		const isCurrentTurn = conversation.currentTurnEventIds.has(parentAgentEventId)
		const workingDir = session.working_directory ?? undefined

		const isFocused = useFocusStore((state) => state.focusedEventId === parentAgentEventId)
		const setFocusedEventId = useFocusStore((state) => state.setFocusedEventId)

		const approvingApprovalId = useApprovalStore((state) => state.approvingApprovalId)
		const denyingApproval = useApprovalStore((state) => state.denyingApproval)
		const denyFeedbackText = useApprovalStore((state) => state.denyFeedbackText)
		const setApprovingApprovalId = useApprovalStore((state) => state.setApprovingApprovalId)
		const startDeny = useApprovalStore((state) => state.startDeny)
		const cancelDeny = useApprovalStore((state) => state.cancelDeny)

		const isExpanded = useExpansionStore((state) => (agentId ? state.expandedAgents.has(agentId) : false))
		const toggleExpansion = useExpansionStore((state) => state.toggle)

		const handleFocusChange = useCallback(
			(eventId: string | null, source: 'mouse' | 'keyboard') => setFocusedEventId(eventId, source),
			[setFocusedEventId],
		)
		// getState() read: subscribing to focusSource would re-render every
		// visible row whenever the input mode flips between mouse and keyboard.
		const shouldIgnoreMouseEvent = useCallback(() => useFocusStore.getState().focusSource === 'keyboard', [])

		const handleToggle = useCallback(() => {
			if (!agentId || group?.hasPendingApproval) return
			toggleExpansion(agentId)
		}, [group?.hasPendingApproval, agentId, toggleExpansion])

		const handleApprove = useCallback(
			async (approvalId: string) => {
				setApprovingApprovalId(approvalId)
				try {
					await approve(approvalId)
				} catch {
					toast.error('Failed to approve')
				} finally {
					setApprovingApprovalId(null)
				}
			},
			[approve, setApprovingApprovalId],
		)

		const handleApproveWithSuggestions = useCallback(
			async (approvalId: string, suggestions: PermissionUpdate[]) => {
				setApprovingApprovalId(approvalId)
				try {
					await approveWithSuggestions(approvalId, suggestions)
				} catch {
					toast.error('Failed to approve')
				} finally {
					setApprovingApprovalId(null)
				}
			},
			[approveWithSuggestions, setApprovingApprovalId],
		)

		const handleDeny = useCallback(
			async (approvalId: string, reason: string) => {
				try {
					await deny(approvalId, reason)
				} catch {
					toast.error('Failed to deny')
				} finally {
					cancelDeny()
				}
			},
			[cancelDeny, deny],
		)

		const handleStartDeny = useCallback(
			(approvalId: string) => {
				const subAgentEvents = group?.subAgentEvents ?? []
				const event = [parentAgent, ...subAgentEvents].find((candidate) => candidate?.approvalId === approvalId)
				startDeny(approvalId, event?.toolName || 'Unknown')
			},
			[group?.subAgentEvents, parentAgent, startDeny],
		)

		const handleSubmitDeny = useCallback(async () => {
			if (!denyingApproval || !denyFeedbackText?.trim()) return
			await handleDeny(denyingApproval.id, denyFeedbackText.trim())
		}, [denyingApproval, denyFeedbackText, handleDeny])

		if (!group) return null

		return (
			<AgentGroupEventRow
				group={group}
				toolResultsByKey={conversation.toolResultsByKey}
				workingDir={workingDir}
				isInterrupted={isInterrupted}
				isSessionActive={isSessionActive}
				isCurrentTurn={isCurrentTurn}
				renderChildren={false}
				isFocused={isFocused}
				// Only read by the renderChildren=true path (sub-rows render inline);
				// this row virtualizes children separately, so don't subscribe for it.
				focusedEventId={null}
				isExpanded={isExpanded}
				onToggle={handleToggle}
				onFocusChange={handleFocusChange}
				shouldIgnoreMouseEvent={shouldIgnoreMouseEvent}
				onRequestModal={handleRequestModal}
				onOpenFile={handleOpenFile}
				onApprove={handleApprove}
				onApproveWithSuggestions={handleApproveWithSuggestions}
				onDeny={handleDeny}
				onStartDeny={handleStartDeny}
				onCancelDeny={cancelDeny}
				onSubmitDeny={handleSubmitDeny}
				approvingApprovalId={approvingApprovalId}
				denyingApprovalId={denyingApproval?.id ?? null}
				hasDenyFeedback={!!denyFeedbackText?.trim()}
				onCopy={handleCopy}
				isApprovalActionsHidden={!canResolveApproval}
			/>
		)
	},
	(previous, next) =>
		previous.parentAgentEventId === next.parentAgentEventId && previous.sessionId === next.sessionId,
)
