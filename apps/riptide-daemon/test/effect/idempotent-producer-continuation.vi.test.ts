import type { ChangeEvent } from '@durable-streams/state'
import { describe, it } from '@effect/vitest'
import type { StreamEvent } from '@humanlayer/streams/events'
import { Effect, Layer, Ref } from 'effect'
import { expect } from 'vitest'

import {
	DurableStreamWriter,
	StreamProducer,
	StreamProducerLive,
} from '../../src/effects/services/stream-producer/stream-producer.service'

describe('StreamProducer continuation', () => {
	it.effect('recreates producers without sharing their session bookkeeping', () =>
		Effect.gen(function* () {
			const events = yield* Ref.make<Array<ChangeEvent<StreamEvent>>>([])
			const writer = Layer.succeed(DurableStreamWriter, {
				sessionId: 'session-1',
				append: (event) => Ref.update(events, (recorded) => [...recorded, event]),
				flush: () => Effect.void,
			})
			const producerLayer = StreamProducerLive.pipe(Layer.provide(writer))

			const publish = (content: string) =>
				Effect.gen(function* () {
					const producer = yield* StreamProducer
					yield* producer.writeMessageStart()
					yield* producer.startTextBlock(0)
					yield* producer.writeTextDelta(content)
				}).pipe(Effect.provide(producerLayer))

			yield* publish('first')
			yield* publish('second')

			expect((yield* Ref.get(events)).filter((event) => event.type === 'message_start')).toHaveLength(2)
		}),
	)
})
