import { eq, useLiveQuery } from '@tanstack/react-db'
import { type MutableRefObject, memo, useEffect, useLayoutEffect, useMemo, useRef } from 'react'

import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { useInProgressTextBlocks } from '@/hooks/useInProgressTextBlocks'
import { useInProgressThinkingBlocks } from '@/hooks/useInProgressThinkingBlocks'
import { useStreamDB } from '@/hooks/useStreamDB'
import { captureException } from '@/integrations/sentry/sentry'
import { logger } from '@/lib/logger'

import {
	findNewestStreamEventAlreadyDeliveredBySync,
	shouldHideStreamBlockBecauseNewerSyncRowsRendered,
} from './streamingHandoffSuppression'
import { StreamingTextRow } from './StreamingTextRow'
import { StreamingThinkingRow } from './StreamingThinkingRow'

interface StreamingRowsContainerProps {
	/** Supplied alongside savedEventIds by the same mounted conversation owner. */
	sessionId: string
	scrollContainerRef: MutableRefObject<HTMLDivElement | null>
	isAtBottomRef: MutableRefObject<boolean>
	renderedConversationEventIds: { has: (id: string) => boolean }
	/** Membership from the main saved-event query, including rows not rendered in the timeline. */
	savedEventIds: ReadonlySet<string>
	sessionStatus: string
	taskId: string | null
	/** Published true while streaming rows are mounted so the item-growth auto-scroll can
	 * use the cheap resize pin instead of the virtualizer's scrollToIndex retry chase. */
	streamingRowsActiveRef: MutableRefObject<boolean>
	/** Called once when the last streaming row hands off while pinned to the bottom, so the
	 * caller can re-anchor through the virtualizer exactly once instead of per append. */
	onStreamingRowsSettled: () => void
}

export const StreamingRowsContainer = memo(function StreamingRowsContainer({
	sessionId,
	scrollContainerRef,
	isAtBottomRef,
	renderedConversationEventIds,
	savedEventIds,
	sessionStatus,
	taskId,
	streamingRowsActiveRef,
	onStreamingRowsSettled,
}: StreamingRowsContainerProps) {
	if (!sessionId) return null

	return (
		<StreamingRowsContainerInner
			sessionId={sessionId}
			scrollContainerRef={scrollContainerRef}
			isAtBottomRef={isAtBottomRef}
			renderedConversationEventIds={renderedConversationEventIds}
			savedEventIds={savedEventIds}
			sessionStatus={sessionStatus}
			taskId={taskId}
			streamingRowsActiveRef={streamingRowsActiveRef}
			onStreamingRowsSettled={onStreamingRowsSettled}
		/>
	)
})

const StreamingRowsContainerInner = memo(function StreamingRowsContainerInner({
	sessionId,
	scrollContainerRef,
	isAtBottomRef,
	renderedConversationEventIds,
	savedEventIds,
	sessionStatus,
	taskId,
	streamingRowsActiveRef,
	onStreamingRowsSettled,
}: { sessionId: string } & StreamingRowsContainerProps) {
	const containerRef = useRef<HTMLDivElement | null>(null)
	const streamingRenderingEnabled = useSettingsStore((s) => s.streamingRenderingEnabled)
	const streamDb = useStreamDB(sessionId)
	const inProgressTextBlocksQuery = useInProgressTextBlocks(sessionId, streamDb.db, savedEventIds)
	const inProgressThinkingBlocksQuery = useInProgressThinkingBlocks(sessionId, streamDb.db, savedEventIds)
	const streamedEventsThatMayHaveSyncedRowsQuery = useLiveQuery(
		(q) =>
			q
				.from({ event: streamDb.db.collections.conversationEvents })
				.where(({ event }) => eq(event.session_id, sessionId)),
		[streamDb.db.collections.conversationEvents, sessionId],
	)
	const textStopsQuery = useLiveQuery(
		(q) =>
			q
				.from({ stop: streamDb.db.collections.textBlockStops })
				.where(({ stop }) => eq(stop.session_id, sessionId)),
		[streamDb.db.collections.textBlockStops, sessionId],
	)
	const thinkingStopsQuery = useLiveQuery(
		(q) =>
			q
				.from({ stop: streamDb.db.collections.thinkingBlockStops })
				.where(({ stop }) => eq(stop.session_id, sessionId)),
		[streamDb.db.collections.thinkingBlockStops, sessionId],
	)
	const rawBlocks = useMemo(
		() =>
			[
				...inProgressTextBlocksQuery.data.map((block) => ({ blockType: 'text' as const, block })),
				...inProgressThinkingBlocksQuery.data.map((block) => ({ blockType: 'thinking' as const, block })),
			].sort(
				(a, b) =>
					a.block.message_seq - b.block.message_seq ||
					a.block.block_seq - b.block.block_seq ||
					a.block.conversation_event_id.localeCompare(b.block.conversation_event_id),
			),
		[inProgressTextBlocksQuery.data, inProgressThinkingBlocksQuery.data],
	)
	const newestStreamEventAlreadyDeliveredBySync = useMemo(
		() => findNewestStreamEventAlreadyDeliveredBySync(streamedEventsThatMayHaveSyncedRowsQuery.data, savedEventIds),
		[streamedEventsThatMayHaveSyncedRowsQuery.data, savedEventIds],
	)
	const blocks = useMemo(
		() =>
			rawBlocks.filter(
				({ block }) =>
					!shouldHideStreamBlockBecauseNewerSyncRowsRendered(
						block,
						newestStreamEventAlreadyDeliveredBySync,
						savedEventIds,
					),
			),
		[rawBlocks, newestStreamEventAlreadyDeliveredBySync, savedEventIds],
	)
	const textStopsByConversationEventId = useMemo(
		() => new Map(textStopsQuery.data.map((stop) => [stop.conversation_event_id, stop])),
		[textStopsQuery.data],
	)
	const thinkingStopsByConversationEventId = useMemo(
		() => new Map(thinkingStopsQuery.data.map((stop) => [stop.conversation_event_id, stop])),
		[thinkingStopsQuery.data],
	)
	const diagnosticBlocks = useMemo(
		() =>
			blocks.map(({ blockType, block }) => {
				const stop =
					blockType === 'text'
						? textStopsByConversationEventId.get(block.conversation_event_id)
						: thinkingStopsByConversationEventId.get(block.conversation_event_id)

				return {
					blockType,
					conversationEventId: block.conversation_event_id,
					messageSeq: block.message_seq,
					blockSeq: block.block_seq,
					blockSessionId: block.session_id,
					startTimestamp: block.timestamp,
					stopTimestamp: stop?.timestamp,
					hasSyncedConversationEvent: savedEventIds.has(block.conversation_event_id),
					hasRenderedConversationEvent: renderedConversationEventIds.has(block.conversation_event_id),
				}
			}),
		[
			blocks,
			savedEventIds,
			renderedConversationEventIds,
			textStopsByConversationEventId,
			thinkingStopsByConversationEventId,
		],
	)

	useStreamHandoffMismatchDiagnostics({ sessionId, sessionStatus, taskId, blocks: diagnosticBlocks })

	const hasStreamingRows = streamingRenderingEnabled && blocks.length > 0
	streamingRowsActiveRef.current = hasStreamingRows

	useStickToBottomOnStreamingResize({
		streamingContainerRef: containerRef,
		scrollContainerRef,
		isAtBottomRef,
		enabled: hasStreamingRows,
	})

	// One authoritative re-anchor at handoff (last streaming row unmounts while pinned).
	// During streaming the resize pin owns tail-follow; the virtualizer scroll only needs
	// to run after the handed-off rows land in the virtual list.
	const hadStreamingRowsRef = useRef(false)
	useLayoutEffect(() => {
		const had = hadStreamingRowsRef.current
		hadStreamingRowsRef.current = hasStreamingRows
		if (had && !hasStreamingRows && isAtBottomRef.current) {
			onStreamingRowsSettled()
		}
	}, [hasStreamingRows, isAtBottomRef, onStreamingRowsSettled])

	useLayoutEffect(
		() => () => {
			streamingRowsActiveRef.current = false
		},
		[streamingRowsActiveRef],
	)

	if (!hasStreamingRows) return null

	return (
		<div ref={containerRef} data-streaming-rows-container>
			{blocks.map(({ blockType, block }) => {
				const Row = blockType === 'text' ? StreamingTextRow : StreamingThinkingRow

				return (
					<Row
						key={block.conversation_event_id}
						conversationEventId={block.conversation_event_id}
						db={streamDb.db}
						messageSeq={block.message_seq}
						blockSeq={block.block_seq}
					/>
				)
			})}
		</div>
	)
})

type StreamHandoffDiagnosticBlock = {
	blockType: 'text' | 'thinking'
	conversationEventId: string
	messageSeq: number
	blockSeq: number
	blockSessionId: string
	startTimestamp: number
	stopTimestamp?: number
	hasSyncedConversationEvent: boolean
	hasRenderedConversationEvent: boolean
}

type StreamHandoffMismatchReason =
	| 'rendered_but_sync_has_event'
	| 'route_has_event_but_streaming_row_rendered'
	| 'stopped_block_missing_synced_event'
	| 'old_unstopped_stream_block'
	| 'stream_block_session_mismatch'
	| 'duplicate_rendered_streaming_block_id'

const HANDOFF_STOPPED_GRACE_MS = 10_000
const HANDOFF_STOPPED_RUNNING_GRACE_MS = 30_000
const HANDOFF_OLD_UNSTOPPED_GRACE_MS = 60_000
const HANDOFF_OLD_UNSTOPPED_RUNNING_GRACE_MS = 5 * 60_000
const HANDOFF_MISMATCH_REPEAT_MS = 60_000
const HANDOFF_DIAGNOSTIC_INTERVAL_MS = 10_000

function useStreamHandoffMismatchDiagnostics({
	sessionId,
	sessionStatus,
	taskId,
	blocks,
}: {
	sessionId: string
	sessionStatus?: string
	taskId?: string | null
	blocks: StreamHandoffDiagnosticBlock[]
}) {
	const loggedAtRef = useRef(new Map<string, number>())
	const blocksRef = useRef(blocks)
	const statusRef = useRef(sessionStatus)

	const blocksSignature = useMemo(
		() =>
			blocks
				.map((block) =>
					[
						block.blockType,
						block.conversationEventId,
						block.messageSeq,
						block.blockSeq,
						block.blockSessionId,
						block.startTimestamp,
						block.stopTimestamp ?? '',
						block.hasSyncedConversationEvent ? '1' : '0',
						block.hasRenderedConversationEvent ? '1' : '0',
					].join(':'),
				)
				.join('|'),
		[blocks],
	)

	useEffect(() => {
		blocksRef.current = blocks
		statusRef.current = sessionStatus
	}, [blocks, blocksSignature, sessionStatus])

	useEffect(() => {
		const checkForMismatches = () => {
			const now = Date.now()
			const currentBlocks = blocksRef.current
			const duplicateCounts = new Map<string, number>()

			for (const block of currentBlocks) {
				duplicateCounts.set(
					block.conversationEventId,
					(duplicateCounts.get(block.conversationEventId) ?? 0) + 1,
				)
			}

			for (const [conversationEventId, count] of duplicateCounts.entries()) {
				if (count <= 1) continue
				logStreamHandoffMismatchOnce({
					key: `${conversationEventId}:duplicate_rendered_streaming_block_id`,
					now,
					loggedAtRef,
					reason: 'duplicate_rendered_streaming_block_id',
					payload: { sessionId, taskId: taskId ?? null, conversationEventId, count },
				})
			}

			const running = isActiveSessionStatus(statusRef.current)

			for (const block of currentBlocks) {
				const basePayload = {
					sessionId,
					taskId: taskId ?? null,
					conversationEventId: block.conversationEventId,
					blockType: block.blockType,
					messageSeq: block.messageSeq,
					blockSeq: block.blockSeq,
					sessionStatus: statusRef.current,
				}

				if (block.blockSessionId !== sessionId) {
					logStreamHandoffMismatchOnce({
						key: `${block.conversationEventId}:stream_block_session_mismatch`,
						now,
						loggedAtRef,
						reason: 'stream_block_session_mismatch',
						payload: { ...basePayload, blockSessionId: block.blockSessionId },
					})
				}

				if (block.hasSyncedConversationEvent) {
					logStreamHandoffMismatchOnce({
						key: `${block.conversationEventId}:rendered_but_sync_has_event`,
						now,
						loggedAtRef,
						reason: 'rendered_but_sync_has_event',
						payload: basePayload,
					})
				}

				if (block.hasRenderedConversationEvent) {
					logStreamHandoffMismatchOnce({
						key: `${block.conversationEventId}:route_has_event_but_streaming_row_rendered`,
						now,
						loggedAtRef,
						reason: 'route_has_event_but_streaming_row_rendered',
						payload: basePayload,
					})
				}

				if (block.stopTimestamp) {
					const stopAgeMs = now - block.stopTimestamp
					const graceMs = running ? HANDOFF_STOPPED_RUNNING_GRACE_MS : HANDOFF_STOPPED_GRACE_MS
					if (!block.hasSyncedConversationEvent && stopAgeMs > graceMs) {
						logStreamHandoffMismatchOnce({
							key: `${block.conversationEventId}:stopped_block_missing_synced_event`,
							now,
							loggedAtRef,
							reason: 'stopped_block_missing_synced_event',
							payload: { ...basePayload, stopAgeMs },
						})
					}
					continue
				}

				const ageMs = now - block.startTimestamp
				const graceMs = running ? HANDOFF_OLD_UNSTOPPED_RUNNING_GRACE_MS : HANDOFF_OLD_UNSTOPPED_GRACE_MS
				if (ageMs > graceMs) {
					logStreamHandoffMismatchOnce({
						key: `${block.conversationEventId}:old_unstopped_stream_block`,
						now,
						loggedAtRef,
						reason: 'old_unstopped_stream_block',
						payload: { ...basePayload, ageMs },
					})
				}
			}
		}

		checkForMismatches()
		const intervalId = window.setInterval(checkForMismatches, HANDOFF_DIAGNOSTIC_INTERVAL_MS)
		return () => window.clearInterval(intervalId)
	}, [sessionId])
}

function isActiveSessionStatus(sessionStatus?: string) {
	return sessionStatus === 'running' || sessionStatus === 'launching'
}

function logStreamHandoffMismatchOnce({
	key,
	now,
	loggedAtRef,
	reason,
	payload,
}: {
	key: string
	now: number
	loggedAtRef: MutableRefObject<Map<string, number>>
	reason: StreamHandoffMismatchReason
	payload: Record<string, unknown>
}) {
	const lastLoggedAt = loggedAtRef.current.get(key)
	if (lastLoggedAt && now - lastLoggedAt < HANDOFF_MISMATCH_REPEAT_MS) return

	loggedAtRef.current.set(key, now)
	logger.warn('Stream handoff mismatch detected', { reason, ...payload })
	captureException(new Error('Stream handoff mismatch detected'), {
		tags: {
			area: 'conversation_stream',
			reason,
			block_type: typeof payload.blockType === 'string' ? payload.blockType : 'unknown',
			session_status: typeof payload.sessionStatus === 'string' ? payload.sessionStatus : 'unknown',
			// Searchable so a mismatch can be pulled by session and joined to conversation_events in PG.
			// conversationEventId / messageSeq / blockSeq stay in `extra` (now allowlisted from scrubbing)
			// to avoid high-cardinality tags.
			session_id: typeof payload.sessionId === 'string' ? payload.sessionId : 'unknown',
		},
		extra: {
			reason,
			...payload,
		},
	})
}

function useStickToBottomOnStreamingResize({
	streamingContainerRef,
	scrollContainerRef,
	isAtBottomRef,
	enabled,
}: {
	streamingContainerRef: MutableRefObject<HTMLDivElement | null>
	scrollContainerRef: MutableRefObject<HTMLDivElement | null>
	isAtBottomRef: MutableRefObject<boolean>
	enabled: boolean
}) {
	useLayoutEffect(() => {
		if (!enabled) return

		const streamingContainer = streamingContainerRef.current
		const scrollContainer = scrollContainerRef.current
		if (!streamingContainer || !scrollContainer) return

		let frame: number | null = null
		const pinToBottom = () => {
			frame = null
			if (!isAtBottomRef.current) return

			scrollContainer.scrollTop = scrollContainer.scrollHeight
			isAtBottomRef.current = true
		}

		const observer = new ResizeObserver(() => {
			if (!isAtBottomRef.current || frame !== null) return
			frame = window.requestAnimationFrame(pinToBottom)
		})

		observer.observe(streamingContainer)

		return () => {
			observer.disconnect()
			if (frame !== null) {
				window.cancelAnimationFrame(frame)
			}
		}
	}, [enabled, streamingContainerRef, scrollContainerRef, isAtBottomRef])
}
