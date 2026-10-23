import type { PermissionUpdate } from '@humanlayer/db/zodschemas/permission-update'
import type { ConversationEvent } from '@humanlayer/ui/components/conversation-stream'
import {
	ContextCompactionRow,
	type ContextCompactionPayload,
	parseContextCompaction,
} from '@humanlayer/ui/components/conversation-stream'
import { ChevronDown } from 'lucide-react'
import type { ReactNode } from 'react'
import { type FC, useMemo, useState } from 'react'

import { cn } from '@/lib/utils'
import { MobileBreadcrumb, type MobileBreadcrumbDetail } from '@/mobile/components/pure/MobileBreadcrumb'
import { MobileMessageRow } from '@/mobile/components/pure/MobileMessageRow'
import { type MobileQueuedMessage, MobileQueuedMessages } from '@/mobile/components/pure/MobileQueuedMessages'
import { MobileThinkingRow } from '@/mobile/components/pure/MobileThinkingRow'
import { MobileToolGroup } from '@/mobile/components/pure/MobileToolGroup'
import { useMobileStickToBottom } from '@/mobile/hooks/useMobileStickToBottom'
import { MobileAppLayout } from '@/mobile/layouts/MobileAppLayout'
import { COMPACTED_HISTORY_PAGE_SIZE, getCompactedHistory, revealedHistoryStart } from '@/utils/compacted-history'
import { isThinkingEvent } from '@/utils/mobile-conversation-events'

/** A rendered slice of the conversation stream: a grouped run of tool calls, a
 * dim thinking line, or a plain message/approval/error row. */
type StreamItem =
	| { kind: 'group'; id: string; events: ConversationEvent[] }
	| { kind: 'thinking'; id: string; event: ConversationEvent; durationSeconds: number | null; isStreaming: boolean }
	| { kind: 'message'; id: string; event: ConversationEvent }
	| { kind: 'compaction'; id: string; payload: ContextCompactionPayload }

/**
 * Fold the flat event list into stream items: CONSECUTIVE `tool_call` events
 * collapse into a single group (keyed by the first tool call's id so appending
 * new calls to the tail group never changes its key — preserving the user's
 * expand/collapse choice), thinking events become dim rows, and everything else
 * (assistant / user / errors / approvals) renders as a message row.
 */
function buildStreamItems(rootEvents: ConversationEvent[]): StreamItem[] {
	const items: StreamItem[] = []
	let group: ConversationEvent[] | null = null

	const flushGroup = () => {
		if (group && group.length > 0) {
			const firstEvent = group[0]
			if (firstEvent !== undefined) {
				items.push({ kind: 'group', id: firstEvent.id, events: group })
			}
		}
		group = null
	}

	rootEvents.forEach((event, index) => {
		if (event.eventType === 'tool_call') {
			if (!group) group = []
			group.push(event)
			return
		}

		flushGroup()

		const compaction = parseContextCompaction(event)
		if (compaction) {
			items.push({ kind: 'compaction', id: event.id, payload: compaction })
			return
		}

		if (isThinkingEvent(event)) {
			const next = rootEvents[index + 1]
			const isStreaming = index === rootEvents.length - 1
			let durationSeconds: number | null = null
			if (next) {
				const delta = Math.round((next.createdAt.getTime() - event.createdAt.getTime()) / 1000)
				durationSeconds = Number.isFinite(delta) && delta > 0 ? delta : null
			}
			items.push({ kind: 'thinking', id: event.id, event, durationSeconds, isStreaming })
			return
		}

		items.push({ kind: 'message', id: event.id, event })
	})

	flushGroup()
	return items
}

function toggleSetItem(setState: (updater: (prev: Set<string>) => Set<string>) => void, id: string): void {
	setState((prev) => {
		const next = new Set(prev)
		if (next.has(id)) next.delete(id)
		else next.add(id)
		return next
	})
}

export interface MobileSessionDetailPageProps {
	sessionId: string
	sessionTitle: string
	sessionHostName?: string | null
	isSessionHostOffline?: boolean
	onBack: () => void

	/** Conversation events to render. `tool_result` entries are filtered out and
	 * paired inline with their originating `tool_call` via `toolResultsByKey`
	 * — matches the desktop ConversationStream convention. */
	events: ConversationEvent[]
	toolResultsByKey?: Record<string, ConversationEvent>
	/** Persisted compaction summaries keyed by their boundary event id. */
	compactionSummaries?: ReadonlyMap<string, string>
	workingDir?: string
	fileSnapshots?: Record<string, string>
	onOpenFile?: (filePath: string) => void

	/** Called when the user taps Approve on a pending tool call */
	onApprove: (approvalId: string) => void
	/** Called when the user taps Deny — enters deny-with-feedback mode. */
	onDeny: (approvalId: string) => void
	/** Approve while persisting the tool's "don't ask again" suggestions. */
	onApproveWithSuggestions: (approvalId: string, applied: PermissionUpdate[]) => void
	/** Hide Approve/Deny controls for viewers without approval permission
	 * (mirrors desktop's isApprovalActionsHidden). */
	approvalActionsHidden?: boolean
	/** Whether an approval action is in-flight (keyed by approvalId) */
	approvingApprovalId?: string | null
	/** The approval currently in deny-feedback mode (composer open), if any. */
	denyingApprovalId?: string | null
	/** Cancel deny-feedback mode (shared by the approval row and the composer). */
	onCancelDeny: () => void
	showSenderNames?: boolean

	/** Fully wired composer slot (input + selectors/dialogs). */
	composer: ReactNode

	/** Messages queued while the session is running, shown between the message
	 * list and the composer (mirrors the desktop queued-messages pane). */
	queuedMessages?: MobileQueuedMessage[]
	/** Interrupt the running step and deliver the queued message now. */
	onQueuedSendNow?: (id: string) => void
	/** Remove a message from the queue. */
	onQueuedRemove?: (id: string) => void

	/** Interleaved artifact controller slots (trigger in the header, sheet at root). */
	artifactTrigger?: ReactNode
	artifactSheet?: ReactNode
}

interface MobileSessionStreamProps {
	events: ConversationEvent[]
	toolResultsByKey?: Record<string, ConversationEvent>
	compactionSummaries?: ReadonlyMap<string, string>
	workingDir?: string
	fileSnapshots?: Record<string, string>
	onOpenFile?: (filePath: string) => void
	onApprove: (approvalId: string) => void
	onDeny: (approvalId: string) => void
	onApproveWithSuggestions: (approvalId: string, applied: PermissionUpdate[]) => void
	approvalActionsHidden?: boolean
	approvingApprovalId?: string | null
	denyingApprovalId?: string | null
	onCancelDeny: () => void
	showSenderNames?: boolean
}

const MobileSessionStream: FC<MobileSessionStreamProps> = ({
	events,
	toolResultsByKey,
	compactionSummaries,
	workingDir,
	fileSnapshots,
	onOpenFile,
	onApprove,
	onDeny,
	onApproveWithSuggestions,
	approvalActionsHidden = false,
	approvingApprovalId,
	denyingApprovalId,
	onCancelDeny,
	showSenderNames = false,
}) => {
	// Per-tool-row expansion inside a group (default collapsed).
	const [expandedEventIds, setExpandedEventIds] = useState<Set<string>>(new Set())
	// Whole-tool-group expansion (default collapsed -> absent from the set).
	const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(new Set())
	// Thinking-row expansion (default collapsed -> absent from the set).
	const [expandedThinkingIds, setExpandedThinkingIds] = useState<Set<string>>(new Set())
	// Compaction-summary expansion, keyed by boundary event id (default collapsed).
	const [expandedSummaryIds, setExpandedSummaryIds] = useState<Set<string>>(new Set())
	// Events the latest compaction summarized away (default folded).
	const [isCompactedHistoryExpanded, setIsCompactedHistoryExpanded] = useState(false)
	// Newest folded events revealed once the history is expanded (default one page).
	const [revealedHistoryCount, setRevealedHistoryCount] = useState<number | undefined>(undefined)
	const { scrollRef, contentRef } = useMobileStickToBottom()

	const rootEvents = useMemo(() => events.filter((e) => e.eventType !== 'tool_result'), [events])
	const compactedHistory = useMemo(() => getCompactedHistory(rootEvents), [rootEvents])
	const revealedHistoryStartIndex =
		compactedHistory === null
			? 0
			: isCompactedHistoryExpanded
				? revealedHistoryStart(compactedHistory, revealedHistoryCount)
				: compactedHistory.foldedCount
	const revealedCount = compactedHistory === null ? 0 : compactedHistory.foldedCount - revealedHistoryStartIndex
	const isHistoryTruncated =
		compactedHistory !== null && isCompactedHistoryExpanded && revealedCount < compactedHistory.foldedCount
	const streamItems = useMemo(
		() => buildStreamItems(rootEvents.slice(revealedHistoryStartIndex)),
		[rootEvents, revealedHistoryStartIndex],
	)
	const toggleExpand = (id: string) => toggleSetItem(setExpandedEventIds, id)
	const toggleGroupExpanded = (id: string) => toggleSetItem(setExpandedGroupIds, id)
	const toggleThinking = (id: string) => toggleSetItem(setExpandedThinkingIds, id)
	const toggleSummary = (id: string) => toggleSetItem(setExpandedSummaryIds, id)

	return (
		<div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain">
			{rootEvents.length === 0 ? (
				<div className="flex flex-col items-center justify-center h-full px-6 text-center gap-2">
					<p className="text-sm text-muted-foreground">No messages yet.</p>
				</div>
			) : (
				<div ref={contentRef} className="flex flex-col py-1">
					{compactedHistory && (
						<div className="flex flex-col px-4 py-3 text-xs text-muted-foreground">
							<button
								type="button"
								aria-expanded={isCompactedHistoryExpanded}
								onClick={() => setIsCompactedHistoryExpanded((prev) => !prev)}
								className="flex items-center gap-2 text-left uppercase tracking-wider"
							>
								<ChevronDown
									className={cn(
										'h-3 w-3 transition-transform',
										!isCompactedHistoryExpanded && '-rotate-90',
									)}
								/>
								<span>
									<span className="normal-case">{compactedHistory.foldedCount.toLocaleString()}</span>{' '}
									{compactedHistory.foldedCount === 1 ? 'event' : 'events'} compacted
								</span>
								{isHistoryTruncated && (
									<span className="text-muted-foreground/60 normal-case tracking-normal">
										· showing last {revealedCount.toLocaleString()}
									</span>
								)}
							</button>
							{isHistoryTruncated && (
								<div className="flex items-center gap-3 pl-5 pt-1">
									<button
										type="button"
										className="text-[var(--terminal-accent)]"
										onClick={() =>
											setRevealedHistoryCount(revealedCount + COMPACTED_HISTORY_PAGE_SIZE)
										}
									>
										Show{' '}
										{Math.min(
											COMPACTED_HISTORY_PAGE_SIZE,
											compactedHistory.foldedCount - revealedCount,
										).toLocaleString()}{' '}
										older
									</button>
									<button
										type="button"
										onClick={() => setRevealedHistoryCount(compactedHistory.foldedCount)}
									>
										Show all
									</button>
								</div>
							)}
						</div>
					)}
					{streamItems.map((item) => {
						if (item.kind === 'group') {
							return (
								<MobileToolGroup
									key={item.id}
									events={item.events}
									toolResultsByKey={toolResultsByKey}
									workingDir={workingDir}
									fileSnapshots={fileSnapshots}
									onOpenFile={onOpenFile}
									onApprove={onApprove}
									onDeny={onDeny}
									onApproveWithSuggestions={onApproveWithSuggestions}
									approvalActionsHidden={approvalActionsHidden}
									approvingApprovalId={approvingApprovalId}
									denyingApprovalId={denyingApprovalId}
									onCancelDeny={onCancelDeny}
									collapsed={!expandedGroupIds.has(item.id)}
									onToggleCollapsed={() => toggleGroupExpanded(item.id)}
									expandedEventIds={expandedEventIds}
									onToggleExpand={toggleExpand}
								/>
							)
						}
						if (item.kind === 'compaction') {
							const summary = compactionSummaries?.get(item.id)
							return (
								<ContextCompactionRow
									key={item.id}
									payload={item.payload}
									eventId={item.id}
									summary={summary}
									isSummaryExpanded={expandedSummaryIds.has(item.id)}
									onToggleSummary={summary === undefined ? undefined : () => toggleSummary(item.id)}
								/>
							)
						}
						if (item.kind === 'thinking') {
							return (
								<MobileThinkingRow
									key={item.id}
									event={item.event}
									durationSeconds={item.durationSeconds}
									isStreaming={item.isStreaming}
									isExpanded={expandedThinkingIds.has(item.id)}
									onToggleExpand={() => toggleThinking(item.id)}
								/>
							)
						}
						const event = item.event
						return (
							<MobileMessageRow
								key={event.id}
								event={event}
								toolResult={event.toolId ? toolResultsByKey?.[event.toolId] : undefined}
								workingDir={workingDir}
								fileSnapshots={fileSnapshots}
								onOpenFile={onOpenFile}
								onApprove={onApprove}
								onDeny={onDeny}
								onApproveWithSuggestions={onApproveWithSuggestions}
								approvalActionsHidden={approvalActionsHidden}
								isApproving={!!event.approvalId && event.approvalId === approvingApprovalId}
								isDenying={!!event.approvalId && event.approvalId === denyingApprovalId}
								onCancelDeny={onCancelDeny}
								showSenderName={showSenderNames}
								isExpanded={expandedEventIds.has(event.id)}
								onToggleExpand={() => toggleExpand(event.id)}
							/>
						)
					})}
				</div>
			)}
		</div>
	)
}

/**
 * Mobile session detail page — message list with tap-to-expand rows,
 * input bar at the bottom, and artifact sheet accessible via hamburger menu.
 */
export const MobileSessionDetailPage: FC<MobileSessionDetailPageProps> = ({
	sessionId,
	sessionTitle,
	sessionHostName,
	isSessionHostOffline = false,
	onBack,
	events,
	toolResultsByKey,
	compactionSummaries,
	workingDir,
	fileSnapshots,
	onOpenFile,
	onApprove,
	onDeny,
	onApproveWithSuggestions,
	approvalActionsHidden = false,
	approvingApprovalId,
	denyingApprovalId,
	onCancelDeny,
	showSenderNames = false,
	composer,
	queuedMessages,
	onQueuedSendNow,
	onQueuedRemove,
	artifactTrigger,
	artifactSheet,
}) => {
	const breadcrumbDetails = useMemo(() => {
		const details: MobileBreadcrumbDetail[] = []
		if (sessionHostName) details.push({ label: 'Host', value: sessionHostName })
		if (workingDir) details.push({ label: 'Directory', value: workingDir, mono: true })
		return details
	}, [sessionHostName, workingDir])

	return (
		<MobileAppLayout>
			<MobileBreadcrumb
				key={sessionId}
				title={sessionTitle}
				isHostOffline={isSessionHostOffline}
				details={breadcrumbDetails}
				showBackButton
				onBack={onBack}
				rightElement={artifactTrigger}
			/>

			<MobileSessionStream
				events={events}
				toolResultsByKey={toolResultsByKey}
				compactionSummaries={compactionSummaries}
				workingDir={workingDir}
				fileSnapshots={fileSnapshots}
				onOpenFile={onOpenFile}
				onApprove={onApprove}
				onDeny={onDeny}
				onApproveWithSuggestions={onApproveWithSuggestions}
				approvalActionsHidden={approvalActionsHidden}
				approvingApprovalId={approvingApprovalId}
				denyingApprovalId={denyingApprovalId}
				onCancelDeny={onCancelDeny}
				showSenderNames={showSenderNames}
			/>

			{/* Queued messages (between the stream and the composer, like desktop) */}
			{queuedMessages && queuedMessages.length > 0 && (
				<MobileQueuedMessages messages={queuedMessages} onSendNow={onQueuedSendNow} onRemove={onQueuedRemove} />
			)}

			{composer}
			{artifactSheet}
		</MobileAppLayout>
	)
}
