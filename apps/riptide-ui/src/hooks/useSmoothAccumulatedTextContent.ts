import type { TextDelta, ThinkingDelta } from '@humanlayer/streams/events'
import { useEffect, useRef, useState } from 'react'

import type { RiptideStreamDB } from '@/collections/stream'

const FRAME_MS = 33
// Commit cadence for revealing buffered text. Each tick is one React commit (markdown
// re-render + resize + pin-to-bottom scroll + a full WebKit composite), so this is the
// main knob for streaming render cost. ~15Hz still reads as continuous typing.
const REVEAL_TICK_MS = 66
const DEFAULT_CHARS_PER_SECOND = 180
const MIN_CHARS_PER_SECOND = 55
const MAX_CHARS_PER_SECOND = 280
const FAST_FORWARD_THRESHOLD = 1200
const FAST_FORWARD_CHARS_PER_SECOND = 900
const TARGET_BUFFER_MS = 900
const MIN_TARGET_BUFFER_CHARS = 40
const MAX_TARGET_BUFFER_CHARS = 220
const MIN_STARVATION_MULTIPLIER = 0.45
const STARVATION_RECOVERY_PER_FRAME = 0.006
const HISTORICAL_INSTANT_APPEND_AGE_MS = 5000

type QueuedDelta = Pick<TextDelta | ThinkingDelta, 'delta_seq' | 'content' | 'conversation_event_id' | 'timestamp'>
type PendingDelta = Pick<QueuedDelta, 'content' | 'timestamp'>
type DeltaCollection = RiptideStreamDB['collections']['textDeltas'] | RiptideStreamDB['collections']['thinkingDeltas']

function bufferFullnessMultiplier(bufferFullness: number): number {
	if (bufferFullness < 0.35) return 0.5
	if (bufferFullness < 0.75) return 0.72
	if (bufferFullness > 1.5) return 1.25
	return 1
}

const useSmoothAccumulatedContent = (conversationEventId: string, collection: DeltaCollection) => {
	const [content, setContent] = useState('')
	const displayedRef = useRef('')
	const pendingTextRef = useRef('')
	const pendingDeltasRef = useRef(new Map<number, PendingDelta>())
	const seenDeltaSeqsRef = useRef(new Set<number>())
	const nextDeltaSeqRef = useRef(0)
	const tickRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const lastFrameTimeRef = useRef<number | null>(null)
	const lastDeltaArrivalTimeRef = useRef<number | null>(null)
	const arrivalCharsPerSecondRef = useRef(DEFAULT_CHARS_PER_SECOND)
	const starvationMultiplierRef = useRef(1)
	const carryRef = useRef(0)

	useEffect(() => {
		const resumeCutoffMs = Date.now()

		displayedRef.current = ''
		pendingTextRef.current = ''
		pendingDeltasRef.current = new Map()
		seenDeltaSeqsRef.current = new Set()
		nextDeltaSeqRef.current = 0
		lastFrameTimeRef.current = null
		lastDeltaArrivalTimeRef.current = null
		arrivalCharsPerSecondRef.current = DEFAULT_CHARS_PER_SECOND
		starvationMultiplierRef.current = 1
		carryRef.current = 0
		setContent('')

		const enqueueDelta = (delta: QueuedDelta) => {
			if (delta.conversation_event_id !== conversationEventId) return
			if (seenDeltaSeqsRef.current.has(delta.delta_seq)) return

			if (delta.timestamp >= resumeCutoffMs) {
				const now = performance.now()
				const previousArrival = lastDeltaArrivalTimeRef.current
				if (previousArrival !== null) {
					const elapsedSeconds = Math.max(0.05, (now - previousArrival) / 1000)
					const incomingCharsPerSecond = delta.content.length / elapsedSeconds
					const clampedIncomingRate = Math.max(
						MIN_CHARS_PER_SECOND,
						Math.min(FAST_FORWARD_CHARS_PER_SECOND, incomingCharsPerSecond),
					)
					arrivalCharsPerSecondRef.current =
						arrivalCharsPerSecondRef.current * 0.8 + clampedIncomingRate * 0.2
				}
				lastDeltaArrivalTimeRef.current = now

				if (
					displayedRef.current &&
					pendingTextRef.current.length === 0 &&
					pendingDeltasRef.current.size === 0
				) {
					starvationMultiplierRef.current = Math.max(
						MIN_STARVATION_MULTIPLIER,
						starvationMultiplierRef.current * 0.82,
					)
				}
			}
			seenDeltaSeqsRef.current.add(delta.delta_seq)
			pendingDeltasRef.current.set(delta.delta_seq, { content: delta.content, timestamp: delta.timestamp })
			scheduleTick()
		}

		const drainOrderedDeltas = () => {
			const pendingDeltas = pendingDeltasRef.current
			let displayedContentChanged = false

			while (pendingDeltas.has(nextDeltaSeqRef.current)) {
				const delta = pendingDeltas.get(nextDeltaSeqRef.current)
				pendingDeltas.delete(nextDeltaSeqRef.current)
				nextDeltaSeqRef.current += 1

				if (!delta) continue

				if (resumeCutoffMs - delta.timestamp > HISTORICAL_INSTANT_APPEND_AGE_MS) {
					displayedRef.current += delta.content
					displayedContentChanged = true
					continue
				}

				pendingTextRef.current += delta.content
			}

			return displayedContentChanged
		}

		const revealTick = () => {
			tickRef.current = null
			const timestamp = performance.now()
			const displayedContentChanged = drainOrderedDeltas()
			if (displayedContentChanged) {
				setContent(displayedRef.current)
			}

			const lastFrameTime = lastFrameTimeRef.current ?? timestamp
			const elapsed = Math.max(FRAME_MS, timestamp - lastFrameTime)
			lastFrameTimeRef.current = timestamp

			const pendingText = pendingTextRef.current
			if (pendingText.length > 0) {
				const targetBufferChars = Math.max(
					MIN_TARGET_BUFFER_CHARS,
					Math.min(MAX_TARGET_BUFFER_CHARS, (arrivalCharsPerSecondRef.current * TARGET_BUFFER_MS) / 1000),
				)
				const bufferFullness = pendingText.length / targetBufferChars
				const adaptiveBaseRate = Math.max(
					MIN_CHARS_PER_SECOND,
					Math.min(
						MAX_CHARS_PER_SECOND,
						arrivalCharsPerSecondRef.current * 0.9 * starvationMultiplierRef.current,
					),
				)
				const fullnessMultiplier = bufferFullnessMultiplier(bufferFullness)
				const charsPerSecond =
					pendingText.length > FAST_FORWARD_THRESHOLD
						? FAST_FORWARD_CHARS_PER_SECOND
						: Math.max(MIN_CHARS_PER_SECOND, adaptiveBaseRate * fullnessMultiplier)
				const exactCharsToReveal = (charsPerSecond * elapsed) / 1000 + carryRef.current
				const charsToReveal = Math.max(1, Math.floor(exactCharsToReveal))
				carryRef.current = exactCharsToReveal - charsToReveal

				const nextChunk = pendingText.slice(0, charsToReveal)
				displayedRef.current += nextChunk
				pendingTextRef.current = pendingText.slice(charsToReveal)
				if (pendingTextRef.current.length === 0 && pendingDeltasRef.current.size === 0) {
					starvationMultiplierRef.current = Math.max(
						MIN_STARVATION_MULTIPLIER,
						starvationMultiplierRef.current * 0.88,
					)
				} else if (pendingTextRef.current.length > targetBufferChars * 0.75) {
					starvationMultiplierRef.current = Math.min(
						1,
						starvationMultiplierRef.current + STARVATION_RECOVERY_PER_FRAME,
					)
				}
				setContent(displayedRef.current)
			}

			// Go idle when drained instead of rescheduling: enqueueDelta restarts the
			// loop on the next arrival, so a quiet stream costs nothing between deltas.
			if (pendingTextRef.current.length > 0 || pendingDeltasRef.current.size > 0) {
				scheduleTick()
			} else {
				// Forget the last tick time so the first tick after an idle gap reveals a
				// normal frame's worth of text, not the whole gap's worth at once.
				lastFrameTimeRef.current = null
			}
		}

		const scheduleTick = () => {
			if (tickRef.current !== null) return
			tickRef.current = setTimeout(revealTick, REVEAL_TICK_MS)
		}

		const subscription = collection.subscribeChanges(
			(changes) => {
				for (const change of changes) {
					if (change.type === 'delete') continue
					enqueueDelta(change.value as QueuedDelta)
				}
			},
			{ includeInitialState: true },
		)

		return () => {
			subscription.unsubscribe()
			if (tickRef.current !== null) {
				clearTimeout(tickRef.current)
				tickRef.current = null
			}
		}
	}, [conversationEventId, collection])

	return { content }
}

export const useSmoothAccumulatedTextContent = (conversationEventId: string, db: RiptideStreamDB) =>
	useSmoothAccumulatedContent(conversationEventId, db.collections.textDeltas)

export const useSmoothAccumulatedThinkingContent = (conversationEventId: string, db: RiptideStreamDB) =>
	useSmoothAccumulatedContent(conversationEventId, db.collections.thinkingDeltas)
