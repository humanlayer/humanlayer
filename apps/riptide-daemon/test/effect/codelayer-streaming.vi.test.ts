import type { ChangeEvent } from '@durable-streams/state'
import { describe, it } from '@effect/vitest'
import type { StreamEvent } from '@humanlayer/streams/events'
import { Effect, Layer, Ref } from 'effect'
import { expect } from 'vitest'

import { handleCodelayerStreamEvent } from '../../src/agents/codelayer/stream-event-handler'
import {
	DurableStreamWriter,
	StreamProducer,
	StreamProducerLive,
} from '../../src/effects/services/stream-producer/stream-producer.service'

describe('CodeLayer stream events', () => {
	it.effect('delegates lazy text block materialization to the shared producer', () =>
		Effect.gen(function* () {
			const events = yield* Ref.make<Array<ChangeEvent<StreamEvent>>>([])
			const writer = Layer.succeed(DurableStreamWriter, {
				sessionId: 'session-1',
				append: (event) => Ref.update(events, (recorded) => [...recorded, event]),
				flush: () => Effect.void,
			})

			yield* Effect.gen(function* () {
				const producer = yield* StreamProducer
				yield* handleCodelayerStreamEvent({ type: 'textStart', id: 'text-1', stepIndex: 0 }, producer)
				yield* handleCodelayerStreamEvent(
					{ type: 'textDelta', id: 'text-1', text: 'hello', stepIndex: 0 },
					producer,
				)
				yield* handleCodelayerStreamEvent({ type: 'textEnd', id: 'text-1', stepIndex: 0 }, producer)
			}).pipe(Effect.provide(StreamProducerLive.pipe(Layer.provide(writer))))

			expect((yield* Ref.get(events)).map((event) => event.type)).toEqual([
				'message_start',
				'text_block_start',
				'text_delta',
				'text_block_stop',
			])
		}),
	)
})
