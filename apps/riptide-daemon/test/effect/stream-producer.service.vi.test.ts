import type { ChangeEvent } from '@durable-streams/state'
import { describe, it } from '@effect/vitest'
import type { StreamEvent } from '@humanlayer/streams/events'
import { Effect, Layer, Ref } from 'effect'
import { TestClock } from 'effect/testing'
import { expect } from 'vitest'

import {
	DurableStreamAppendError,
	DurableStreamWriter,
	StreamProducer,
	StreamProducerLive,
} from '../../src/effects/services/stream-producer/stream-producer.service'

describe('StreamProducer', () => {
	it.effect('opens a block only when CodeLayer emits a non-empty chunk', () =>
		Effect.gen(function* () {
			const events = yield* Ref.make<Array<ChangeEvent<StreamEvent>>>([])
			const writer = Layer.succeed(DurableStreamWriter, {
				sessionId: 'session-1',
				append: (event) => Ref.update(events, (recorded) => [...recorded, event]),
				flush: () => Effect.void,
			})

			yield* Effect.gen(function* () {
				const producer = yield* StreamProducer
				if (
					producer.writeTextDeltaForSource === undefined ||
					producer.writeContentBlockStopForSource === undefined ||
					producer.closeMessageAndDiscardUnmaterializedBlocks === undefined
				) {
					return yield* Effect.die('Stream producer does not implement lazy source blocks')
				}
				yield* producer.writeTextDeltaForSource({ sourceBlockId: 'text-1', content: 'hello' })
				yield* producer.writeContentBlockStopForSource({ sourceBlockId: 'text-1' })
				yield* producer.closeMessageAndDiscardUnmaterializedBlocks()
			}).pipe(Effect.provide(StreamProducerLive.pipe(Layer.provide(writer))))

			expect(
				(yield* Ref.get(events))
					.filter((event) => event.headers.operation === 'insert')
					.map((event) => event.type),
			).toEqual(['message_start', 'text_block_start', 'text_delta', 'text_block_stop', 'message_stop'])
		}),
	)

	it.effect('numbers each run after every earlier run without reading the stream', () =>
		Effect.gen(function* () {
			const events = yield* Ref.make<Array<ChangeEvent<StreamEvent>>>([])
			const writer = Layer.succeed(DurableStreamWriter, {
				sessionId: 'session-3',
				append: (event) => Ref.update(events, (recorded) => [...recorded, event]),
				flush: () => Effect.void,
			})
			const runTwoMessages = Effect.gen(function* () {
				const producer = yield* StreamProducer
				yield* producer.writeMessageStart()
				yield* producer.writeMessageStop()
				yield* producer.writeMessageStart()
				yield* producer.writeMessageStop()
			}).pipe(Effect.provide(StreamProducerLive.pipe(Layer.provide(writer))))

			yield* TestClock.adjust('1 second')
			yield* runTwoMessages
			yield* TestClock.adjust('1 second')
			yield* runTwoMessages

			const messageSeqs = (yield* Ref.get(events))
				.filter((event) => event.type === 'message_start')
				.map((event) => event.value?.message_seq)
			expect(messageSeqs).toEqual([1_001, 1_002, 2_001, 2_002])
		}),
	)

	it.effect('stops writes after the first producer failure while continuing block bookkeeping', () =>
		Effect.gen(function* () {
			const attempts = yield* Ref.make(0)
			const writer = Layer.succeed(DurableStreamWriter, {
				sessionId: 'session-2',
				append: () =>
					Ref.updateAndGet(attempts, (count) => count + 1).pipe(
						Effect.flatMap(() =>
							Effect.fail(new DurableStreamAppendError({ message: 'intentional write failure' })),
						),
					),
				flush: () => Effect.void,
			})

			const ids = yield* Effect.gen(function* () {
				const producer = yield* StreamProducer
				yield* producer.writeMessageStart()
				const first = yield* producer.startTextBlock(0)
				yield* producer.writeTextDelta('first')
				const second = yield* producer.startThinkingBlock(1)
				yield* producer.writeThinkingDelta('second')
				return { first, second }
			}).pipe(Effect.provide(StreamProducerLive.pipe(Layer.provide(writer))))

			expect(yield* Ref.get(attempts)).toBe(1)
			expect(ids.first.conversationEventId).not.toBe(ids.second.conversationEventId)
		}),
	)
})
