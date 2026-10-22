import type { ConversationEvent, AgentEventGroup } from '@humanlayer/ui/components/conversation-stream'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { latestGitPushEventId } from '@/components/github/push-detection'
import { WiredGitHubPushAttention, WiredGitHubPushCard } from '@/components/github/WiredGitHubPushCard'
import { NEXT_STEP_INDICATOR_CLEARANCE_PX } from '@/components/NextStepIndicator'
import { useSessionDetail } from '@/components/session-detail/session-detail-context'
import { useExpansionStore } from '@/hooks/stores/expansionStore'
import { useFocusStore } from '@/hooks/stores/focusStore'
import { useAutoScrollOnNewEvents } from '@/hooks/useAutoScrollOnNewEvents'
import { useIsAtBottom } from '@/hooks/useIsAtBottom'
import { useMountEffect } from '@/hooks/useMountEffect'
import { recordSendScrollDiagnostic } from '@/lib/send-scroll-diagnostics'
import { compactedHistoryId, getCompactedHistory, revealedHistoryStart } from '@/utils/compacted-history'
import { getLatestRealRootUserMessage } from '@/utils/current-turn'

import { CompactedHistoryRow } from './CompactedHistoryRow'
import { shouldPinLatestUserMessage } from './stickyUserMessage'
import { StreamingRowsContainer } from './StreamingRowsContainer'
import { WiredAgentGroupEventRow } from './WiredAgentGroupEventRow'
import { WiredConversationEventRow } from './WiredConversationEventRow'
import { type WorkingBlock, WorkingBlockRow } from './WorkingBlockRow'

export type VirtualStreamItem =
	| {
			type: 'root'
			event: ConversationEvent
			group: AgentEventGroup
			parentToolId?: string
			parentBlockId?: string
			nestingDepth: number
			parentCompactionId?: string
	  }
	| {
			type: 'event'
			event: ConversationEvent
			parentToolId?: string
			parentBlockId?: string
			nestingDepth: number
			parentCompactionId?: string
	  }
	| { type: 'workblock'; block: WorkingBlock; isExpanded: boolean; isTail: boolean; parentCompactionId?: string }
	| { type: 'compacted'; id: string; eventCount: number; revealedCount: number; isExpanded: boolean }

export interface VisibleNavigationItem {
	id: string
	type: 'event' | 'agentgroup' | 'subevent' | 'workblock' | 'compacted'
	toolId?: string
	parentToolId?: string
	parentBlockId?: string
	/** Set on rows revealed inside an expanded compacted history. */
	parentCompactionId?: string
}

/** Root events that read as "work": thinking and tool calls (including agent launches). */
function isWorkEvent(event: ConversationEvent): boolean {
	return (
		event.eventType === 'thinking' ||
		event.eventType === 'tool_call' ||
		(event.eventType === 'message' && event.role === 'assistant' && !!event.content?.startsWith('<thinking>'))
	)
}

function buildWorkingBlock(runEvents: ConversationEvent[], agentGroups: Map<string, AgentEventGroup>): WorkingBlock {
	const first = runEvents[0]
	const last = runEvents[runEvents.length - 1]
	if (first === undefined || last === undefined) {
		throw new Error('buildWorkingBlock requires at least one event')
	}
	const firstMs = first.createdAt ? new Date(first.createdAt).getTime() : Number.NaN
	const lastMs = last.createdAt ? new Date(last.createdAt).getTime() : Number.NaN
	const toolCalls = runEvents.filter((e) => e.eventType === 'tool_call')
	let hasPendingApproval = runEvents.some((e) => e.approvalStatus === 'pending')
	const agentLines = runEvents.flatMap((event) => {
		const group = event.toolId ? agentGroups.get(event.toolId) : undefined
		if (!group) return []
		if (group.hasPendingApproval) hasPendingApproval = true
		let name = event.toolName || 'Agent'
		let description = ''
		try {
			const agentInput = JSON.parse(event.toolInputJson || '{}')
			name = agentInput.subagent_type || name
			description = agentInput.description || ''
		} catch {
			// Ignore parse errors
		}
		return [
			{
				eventId: event.id,
				name,
				description,
				isCompleted: !!event.isCompleted,
				hasPendingApproval: group.hasPendingApproval,
			},
		]
	})
	return {
		id: `work-${first.id}`,
		events: runEvents,
		toolCallCount: toolCalls.length,
		durationMs: Number.isFinite(firstMs) && Number.isFinite(lastMs) ? Math.max(0, lastMs - firstMs) : 0,
		latestToolCall: toolCalls[toolCalls.length - 1] ?? null,
		agentLines,
		hasPendingApproval,
	}
}

export type VisibleEventIndex = Map<string, number>

/** The focus/navigation id of a virtual row: the event id, or the block/fold id for synthetic rows. */
function virtualItemId(item: VirtualStreamItem): string {
	if (item.type === 'workblock') return item.block.id
	if (item.type === 'compacted') return item.id
	return item.event.id
}

/**
 * The virtualized conversation stream for the desktop session detail page.
 * Pulls events, handlers, and the shared virtualizer/navigation refs from
 * useSessionDetail() and populates those refs for the hooks that drive
 * keyboard navigation and scroll-to-event.
 */
export function WiredConversationStream() {
	const {
		sessionId,
		session,
		conversation,
		isRunning,
		nextStep,
		jumpToBottom,
		virtualizerRef,
		virtualItemsRef,
		scrollContainerRef,
		visibleEventIndexRef,
		visibleItemCountRef,
		visibleItemsRef,
	} = useSessionDetail()
	const { rootEvents, agentGroups, hasSubAgents } = conversation
	const taskId = session.task_id
	const sessionStatus = session.status
	const nextStepVisible = nextStep.nextStepVisible

	// Get expansion state from store
	const expandedAgents = useExpansionStore((s) => s.expandedAgents)
	const expandedWorkBlocks = useExpansionStore((s) => s.expandedWorkBlocks)
	const expandedCompactions = useExpansionStore((s) => s.expandedCompactions)
	const compactionRevealCounts = useExpansionStore((s) => s.compactionRevealCounts)
	const clearExpansion = useExpansionStore((s) => s.clear)

	// Auto-expand agents with pending approvals
	useEffect(() => {
		if (!hasSubAgents) {
			return
		}

		// Find all agents with pending approvals
		const agentsWithPendingApprovals: string[] = []
		agentGroups.forEach((group, agentId) => {
			if (group.hasPendingApproval && !expandedAgents.has(agentId)) {
				agentsWithPendingApprovals.push(agentId)
			}
		})

		// Auto-expand agents with pending approvals
		if (agentsWithPendingApprovals.length > 0) {
			agentsWithPendingApprovals.forEach((agentId) => {
				useExpansionStore.getState().expand(agentId)
			})
		}
	}, [agentGroups, hasSubAgents, expandedAgents])

	// Clear expansion state when component unmounts or session changes
	useEffect(() => {
		return () => {
			clearExpansion()
		}
	}, [sessionId, clearExpansion])

	// Scroll container ref for the virtualizer
	const parentRef = useRef<HTMLDivElement>(null)

	// Forward the scroll container element to the route so hooks at that level
	// can read viewport geometry without DOM querying.
	scrollContainerRef.current = parentRef.current

	// Track whether the user is at the bottom of the scroll container; gates sticky-bottom
	// auto-scroll on new events.
	const { isAtBottomRef } = useIsAtBottom(parentRef, 200)

	const virtualItems = useMemo(() => {
		const items: VirtualStreamItem[] = []
		const pushEvent = (
			event: ConversationEvent,
			parentBlockId?: string,
			parentToolId?: string,
			nestingDepth = 0,
			parentCompactionId?: string,
		) => {
			const group = event.toolId ? agentGroups.get(event.toolId) : undefined
			if (group) {
				items.push({
					type: 'root',
					event,
					group,
					parentToolId,
					parentBlockId,
					nestingDepth,
					parentCompactionId,
				})
				if (event.toolId && expandedAgents.has(event.toolId)) {
					for (const subEvent of group.subAgentEvents) {
						if (subEvent.eventType !== 'tool_result') {
							pushEvent(subEvent, parentBlockId, event.toolId, nestingDepth + 1, parentCompactionId)
						}
					}
				}
				return
			}
			items.push({ type: 'event', event, parentToolId, parentBlockId, nestingDepth, parentCompactionId })
		}

		// Contiguous runs of ≥2 work events (thinking/tool calls) collapse into a
		// "working" block; a block with a pending approval is forced open so the
		// approval UI stays reachable.
		const pushRange = (start: number, end: number, parentCompactionId?: string) => {
			let i = start
			while (i < end) {
				const event = rootEvents[i]
				if (event === undefined) break
				if (isWorkEvent(event)) {
					let runEnd = i
					while (runEnd < end) {
						const candidate = rootEvents[runEnd]
						if (candidate === undefined || !isWorkEvent(candidate)) break
						runEnd++
					}
					const runEvents = rootEvents.slice(i, runEnd)
					if (runEvents.length >= 2) {
						const block = buildWorkingBlock(runEvents, agentGroups)
						const isExpanded = block.hasPendingApproval || expandedWorkBlocks.has(block.id)
						items.push({
							type: 'workblock',
							block,
							isExpanded,
							isTail: runEnd === rootEvents.length,
							parentCompactionId,
						})
						if (isExpanded) {
							for (const runEvent of runEvents)
								pushEvent(runEvent, block.id, undefined, 0, parentCompactionId)
						}
						i = runEnd
						continue
					}
				}
				pushEvent(event, undefined, undefined, 0, parentCompactionId)
				i++
			}
		}

		// Everything the latest compaction summarized away folds behind one header.
		// Expanding reveals the newest page of it ahead of the boundary; older events
		// stay truncated at the top until the reader asks for more.
		const compacted = getCompactedHistory(rootEvents)
		if (compacted) {
			const id = compactedHistoryId(compacted.boundaryEventId)
			const isExpanded = expandedCompactions.has(id)
			const revealStart = isExpanded
				? revealedHistoryStart(compacted, compactionRevealCounts.get(id))
				: compacted.foldedCount
			items.push({
				type: 'compacted',
				id,
				eventCount: compacted.foldedCount,
				revealedCount: compacted.foldedCount - revealStart,
				isExpanded,
			})
			if (isExpanded) pushRange(revealStart, compacted.foldedCount, id)
			pushRange(compacted.foldedCount, rootEvents.length)
		} else {
			pushRange(0, rootEvents.length)
		}
		return items
	}, [rootEvents, agentGroups, expandedAgents, expandedWorkBlocks, expandedCompactions, compactionRevealCounts])

	// While streaming rows are mounted, their resize pin owns tail-follow; jumpToBottom's
	// scrollToIndex + rAF retries chase a target that moves every reveal tick and never
	// settle. A single scrollTop write per append is enough until the stream hands off.
	const streamingRowsActiveRef = useRef(false)
	const followTailOnNewItems = useCallback(() => {
		if (streamingRowsActiveRef.current) {
			const el = parentRef.current
			if (el) el.scrollTop = el.scrollHeight
			return
		}
		jumpToBottom()
	}, [jumpToBottom])

	// Sticky-bottom: when the visible item count grows (new root event OR new sub-agent row
	// streamed under an expanded agent group) and the user is within threshold of the bottom,
	// snap to the new tail. Entirely stateless — no persistent isSticky flag. Expanding a
	// working block or agent group also grows the item count, so the expansion sets feed the
	// baseline-reset key: expansion-driven growth must not yank scroll or keyboard focus to
	// the last row.
	const expansionEpoch = useMemo(
		() => ({
			agents: expandedAgents,
			blocks: expandedWorkBlocks,
			compactions: expandedCompactions,
			reveals: compactionRevealCounts,
		}),
		[expandedAgents, expandedWorkBlocks, expandedCompactions, compactionRevealCounts],
	)
	useAutoScrollOnNewEvents({
		itemCount: virtualItems.length,
		isAtBottomRef,
		jumpToBottom: followTailOnNewItems,
		growthBaselineKey: expansionEpoch,
	})

	// Keep the conversation pinned to the bottom when the scroll viewport itself
	// changes size (terminal open/close/drag-resize, QueuedMessagesPane appearing,
	// ContinueSessionInput line growth, sidebar resize). isAtBottomRef is updated
	// only on scroll events, so reading it here gives the pre-resize at-bottom value.
	useLayoutEffect(() => {
		const el = parentRef.current
		if (!el) return
		let rafId: number | null = null
		const observer = new ResizeObserver(() => {
			recordSendScrollDiagnostic('conversation_resize_observed', {
				isAtBottom: isAtBottomRef.current,
				jumpAlreadyScheduled: rafId !== null,
			})
			if (!isAtBottomRef.current) return
			if (rafId !== null) cancelAnimationFrame(rafId)
			rafId = requestAnimationFrame(() => {
				rafId = null
				recordSendScrollDiagnostic('conversation_resize_jump_requested')
				jumpToBottom()
			})
		})
		observer.observe(el)
		return () => {
			if (rafId !== null) cancelAnimationFrame(rafId)
			observer.disconnect()
		}
	}, [isAtBottomRef, jumpToBottom])

	const visibleEventIndex = useMemo(() => {
		const index = new Map<string, number>()
		virtualItems.forEach((item, itemIndex) => {
			index.set(virtualItemId(item), itemIndex)
		})
		return index
	}, [virtualItems])
	const latestUserMessage = useMemo(() => getLatestRealRootUserMessage(rootEvents), [rootEvents])

	const visibleNavigationItems = useMemo(
		() =>
			virtualItems.map((item): VisibleNavigationItem => {
				if (item.type === 'workblock') {
					return { id: item.block.id, type: 'workblock', parentCompactionId: item.parentCompactionId }
				}
				if (item.type === 'compacted') {
					return { id: item.id, type: 'compacted' }
				}
				if (item.type === 'root') {
					return {
						id: item.event.id,
						type: 'agentgroup',
						toolId: item.event.toolId,
						parentToolId: item.parentToolId,
						parentBlockId: item.parentBlockId,
						parentCompactionId: item.parentCompactionId,
					}
				}

				return {
					id: item.event.id,
					type: item.parentToolId ? 'subevent' : 'event',
					toolId: item.event.toolId,
					parentToolId: item.parentToolId,
					parentBlockId: item.parentBlockId,
					parentCompactionId: item.parentCompactionId,
				}
			}),
		[virtualItems],
	)

	// Set up virtualizer for windowed rendering
	const virtualizer = useVirtualizer({
		count: virtualItems.length,
		getScrollElement: () => parentRef.current,
		estimateSize: () => 100, // Median row height (~101px) - mean (320px) felt choppy
		// Adds trailing clearance so the floating NextStepIndicator does not cover
		// the bottom-most conversation row when scrolled to the tail of the stream.
		paddingEnd: nextStepVisible ? NEXT_STEP_INDICATOR_CLEARANCE_PX : 0,
		getItemKey: (index) => {
			const item = virtualItems[index]
			if (!item) return index
			return virtualItemId(item)
		},
		// Small overscan: rows are heavy (markdown + shiki + per-row live queries), and 20
		// meant ~40 invisible rows paying full mount cost on session entry. Measured heights
		// are cached per event id, so j/k re-visits stay cheap.
		overscan: 3,
	})
	const deferInitialMeasurementsRef = useRef(true)
	const pendingInitialMeasurementsRef = useRef(new Set<Element>())
	const measureElement = useCallback(
		(element: Element | null) => {
			if (!element) return
			if (deferInitialMeasurementsRef.current) {
				pendingInitialMeasurementsRef.current.add(element)
				return
			}
			virtualizer.measureElement(element)
		},
		[virtualizer],
	)
	useMountEffect(() => {
		// Let the estimated rows paint once before their real heights trigger layout.
		let secondFrame = 0
		const firstFrame = requestAnimationFrame(() => {
			secondFrame = requestAnimationFrame(() => {
				deferInitialMeasurementsRef.current = false
				for (const element of pendingInitialMeasurementsRef.current) {
					if (element.isConnected) virtualizer.measureElement(element)
				}
				pendingInitialMeasurementsRef.current.clear()
			})
		})
		return () => {
			cancelAnimationFrame(firstFrame)
			cancelAnimationFrame(secondFrame)
			pendingInitialMeasurementsRef.current.clear()
		}
	})

	// Populate refs for external hook consumption (virtualizer holds an imperative scroll API)
	virtualizerRef.current = virtualizer
	virtualItemsRef.current = virtualItems
	visibleEventIndexRef.current = visibleEventIndex
	visibleItemCountRef.current = virtualItems.length
	visibleItemsRef.current = visibleNavigationItems

	// Find the first user message — forking from it is not allowed (nothing before it to fork from)
	const firstUserMessageId = useMemo(
		() => rootEvents.find((e) => e.role === 'user' && e.eventType === 'message')?.id ?? null,
		[rootEvents],
	)

	// Only the session's most recent completed push carries the GitHub card, so five pushes show one.
	const latestPush = useMemo(() => {
		const eventId = latestGitPushEventId(rootEvents)
		const toolId = eventId ? rootEvents.find((e) => e.id === eventId)?.toolId : undefined
		return eventId && toolId ? { eventId, toolId } : null
	}, [rootEvents])

	// Sticky headers: when the row at the top of the viewport belongs to an expanded
	// working block and/or an expanded agent group whose header has scrolled off, pin
	// copies of those headers over the stream so they can be collapsed without
	// scrolling back up. (Rows are transform-positioned by the virtualizer, so CSS
	// sticky can't work.) An agent group nested inside a block stacks under the
	// block header with the same nested indent as the in-stream rows.
	const [sticky, setSticky] = useState<{
		userEventId: string | null
		blockId: string | null
		agentEventId: string | null
		agentInBlock: boolean
	}>({ userEventId: null, blockId: null, agentEventId: null, agentInBlock: false })
	// Set on pinned-prompt click so the pin stays hidden while the source row
	// shows at the top. scrollTop tracks the lowest position seen while
	// suppressed: the virtualizer's landing offset can differ from the measured
	// row offset by tens of pixels, so an exact-offset check would re-pin right
	// after the jump. The pin returns once the user scrolls down past the anchor.
	const suppressedPinnedUserRef = useRef<{ id: string; scrollTop: number | null } | null>(null)
	// Heights of the rendered overlay pieces. Rows must not scroll behind the
	// overlay before their header pins, so each header's activation threshold is
	// offset by the overlay content stacked above it: the work header pins when
	// it touches the bottom of the pinned prompt, and the agent header when it
	// touches the bottom of the pinned prompt + work header.
	const pinnedUserRowRef = useRef<HTMLDivElement | null>(null)
	const pinnedBlockRef = useRef<HTMLDivElement | null>(null)
	const stickySyncEnabledRef = useRef(false)
	const syncSticky = () => {
		if (!stickySyncEnabledRef.current) return
		const el = parentRef.current
		let userEventId: string | null = null
		let blockId: string | null = null
		let agentEventId: string | null = null
		let agentInBlock = false
		if (el && el.scrollTop > 0) {
			const scrollTop = el.scrollTop
			if (latestUserMessage) {
				const userIndex = visibleEventIndex.get(latestUserMessage.id)
				const [userOffset] = userIndex == null ? [] : (virtualizer.getOffsetForIndex(userIndex, 'start') ?? [])
				const userRow =
					userIndex == null ? undefined : virtualizer.getVirtualItems().find((row) => row.index === userIndex)
				if (
					shouldPinLatestUserMessage({
						rowStart: userOffset,
						rowEnd: userRow?.end,
						scrollTop,
					})
				) {
					const suppressed = suppressedPinnedUserRef.current
					if (suppressed?.id === latestUserMessage.id) {
						suppressed.scrollTop =
							suppressed.scrollTop == null ? scrollTop : Math.min(suppressed.scrollTop, scrollTop)
						if (scrollTop > suppressed.scrollTop + 1) {
							suppressedPinnedUserRef.current = null
							userEventId = latestUserMessage.id
						}
					} else {
						suppressedPinnedUserRef.current = null
						userEventId = latestUserMessage.id
					}
				} else if (suppressedPinnedUserRef.current?.id === latestUserMessage.id) {
					suppressedPinnedUserRef.current = null
				}
			}
			// Freshly pinned overlay pieces measure 0 until they render; the
			// sticky-keyed re-sync below re-runs with real heights next pass.
			const blockThreshold = scrollTop + (userEventId ? (pinnedUserRowRef.current?.offsetHeight ?? 0) : 0)
			for (const row of virtualizer.getVirtualItems()) {
				if (row.end <= blockThreshold) continue
				const item = virtualItems[row.index]
				if (!item) break
				if (item.type === 'workblock') {
					if (item.isExpanded && row.start < blockThreshold) blockId = item.block.id
				} else if (item.type !== 'compacted') {
					blockId = item.parentBlockId ?? null
				}
				break
			}
			const agentThreshold = blockThreshold + (blockId ? (pinnedBlockRef.current?.offsetHeight ?? 0) : 0)
			for (const row of virtualizer.getVirtualItems()) {
				if (row.end <= agentThreshold) continue
				const item = virtualItems[row.index]
				if (!item) break
				if (item.type === 'root') {
					// The agent header itself is partially scrolled behind the overlay while expanded.
					if (row.start < agentThreshold && item.event.toolId && expandedAgents.has(item.event.toolId)) {
						agentEventId = item.event.id
						agentInBlock = !!item.parentBlockId
					}
				} else if (item.type === 'event' && item.parentToolId) {
					// A sub-agent row is at the overlay edge: pin its parent agent header.
					const group = agentGroups.get(item.parentToolId)
					if (group) {
						agentEventId = group.parentAgent.id
						agentInBlock = !!item.parentBlockId
					}
				}
				break
			}
		}
		setSticky((prev) =>
			prev.userEventId === userEventId &&
			prev.blockId === blockId &&
			prev.agentEventId === agentEventId &&
			prev.agentInBlock === agentInBlock
				? prev
				: { userEventId, blockId, agentEventId, agentInBlock },
		)
	}
	useMountEffect(() => {
		// Sticky overlays are not needed until after the initial conversation frame.
		let secondFrame = 0
		const firstFrame = requestAnimationFrame(() => {
			secondFrame = requestAnimationFrame(() => {
				stickySyncEnabledRef.current = true
				syncSticky()
			})
		})
		return () => {
			cancelAnimationFrame(firstFrame)
			cancelAnimationFrame(secondFrame)
		}
	})
	// Re-evaluate when the item list changes (expand/collapse, streamed events),
	// and when the sticky state itself changes so just-mounted overlay pieces
	// contribute their measured heights to the thresholds. setSticky bails on
	// equality, so this converges instead of looping.
	// eslint-disable-next-line react-hooks/exhaustive-deps
	useLayoutEffect(syncSticky, [virtualItems, sticky])

	// Re-anchor after collapsing a group whose header has scrolled off (e.g. via
	// its sticky copy): the removed rows leave scrollTop pointing past the new
	// content height, and the browser clamps it to the bottom of the stream.
	// Instead, pin the collapsed header to the top of the viewport and focus it.
	const prevExpandedRef = useRef({ agents: expandedAgents, blocks: expandedWorkBlocks })
	useLayoutEffect(() => {
		const prev = prevExpandedRef.current
		prevExpandedRef.current = { agents: expandedAgents, blocks: expandedWorkBlocks }
		const collapsedIds: string[] = []
		for (const toolId of prev.agents) {
			if (!expandedAgents.has(toolId)) {
				const group = agentGroups.get(toolId)
				if (group) collapsedIds.push(group.parentAgent.id)
			}
		}
		for (const blockId of prev.blocks) {
			if (!expandedWorkBlocks.has(blockId)) collapsedIds.push(blockId)
		}
		if (collapsedIds.length !== 1) return
		const headerId = collapsedIds[0]
		if (headerId === undefined) return
		const index = visibleEventIndex.get(headerId)
		const el = parentRef.current
		if (index == null || !el) return
		const [headerOffset] = virtualizer.getOffsetForIndex(index, 'start') ?? []
		// Only act when the header sits above the viewport — an in-view header
		// collapses in place and needs no correction.
		if (headerOffset == null || headerOffset >= el.scrollTop) return
		virtualizer.scrollToIndex(index, { align: 'start' })
		useFocusStore.getState().setFocusedEventId(headerId, 'mouse')
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [expandedAgents, expandedWorkBlocks])
	const stickyBlockItem = sticky.blockId
		? virtualItems.find((it) => it.type === 'workblock' && it.block.id === sticky.blockId)
		: undefined
	const handlePinnedUserMessageClick = useCallback(() => {
		const userEventId = sticky.userEventId
		if (!userEventId) return
		const index = visibleEventIndex.get(userEventId)
		if (index == null) return
		suppressedPinnedUserRef.current = { id: userEventId, scrollTop: null }
		setSticky({ userEventId: null, blockId: null, agentEventId: null, agentInBlock: false })
		virtualizer.scrollToIndex(index, { align: 'start' })
		useFocusStore.getState().setFocusedEventId(userEventId, 'mouse')
		requestAnimationFrame(() => {
			setSticky({ userEventId: null, blockId: null, agentEventId: null, agentInBlock: false })
		})
	}, [sticky.userEventId, visibleEventIndex, virtualizer])

	// Render root events and agent groups
	return (
		<div className="relative flex min-h-0 flex-1 flex-col">
			{latestPush && <WiredGitHubPushAttention sessionId={sessionId} toolCallId={latestPush.toolId} />}
			{(sticky.userEventId || stickyBlockItem?.type === 'workblock' || sticky.agentEventId) && (
				<div className="absolute inset-x-0 top-0 z-20 bg-background shadow-sm">
					{sticky.userEventId && (
						<div ref={pinnedUserRowRef}>
							<WiredConversationEventRow
								eventId={sticky.userEventId}
								sessionId={sessionId}
								canForkFromMessage={sticky.userEventId !== firstUserMessageId}
								presentation="pinned-user-message"
								onPinnedUserMessageClick={handlePinnedUserMessageClick}
							/>
						</div>
					)}
					{stickyBlockItem?.type === 'workblock' && (
						<div ref={pinnedBlockRef}>
							<WorkingBlockRow
								block={stickyBlockItem.block}
								isExpanded
								isActive={stickyBlockItem.isTail && isRunning}
							/>
						</div>
					)}
					{sticky.agentEventId && (
						<div className={sticky.agentInBlock ? 'ml-6 border-l-2 border-muted/20' : undefined}>
							<WiredAgentGroupEventRow parentAgentEventId={sticky.agentEventId} sessionId={sessionId} />
						</div>
					)}
				</div>
			)}
			<div
				ref={parentRef}
				onScroll={syncSticky}
				className="min-h-0 flex-1 overflow-y-auto"
				data-conversation-container
			>
				<div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
					{virtualizer.getVirtualItems().map((virtualRow) => {
						const item = virtualItems[virtualRow.index]
						if (!item) return null
						return (
							<div
								key={virtualRow.key}
								data-index={virtualRow.index}
								ref={measureElement}
								style={{
									position: 'absolute',
									top: 0,
									left: 0,
									width: '100%',
									transform: `translateY(${virtualRow.start}px)`,
								}}
							>
								{(() => {
									if (item.type === 'compacted') {
										return (
											<CompactedHistoryRow
												key={item.id}
												id={item.id}
												eventCount={item.eventCount}
												revealedCount={item.revealedCount}
												isExpanded={item.isExpanded}
											/>
										)
									}
									if (item.type === 'workblock') {
										// A folded block hides its rows, so the card lands under the block instead.
										const holdsLatestPush =
											!item.isExpanded &&
											latestPush !== null &&
											item.block.events.some((e) => e.id === latestPush.eventId)
										return (
											<>
												<WorkingBlockRow
													key={item.block.id}
													block={item.block}
													isExpanded={item.isExpanded}
													isActive={item.isTail && isRunning}
												/>
												{holdsLatestPush && latestPush ? (
													<WiredGitHubPushCard
														sessionId={sessionId}
														toolCallId={latestPush.toolId}
													/>
												) : null}
											</>
										)
									}
									const content =
										item.type === 'root' ? (
											<WiredAgentGroupEventRow
												key={item.group.parentAgent.id}
												parentAgentEventId={item.group.parentAgent.id}
												sessionId={sessionId}
											/>
										) : (
											<WiredConversationEventRow
												key={item.event.id}
												eventId={item.event.id}
												sessionId={item.event.sessionId}
												isGroupItem={!!item.parentToolId}
												canForkFromMessage={item.event.id !== firstUserMessageId}
												showGitHubPushCard={item.event.id === latestPush?.eventId}
											/>
										)
									const renderedDepth = item.nestingDepth + (item.parentBlockId ? 1 : 0)
									return renderedDepth > 0 ? (
										<div
											className="border-l-2 border-muted/20"
											style={{ marginLeft: `${renderedDepth * 1.5}rem` }}
										>
											{content}
										</div>
									) : (
										content
									)
								})()}
							</div>
						)
					})}
				</div>
				<StreamingRowsContainer
					sessionId={sessionId}
					scrollContainerRef={parentRef}
					isAtBottomRef={isAtBottomRef}
					renderedConversationEventIds={visibleEventIndex}
					savedEventIds={conversation.savedEventIds}
					sessionStatus={sessionStatus}
					taskId={taskId}
					streamingRowsActiveRef={streamingRowsActiveRef}
					onStreamingRowsSettled={jumpToBottom}
				/>
			</div>
		</div>
	)
}
