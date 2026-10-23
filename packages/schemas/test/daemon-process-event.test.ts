import { describe, expect, it } from '@effect/vitest'
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'

import {
	DaemonProcessEvent,
	decodeDaemonProcessEventLine,
	encodeDaemonProcessEvent,
} from '../src/effect/daemon/process-event'
// @ts-expect-error Vitest's Vite transform loads the checked-in JSONL fixture as text.
import processEventFixture from './fixtures/daemon-process-events.jsonl?raw'

describe('DaemonProcessEvent', () => {
	it.effect('decodes and re-encodes every shared fixture event', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const lines = processEventFixture.trim().split('\n')
				expect(lines).toHaveLength(3)

				for (const line of lines) {
					const event = yield* decodeDaemonProcessEventLine({ line })
					expect(yield* Schema.decodeUnknownEffect(DaemonProcessEvent)(JSON.parse(line))).toEqual(event)
					expect(yield* decodeDaemonProcessEventLine({ line: encodeDaemonProcessEvent(event) })).toEqual(
						event,
					)
				}
			}),
		),
	)

	it.effect('rejects unknown event types and malformed JSON', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const unknownType = yield* Effect.exit(
					decodeDaemonProcessEventLine({
						line: JSON.stringify({
							type: 'daemon_stopped',
						}),
					}),
				)
				expect(unknownType._tag).toBe('Failure')

				const malformedJson = yield* Effect.exit(
					decodeDaemonProcessEventLine({
						line: '{not valid JSON}',
					}),
				)
				expect(malformedJson._tag).toBe('Failure')
			}),
		),
	)
})
