import type { ConversationEvent } from '@humanlayer/ui/components/conversation-stream'
import { parseContextCompaction } from '@humanlayer/ui/components/conversation-stream'
import { and, eq, useLiveQuery } from '@tanstack/react-db'
import { memo, useCallback, useMemo } from 'react'

import { WiredGitHubPushCardForEvent } from '@/components/github/WiredGitHubPushCard'
import { useSync } from '@/components/providers/SyncProvider'
import { useSessionDetail } from '@/components/session-detail/session-detail-context'
import { useFocusStore } from '@/hooks/stores/focusStore'
import { useArtifactSharingDialog } from '@/hooks/useArtifactSharingDialog'
import { useOrgMembers } from '@/hooks/useOrgMembers'
import { getCreatedFilePaths, isShareableConversationArtifact } from '@/lib/current-artifact-resolver'
import { getSenderPresentation } from '@/lib/sender-presentation'
import { bigintToNumber } from '@/utils/session-transforms'

import { ConversationEventRenderBoundary } from './ConversationEventRenderBoundary'
import { ConversationEventRow } from './ConversationEventRow'
import { useEventRowApprovalHandlers } from './hooks/useEventRowApprovalHandlers'
import { useEventRowNextStep } from './hooks/useEventRowNextStep'
import { WiredContextCompactionRow } from './WiredContextCompactionRow'

export interface WiredConversationEventRowProps {
	eventId: string
	sessionId: string
	isGroupItem?: boolean
	/** Sequence-derived: false only for the first user message in the stream. */
	canForkFromMessage?: boolean
	presentation?: 'stream' | 'pinned-user-message'
	onPinnedUserMessageClick?: () => void
	/** Sequence-derived: true only for the session's most recent completed push, which carries the GitHub card. */
	showGitHubPushCard?: boolean
}

/**
 * Wired event row. The virtualized parent passes stable IDs and layout flags;
 * this leaf queries its event/result/approval and reads session actions from the
 * existing SessionDetailProvider.
 */
export const WiredConversationEventRow = memo(
	function WiredConversationEventRow({
		eventId,
		sessionId,
		isGroupItem = false,
		canForkFromMessage = true,
		presentation = 'stream',
		onPinnedUserMessageClick,
		showGitHubPushCard = false,
	}: WiredConversationEventRowProps) {
		const { eventsCollection, approvalsCollection } = useSync()
		const {
			session,
			conversation,
			canManageSession,
			canSendPromptToHost,
			canResolveApproval,
			autoAdvance,
			fork,
			nextStep,
			artifactPanel,
			handleRequestModal,
			handleOpenFile,
			handleCopy,
		} = useSessionDetail()
		const { openSharingDialog } = useArtifactSharingDialog()
		const { membersMap } = useOrgMembers()

		const { data: eventRows } = useLiveQuery(
			(q) =>
				q
					.from({ event: eventsCollection })
					.where(({ event }) => and(eq(event.id, eventId), eq(event.session_id, sessionId))),
			[eventsCollection, eventId, sessionId],
		)
		const eventRow = eventRows[0]
		const toolId = eventRow?.tool_call_id ?? undefined

		const { data: toolResultRows } = useLiveQuery(
			(q) =>
				q
					.from({ event: eventsCollection })
					// Most selective predicate first: TanStack DB's index intersection seeds from
					// the first conjunct's key set, so leading with session_id copies the whole
					// session's key set (10k+ rows) per evaluation; tool_result_for_id matches ≤1.
					.where(({ event }) =>
						and(
							eq(event.tool_result_for_id, toolId ?? '__no_tool_result__'),
							eq(event.session_id, sessionId),
						),
					),
			[eventsCollection, toolId, sessionId],
		)

		const { data: approvalRows } = useLiveQuery(
			(q) =>
				q
					.from({ approval: approvalsCollection })
					// Most selective predicate first (see tool-result query above).
					.where(({ approval }) =>
						and(eq(approval.tool_use_id, toolId ?? '__no_approval__'), eq(approval.session_id, sessionId)),
					),
			[approvalsCollection, toolId, sessionId],
		)

		const directToolResult = toolResultRows[0]
		const contextualToolResult = toolId ? conversation.toolResultsByKey[toolId] : undefined
		const approval = approvalRows[0]

		const event = useMemo((): ConversationEvent | null => {
			if (!eventRow) return null

			return {
				id: eventRow.id,
				sessionId: eventRow.session_id,
				eventType: eventRow.event_type as ConversationEvent['eventType'],
				role: eventRow.role as ConversationEvent['role'],
				content: eventRow.content ?? undefined,
				sender: eventRow.user_id ? getSenderPresentation(membersMap.get(eventRow.user_id)) : undefined,
				toolId: eventRow.tool_call_id ?? undefined,
				toolName: eventRow.tool_name ?? undefined,
				toolInputJson: eventRow.tool_input_json
					? typeof eventRow.tool_input_json === 'string'
						? eventRow.tool_input_json
						: JSON.stringify(eventRow.tool_input_json)
					: undefined,
				parentToolUseId: eventRow.parent_tool_use_id ?? undefined,
				toolResultForId: eventRow.tool_result_for_id ?? undefined,
				toolResultContent: eventRow.tool_result_content ?? undefined,
				isCompleted:
					eventRow.event_type === 'tool_call' && eventRow.tool_call_id
						? !!directToolResult || !!contextualToolResult
						: undefined,
				approvalId: approval?.id,
				approvalStatus: approval?.status as ConversationEvent['approvalStatus'],
				suggestions: approval?.suggestions as ConversationEvent['suggestions'],
				createdAt: new Date(bigintToNumber(eventRow.created_at) ?? Date.now()),
				nextStepSuggestion: eventRow.next_step_suggestion
					? typeof eventRow.next_step_suggestion === 'string'
						? JSON.parse(eventRow.next_step_suggestion)
						: (eventRow.next_step_suggestion as ConversationEvent['nextStepSuggestion'])
					: undefined,
			}
		}, [eventRow, approval, directToolResult, contextualToolResult, membersMap])

		const toolResult = useMemo((): ConversationEvent | undefined => {
			if (!directToolResult) return contextualToolResult

			return {
				id: directToolResult.id,
				sessionId: directToolResult.session_id,
				eventType: directToolResult.event_type as ConversationEvent['eventType'],
				role: directToolResult.role as ConversationEvent['role'],
				content: directToolResult.content ?? undefined,
				toolResultForId: directToolResult.tool_result_for_id ?? undefined,
				toolResultContent: directToolResult.tool_result_content ?? undefined,
				parentToolUseId: directToolResult.parent_tool_use_id ?? undefined,
				createdAt: new Date(bigintToNumber(directToolResult.created_at) ?? Date.now()),
			}
		}, [contextualToolResult, directToolResult])

		const currentArtifact = useMemo(() => {
			if (!event) return null
			const matches = getCreatedFilePaths(event, toolResult)
				.map(artifactPanel.resolveCurrentArtifact)
				.filter((artifact) => artifact !== null)
			const uniqueMatches = new Map(matches.map((artifact) => [artifact.id, artifact]))
			return uniqueMatches.size === 1 ? (uniqueMatches.values().next().value ?? null) : null
		}, [artifactPanel.resolveCurrentArtifact, event, toolResult])

		const handleViewArtifact = useCallback(() => {
			if (currentArtifact) artifactPanel.handleArtifactClick(currentArtifact.id)
		}, [artifactPanel.handleArtifactClick, currentArtifact])
		const handleShareArtifact = useCallback(() => {
			if (currentArtifact) openSharingDialog({ artifactId: currentArtifact.id, source: 'conversation' })
		}, [currentArtifact, openSharingDialog])

		const { handleProceedToNextStep, nextStepLabelOverride, nextStepVariant, nextStepDisabled } =
			useEventRowNextStep({
				event,
				taskId: session.task_id,
				sessionId,
				targetLabel: autoAdvance.autoAdvanceConfig.targetLabel,
				nextStepName: autoAdvance.autoAdvanceConfig.nextStepName,
				isAutoAdvanceEnabled: autoAdvance.isAutoAdvanceEnabled,
				onProceedToNextStep: nextStep.handleRowProceedToNextStep,
			})

		const isFocused = useFocusStore((state) => state.focusedEventId === eventId)
		const setFocusedEventId = useFocusStore((state) => state.setFocusedEventId)

		const {
			approvingApprovalId,
			denyingApproval,
			denyFeedbackText,
			cancelDeny,
			handleApprove,
			handleApproveWithSuggestions,
			handleDeny,
			handleStartDeny,
			handleSubmitDeny,
		} = useEventRowApprovalHandlers(event)

		const handleFocusChange = useCallback(
			(focusedEventId: string | null, source: 'mouse' | 'keyboard') => setFocusedEventId(focusedEventId, source),
			[setFocusedEventId],
		)
		// getState() read: subscribing to focusSource would re-render every
		// visible row whenever the input mode flips between mouse and keyboard.
		const shouldIgnoreMouseEvent = useCallback(() => useFocusStore.getState().focusSource !== 'mouse', [])

		if (!event) return null

		const compaction = parseContextCompaction(event)
		if (compaction) {
			return (
				<WiredContextCompactionRow
					eventId={event.id}
					payload={compaction}
					isFocused={isFocused}
					onFocusChange={handleFocusChange}
					shouldIgnoreMouseEvent={shouldIgnoreMouseEvent}
				/>
			)
		}

		return (
			<ConversationEventRenderBoundary event={event}>
				<ConversationEventRow
					event={event}
					toolResult={toolResult}
					isFocused={isFocused}
					isGroupItem={isGroupItem}
					presentation={presentation}
					onPinnedUserMessageClick={onPinnedUserMessageClick}
					workingDir={session.working_directory ?? undefined}
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
					isApproving={approvingApprovalId === event.approvalId}
					isDenying={denyingApproval?.id === event.approvalId}
					hasDenyFeedback={!!denyFeedbackText?.trim()}
					onCopy={handleCopy}
					onForkFromMessage={
						canManageSession && canForkFromMessage && fork.canFork ? fork.handleForkFromMessage : undefined
					}
					onProceedToNextStep={handleProceedToNextStep}
					isApprovalActionsHidden={!canResolveApproval}
					isNextStepHidden={!canSendPromptToHost}
					nextStepVariant={nextStepVariant}
					nextStepLabelOverride={nextStepLabelOverride}
					nextStepDisabled={nextStepDisabled}
					onViewArtifact={currentArtifact ? handleViewArtifact : undefined}
					onShareArtifact={
						currentArtifact && isShareableConversationArtifact(currentArtifact)
							? handleShareArtifact
							: undefined
					}
				/>
				<WiredGitHubPushCardForEvent sessionId={sessionId} event={event} show={showGitHubPushCard} />
			</ConversationEventRenderBoundary>
		)
	},
	(previous, next) =>
		previous.eventId === next.eventId &&
		previous.sessionId === next.sessionId &&
		previous.isGroupItem === next.isGroupItem &&
		previous.canForkFromMessage === next.canForkFromMessage &&
		previous.presentation === next.presentation &&
		previous.onPinnedUserMessageClick === next.onPinnedUserMessageClick &&
		previous.showGitHubPushCard === next.showGitHubPushCard,
)
