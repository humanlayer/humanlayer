import type { ChangeEvent } from '@durable-streams/state'
import type { ConversationEventStream, StreamEvent } from '@humanlayer/streams/events'
import { Cause, Clock, Context, DateTime, Effect, Layer, Ref } from 'effect'
import { uuidv7 } from 'uuidv7'

import { Sentry } from '@/instrument'

import { DurableStreamWriter, DurableStreamWriterLive } from './durable-stream-writer'

export {
	DurableStreamAppendError,
	DurableStreamDetachError,
	DurableStreamFlushError,
	DurableStreamWriter,
	DurableStreamWriterLive,
	type DurableStreamWriterError,
	type DurableStreamWriterService,
	type FlushTimeoutDiagnostics,
} from './durable-stream-writer'
export { DurableStreamFetch, DurableStreamFetchLive } from './durable-stream-fetch'
export {
	notFoundHealDelayMs,
	planNotFoundHeal,
	type NotFoundHealAction,
	type NotFoundHealState,
} from './stream-producer-recovery'

export interface StreamProducerService {
	readonly writeMessageStart: () => Effect.Effect<void>
	readonly writeMessageStop: () => Effect.Effect<void>
	readonly startTextBlock: (blockSeq: number) => Effect.Effect<{ readonly conversationEventId: string }>
	readonly writeTextDelta: (content: string) => Effect.Effect<void>
	readonly writeTextDeltaForSource?: (input: {
		readonly sourceBlockId: string
		readonly content: string
	}) => Effect.Effect<void>
	readonly writeTextBlockStop: () => Effect.Effect<void>
	readonly startThinkingBlock: (blockSeq: number) => Effect.Effect<{ readonly conversationEventId: string }>
	readonly writeThinkingDelta: (content: string) => Effect.Effect<void>
	readonly writeThinkingDeltaForSource?: (input: {
		readonly sourceBlockId: string
		readonly content: string
	}) => Effect.Effect<void>
	readonly writeThinkingBlockStop: () => Effect.Effect<void>
	readonly writeContentBlockStop: (blockSeq: number) => Effect.Effect<void>
	readonly writeContentBlockStopForSource?: (input: { readonly sourceBlockId: string }) => Effect.Effect<void>
	readonly closeMessageAndDiscardUnmaterializedBlocks?: () => Effect.Effect<void>
	readonly writeConversationEvent: (
		event: Omit<ConversationEventStream, 'id' | 'type' | 'message_seq' | 'timestamp'> & {
			readonly message_seq?: number
			readonly timestamp?: number
		},
	) => Effect.Effect<void>
	readonly getConversationEventIdForBlock: (
		blockSeq: number,
		blockType?: 'text' | 'thinking' | 'tool_use',
	) => Effect.Effect<string | null>
	readonly consumeNextConversationEventIdByType: (
		blockType: 'text' | 'thinking' | 'tool_use',
	) => Effect.Effect<string | null>
	readonly getUnconsumedEmittedBlocks: () => Effect.Effect<
		Array<{
			readonly conversationEventId: string
			readonly blockSeq: number
			readonly messageSeq: number
			readonly blockType: 'text' | 'thinking'
			readonly content: string
		}>
	>
	readonly deleteUnmaterializedBlocks: () => Effect.Effect<void>
	readonly flush: () => Effect.Effect<void>
	readonly getDebugState: () => Effect.Effect<{
		readonly blockTypesByBlockSeq: Record<string, string>
		readonly conversationEventIdsByBlockSeq: Record<string, string>
		readonly consumedConversationEventIds: string[]
		readonly messageSeq: number
	}>
}

export class StreamProducer extends Context.Service<StreamProducer, StreamProducerService>()('StreamProducer') {}

export type StreamProducerError = never

const toStateEvent = (event: StreamEvent) =>
	Effect.succeed<ChangeEvent<StreamEvent>>({
		type: event.type,
		key: event.id,
		value: event,
		headers: {
			operation: 'insert',
			timestamp: new Date(event.timestamp).toISOString(),
		},
	})

const toStateDeleteEvent = (type: StreamEvent['type'], key: string) =>
	Effect.gen(function* () {
		const timestamp = yield* Clock.currentTimeMillis
		return {
			type,
			key,
			headers: {
				operation: 'delete',
				timestamp: DateTime.formatIso(DateTime.makeUnsafe(timestamp)),
			},
		} satisfies ChangeEvent<StreamEvent>
	})

type StreamContentBlockType = 'text' | 'thinking' | 'tool_use'

type EmittedBlockRows = {
	readonly blockType: 'text' | 'thinking'
	readonly blockSeq: number
	readonly messageSeq: number
	readonly startId: string
	readonly deltaIds: string[]
	readonly content: string
	readonly stopId?: string
}

type StreamProducerFailure = {
	readonly operation: string
	readonly cause: Cause.Cause<unknown>
}

const captureStreamProducerFailure = (input: { readonly failure: StreamProducerFailure; readonly sessionId: string }) =>
	Effect.logError('Conversation streaming stopped after the first failed write', input.failure.cause).pipe(
		Effect.annotateLogs({ sessionId: input.sessionId, operation: input.failure.operation }),
		Effect.andThen(
			Effect.sync(() =>
				Sentry.captureException(Cause.squash(input.failure.cause), {
					tags: {
						error_type: 'stream_producer_write_failed',
						operation: input.failure.operation,
						session_id: input.sessionId,
					},
					extra: { cause: Cause.pretty(input.failure.cause) },
				}),
			),
		),
	)

export const StreamProducerLive = Layer.effect(
	StreamProducer,
	Effect.gen(function* () {
		const writer = yield* DurableStreamWriter
		// Each run's messages must sort after every earlier run's; the clock outgrows any run's message count.
		const runStartedAt = yield* Clock.currentTimeMillis
		const messageSeq = yield* Ref.make(runStartedAt)
		const currentBlockSeq = yield* Ref.make<number | null>(null)
		const deltaSeq = yield* Ref.make(0)
		const nextLazyBlockSeq = yield* Ref.make(0)
		const messageStarted = yield* Ref.make(false)
		const sourceBlocks = yield* Ref.make(
			new Map<string, { readonly blockSeq: number; readonly type: 'text' | 'thinking' }>(),
		)
		const conversationEventIdsByBlockSeq = yield* Ref.make(new Map<number, string>())
		const blockTypesByBlockSeq = yield* Ref.make(new Map<number, StreamContentBlockType>())
		const consumedConversationEventIds = yield* Ref.make(new Set<string>())
		const emittedRowsByConversationEventId = yield* Ref.make(new Map<string, EmittedBlockRows>())
		const stopped = yield* Ref.make<StreamProducerFailure | null>(null)
		const skippedWrites = yield* Ref.make(0)

		const writeBestEffort = (operation: string, event: ChangeEvent<StreamEvent>) =>
			Ref.get(stopped).pipe(
				Effect.flatMap((failure) => {
					if (failure !== null) return Ref.update(skippedWrites, (count) => count + 1)
					return writer.append(event).pipe(
						Effect.catchCause((cause) => {
							const nextFailure = { operation, cause }
							return captureStreamProducerFailure({
								failure: nextFailure,
								sessionId: writer.sessionId,
							}).pipe(Effect.andThen(Ref.set(stopped, nextFailure)))
						}),
					)
				}),
			)

		const appendStreamEvent = (operation: string, event: StreamEvent) =>
			toStateEvent(event).pipe(Effect.flatMap((stateEvent) => writeBestEffort(operation, stateEvent)))

		const appendDelete = (type: StreamEvent['type'], key: string) =>
			toStateDeleteEvent(type, key).pipe(
				Effect.flatMap((stateEvent) => writeBestEffort('delete_unmaterialized_blocks', stateEvent)),
			)

		const createStreamEventBase = Effect.gen(function* () {
			return {
				id: uuidv7(),
				session_id: writer.sessionId,
				message_seq: yield* Ref.get(messageSeq),
				timestamp: yield* Clock.currentTimeMillis,
			}
		})

		const recordEmittedBlockStart = (
			conversationEventId: string,
			blockType: 'text' | 'thinking',
			blockSeq: number,
			startId: string,
		) =>
			Effect.gen(function* () {
				const currentMessageSeq = yield* Ref.get(messageSeq)
				yield* Ref.update(emittedRowsByConversationEventId, (map) =>
					new Map(map).set(conversationEventId, {
						blockType,
						blockSeq,
						messageSeq: currentMessageSeq,
						startId,
						deltaIds: [],
						content: '',
					}),
				)
			})

		const recordEmittedBlockDelta = (conversationEventId: string, deltaId: string, content: string) =>
			Ref.update(emittedRowsByConversationEventId, (map) => {
				const next = new Map(map)
				const rows = next.get(conversationEventId)
				if (rows)
					next.set(conversationEventId, {
						...rows,
						deltaIds: [...rows.deltaIds, deltaId],
						content: rows.content + content,
					})
				return next
			})

		const recordEmittedBlockStop = (conversationEventId: string, stopId: string) =>
			Ref.update(emittedRowsByConversationEventId, (map) => {
				const next = new Map(map)
				const rows = next.get(conversationEventId)
				if (rows) next.set(conversationEventId, { ...rows, stopId })
				return next
			})

		const writeMessageStart = () =>
			Effect.gen(function* () {
				const seq = yield* Ref.updateAndGet(messageSeq, (current) => current + 1)
				yield* Ref.set(conversationEventIdsByBlockSeq, new Map())
				yield* Ref.set(blockTypesByBlockSeq, new Map())
				yield* Ref.set(sourceBlocks, new Map())
				yield* Ref.set(nextLazyBlockSeq, 0)
				yield* Ref.set(currentBlockSeq, null)
				yield* Ref.set(deltaSeq, 0)
				yield* Ref.set(messageStarted, true)
				const timestamp = yield* Clock.currentTimeMillis
				yield* appendStreamEvent('write_message_start', {
					id: uuidv7(),
					type: 'message_start',
					session_id: writer.sessionId,
					message_seq: seq,
					timestamp,
				})
			})

		const startBlock = (blockSeq: number, blockType: 'text' | 'thinking') =>
			Effect.gen(function* () {
				const conversationEventId = uuidv7()
				yield* Ref.update(conversationEventIdsByBlockSeq, (map) =>
					new Map(map).set(blockSeq, conversationEventId),
				)
				yield* Ref.update(blockTypesByBlockSeq, (map) => new Map(map).set(blockSeq, blockType))
				yield* Ref.set(currentBlockSeq, blockSeq)
				yield* Ref.set(deltaSeq, 0)
				const eventBase = yield* createStreamEventBase
				yield* recordEmittedBlockStart(conversationEventId, blockType, blockSeq, eventBase.id)
				yield* appendStreamEvent(`start_${blockType}_block`, {
					...eventBase,
					type: blockType === 'text' ? 'text_block_start' : 'thinking_block_start',
					block_seq: blockSeq,
					conversation_event_id: conversationEventId,
				})
				return { conversationEventId }
			})

		const writeDelta = (blockType: 'text' | 'thinking', content: string) =>
			Effect.gen(function* () {
				const blockSeq = yield* Ref.get(currentBlockSeq)
				if (blockSeq === null) return
				const conversationEventId = (yield* Ref.get(conversationEventIdsByBlockSeq)).get(blockSeq)
				if (!conversationEventId) return
				const currentDeltaSeq = yield* Ref.getAndUpdate(deltaSeq, (seq) => seq + 1)
				const eventBase = yield* createStreamEventBase
				yield* recordEmittedBlockDelta(conversationEventId, eventBase.id, content)
				yield* appendStreamEvent(`write_${blockType}_delta`, {
					...eventBase,
					type: blockType === 'text' ? 'text_delta' : 'thinking_delta',
					block_seq: blockSeq,
					delta_seq: currentDeltaSeq,
					conversation_event_id: conversationEventId,
					content,
				})
			})

		const stopBlock = (blockSeq: number) =>
			Effect.gen(function* () {
				const blockType = (yield* Ref.get(blockTypesByBlockSeq)).get(blockSeq)
				if (blockType !== 'text' && blockType !== 'thinking') return
				const conversationEventId = (yield* Ref.get(conversationEventIdsByBlockSeq)).get(blockSeq)
				if (!conversationEventId) return
				const eventBase = yield* createStreamEventBase
				yield* recordEmittedBlockStop(conversationEventId, eventBase.id)
				yield* appendStreamEvent(`stop_${blockType}_block`, {
					...eventBase,
					type: blockType === 'text' ? 'text_block_stop' : 'thinking_block_stop',
					block_seq: blockSeq,
					conversation_event_id: conversationEventId,
				})
			})

		const materializeSourceBlock = (sourceBlockId: string, blockType: 'text' | 'thinking') =>
			Effect.gen(function* () {
				const existing = (yield* Ref.get(sourceBlocks)).get(sourceBlockId)
				if (existing) return existing
				if (!(yield* Ref.get(messageStarted))) yield* writeMessageStart()
				const blockSeq = yield* Ref.getAndUpdate(nextLazyBlockSeq, (value) => value + 1)
				yield* startBlock(blockSeq, blockType)
				const block = { blockSeq, type: blockType } as const
				yield* Ref.update(sourceBlocks, (blocks) => new Map(blocks).set(sourceBlockId, block))
				return block
			})

		const writeMessageStop = () =>
			createStreamEventBase.pipe(
				Effect.flatMap((eventBase) =>
					appendStreamEvent('write_message_stop', { ...eventBase, type: 'message_stop' }),
				),
				Effect.andThen(Ref.set(messageStarted, false)),
			)

		const deleteUnmaterializedBlocks = () =>
			Effect.gen(function* () {
				const emittedRows = yield* Ref.get(emittedRowsByConversationEventId)
				const consumed = yield* Ref.get(consumedConversationEventIds)
				for (const [conversationEventId, rows] of emittedRows.entries()) {
					if (consumed.has(conversationEventId)) continue
					const prefix = rows.blockType === 'text' ? 'text' : 'thinking'
					yield* appendDelete(`${prefix}_block_start`, rows.startId)
					for (const deltaId of rows.deltaIds) yield* appendDelete(`${prefix}_delta`, deltaId)
					if (rows.stopId) yield* appendDelete(`${prefix}_block_stop`, rows.stopId)
				}
			})

		const closeMessageAndDiscardUnmaterializedBlocks = () =>
			Effect.gen(function* () {
				if (yield* Ref.get(messageStarted)) yield* writeMessageStop()
				yield* deleteUnmaterializedBlocks()
			})

		yield* Effect.addFinalizer(() =>
			Effect.gen(function* () {
				const failure = yield* Ref.get(stopped)
				if (failure === null) return
				const skipped = yield* Ref.get(skippedWrites)
				yield* Effect.logWarning('Conversation streaming remained stopped for the rest of this run').pipe(
					Effect.annotateLogs({
						sessionId: writer.sessionId,
						firstFailedOperation: failure.operation,
						skippedWrites: skipped,
					}),
				)
			}),
		)

		return {
			writeConversationEvent: (event) =>
				createStreamEventBase.pipe(
					Effect.flatMap((eventBase) =>
						appendStreamEvent('write_conversation_event', {
							...eventBase,
							...event,
							id: event.conversation_event_id,
							type: 'conversation_event',
							message_seq: event.message_seq ?? eventBase.message_seq,
							timestamp: event.timestamp ?? eventBase.timestamp,
						}),
					),
				),
			writeMessageStart,
			writeMessageStop,
			startTextBlock: (blockSeq) => startBlock(blockSeq, 'text'),
			writeTextDelta: (content) => writeDelta('text', content),
			writeTextDeltaForSource: (input) =>
				materializeSourceBlock(input.sourceBlockId, 'text').pipe(
					Effect.andThen(() => writeDelta('text', input.content)),
				),
			writeTextBlockStop: () =>
				Ref.get(currentBlockSeq).pipe(
					Effect.flatMap((blockSeq) => (blockSeq === null ? Effect.void : stopBlock(blockSeq))),
				),
			startThinkingBlock: (blockSeq) => startBlock(blockSeq, 'thinking'),
			writeThinkingDelta: (content) => writeDelta('thinking', content),
			writeThinkingDeltaForSource: (input) =>
				materializeSourceBlock(input.sourceBlockId, 'thinking').pipe(
					Effect.andThen(() => writeDelta('thinking', input.content)),
				),
			writeThinkingBlockStop: () =>
				Ref.get(currentBlockSeq).pipe(
					Effect.flatMap((blockSeq) => (blockSeq === null ? Effect.void : stopBlock(blockSeq))),
				),
			writeContentBlockStop: stopBlock,
			writeContentBlockStopForSource: (input) =>
				Ref.get(sourceBlocks).pipe(
					Effect.flatMap((blocks) => {
						const block = blocks.get(input.sourceBlockId)
						return block ? stopBlock(block.blockSeq) : Effect.void
					}),
				),
			closeMessageAndDiscardUnmaterializedBlocks,
			getConversationEventIdForBlock: (blockSeq, blockType) =>
				Effect.gen(function* () {
					if (blockType) {
						const storedType = (yield* Ref.get(blockTypesByBlockSeq)).get(blockSeq)
						if (storedType !== blockType) return null
					}
					const consumed = yield* Ref.get(consumedConversationEventIds)
					const eventId = (yield* Ref.get(conversationEventIdsByBlockSeq)).get(blockSeq) ?? null
					if (eventId && consumed.has(eventId)) return null
					if (eventId) yield* Ref.update(consumedConversationEventIds, (ids) => new Set(ids).add(eventId))
					return eventId
				}),
			consumeNextConversationEventIdByType: (blockType) =>
				Effect.gen(function* () {
					const eventIds = yield* Ref.get(conversationEventIdsByBlockSeq)
					const blockTypes = yield* Ref.get(blockTypesByBlockSeq)
					const consumed = yield* Ref.get(consumedConversationEventIds)
					const eventId = [...eventIds.entries()]
						.filter(([blockSeq, id]) => blockTypes.get(blockSeq) === blockType && !consumed.has(id))
						.sort(([a], [b]) => a - b)[0]?.[1]
					if (eventId) yield* Ref.update(consumedConversationEventIds, (ids) => new Set(ids).add(eventId))
					return eventId ?? null
				}),
			getUnconsumedEmittedBlocks: () =>
				Effect.gen(function* () {
					const emittedRows = yield* Ref.get(emittedRowsByConversationEventId)
					const consumed = yield* Ref.get(consumedConversationEventIds)
					return [...emittedRows.entries()]
						.filter(([conversationEventId]) => !consumed.has(conversationEventId))
						.map(([conversationEventId, rows]) => ({
							conversationEventId,
							blockSeq: rows.blockSeq,
							messageSeq: rows.messageSeq,
							blockType: rows.blockType,
							content: rows.content,
						}))
						.sort((a, b) => a.messageSeq - b.messageSeq || a.blockSeq - b.blockSeq)
				}),
			deleteUnmaterializedBlocks,
			flush: () =>
				Ref.get(stopped).pipe(
					Effect.flatMap((failure) =>
						failure === null
							? writer.flush().pipe(
									Effect.catchCause((cause) => {
										const nextFailure = { operation: 'flush', cause }
										return captureStreamProducerFailure({
											failure: nextFailure,
											sessionId: writer.sessionId,
										}).pipe(Effect.andThen(Ref.set(stopped, nextFailure)))
									}),
								)
							: Effect.void,
					),
				),
			getDebugState: () =>
				Effect.gen(function* () {
					const types = yield* Ref.get(blockTypesByBlockSeq)
					const ids = yield* Ref.get(conversationEventIdsByBlockSeq)
					const consumed = yield* Ref.get(consumedConversationEventIds)
					const seq = yield* Ref.get(messageSeq)
					return {
						blockTypesByBlockSeq: Object.fromEntries(types),
						conversationEventIdsByBlockSeq: Object.fromEntries(ids),
						consumedConversationEventIds: [...consumed],
						messageSeq: seq,
					}
				}),
		}
	}),
)

export const StreamProducerLiveForSession = (input: { readonly sessionId: string }) =>
	Layer.fresh(StreamProducerLive.pipe(Layer.provide(DurableStreamWriterLive(input))))
