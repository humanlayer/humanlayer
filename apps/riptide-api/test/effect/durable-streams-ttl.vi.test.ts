import { DurableStreamTestServer } from '@durable-streams/server'
import { describe, it } from '@effect/vitest'
import type { ConversationEventStream } from '@humanlayer/streams/events'
import { Effect, Layer } from 'effect'
import { uuidv7 } from 'uuidv7'
import { afterAll, beforeAll, vi } from 'vitest'

import { DurableStreamsConfig } from '../../src/effects/services/durable-streams/durable-streams-config.service'
import {
	createStream,
	getOrHydrateAll,
	hydrateStream,
	streamExists,
} from '../../src/effects/services/durable-streams/streams'
import { PostgresDbLive } from '../../src/effects/services/postgres/postgres-db.service'
import {
	createConversationEventsDb,
	createHydratedConversationEvent,
	type StreamStateEvent,
} from './durable-streams-concurrency-fixtures'

describe('durable stream TTL effects', () => {
	let server: DurableStreamTestServer

	beforeAll(async () => {
		server = new DurableStreamTestServer({ port: 0, host: '127.0.0.1' })
		await server.start()
	})

	afterAll(async () => {
		await server?.stop()
	})

	function configLayer(ttlSeconds = 1) {
		return Layer.succeed(DurableStreamsConfig, {
			origin: server.url,
			contentType: 'application/json',
			ttlSeconds,
			streamUrl: (sessionId: string) => `${server.url}/v1/stream/sessions/${sessionId}`,
		})
	}

	function testLayer(rows: Parameters<typeof createConversationEventsDb>[0] = []) {
		return Layer.merge(configLayer(), PostgresDbLive(createConversationEventsDb(rows) as never))
	}

	const streamUrl = (sessionId: string) => `${server.url}/v1/stream/sessions/${sessionId}`
	let now = Date.now()
	let restoreDateNow: (() => void) | undefined

	function advanceTime(millis: number) {
		now += millis
	}

	beforeAll(() => {
		const dateNowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now)
		restoreDateNow = () => dateNowSpy.mockRestore()
	})

	afterAll(() => {
		restoreDateNow?.()
	})

	async function readStreamEvents(sessionId: string) {
		const response = await fetch(`${streamUrl(sessionId)}?offset=-1`)
		if (!response.ok) throw new Error(`Unable to read stream events: ${response.status}`)
		return (await response.json()) as StreamStateEvent[]
	}

	it.effect('expires an idle stream after its TTL without renewing on HEAD', ({ expect }) =>
		Effect.gen(function* () {
			const sessionId = uuidv7()

			yield* createStream(sessionId).pipe(Effect.provide(configLayer()))
			expect(yield* streamExists(sessionId).pipe(Effect.provide(configLayer()))).toBe('empty')

			advanceTime(1100)

			expect(yield* streamExists(sessionId).pipe(Effect.provide(configLayer()))).toBe(false)
		}),
	)

	it.effect('extends stream TTL on read', ({ expect }) =>
		Effect.gen(function* () {
			const sessionId = uuidv7()

			yield* createStream(sessionId).pipe(Effect.provide(configLayer()))
			advanceTime(700)

			const readResponse = yield* Effect.promise(() => fetch(`${streamUrl(sessionId)}?offset=-1`))
			expect(readResponse.ok).toBe(true)

			advanceTime(700)
			expect(yield* streamExists(sessionId).pipe(Effect.provide(configLayer()))).toBe('empty')

			advanceTime(1100)
			expect(yield* streamExists(sessionId).pipe(Effect.provide(configLayer()))).toBe(false)
		}),
	)

	it.effect('extends stream TTL on hydration write', ({ expect }) =>
		Effect.gen(function* () {
			const sessionId = uuidv7()
			const organizationId = uuidv7()
			const userId = 'durable-stream-ttl-user'
			const rows = [createHydratedConversationEvent({ session_id: sessionId, organization_id: organizationId })]

			yield* createStream(sessionId).pipe(Effect.provide(configLayer()))
			advanceTime(700)

			const eventCount = yield* hydrateStream(sessionId, { organizationId, userId }).pipe(
				Effect.provide(testLayer(rows)),
			)
			expect(eventCount).toBe(1)

			advanceTime(700)
			expect(yield* streamExists(sessionId).pipe(Effect.provide(configLayer()))).toBe('exists')

			advanceTime(1100)
			expect(yield* streamExists(sessionId).pipe(Effect.provide(configLayer()))).toBe(false)
		}),
	)

	it.effect('rehydrates the same events after TTL expiration recreates the stream', ({ expect }) =>
		Effect.gen(function* () {
			const sessionId = uuidv7()
			const organizationId = uuidv7()
			const userId = 'durable-stream-ttl-user'
			const eventIds = [uuidv7(), uuidv7()]
			const rows = eventIds.map((id) =>
				createHydratedConversationEvent({ id, session_id: sessionId, organization_id: organizationId }),
			)

			const firstHydration = yield* getOrHydrateAll([sessionId], { organizationId, userId }).pipe(
				Effect.provide(testLayer(rows)),
			)
			expect(firstHydration.streams).toEqual([{ sessionId, status: 'hydrated', eventCount: 2 }])

			const firstEvents = yield* Effect.promise(() => readStreamEvents(sessionId))
			expect(conversationEventIds(firstEvents)).toEqual(eventIds)

			advanceTime(1100)
			expect(yield* streamExists(sessionId).pipe(Effect.provide(configLayer()))).toBe(false)

			const secondHydration = yield* getOrHydrateAll([sessionId], { organizationId, userId }).pipe(
				Effect.provide(testLayer(rows)),
			)
			expect(secondHydration.streams).toEqual([{ sessionId, status: 'hydrated', eventCount: 2 }])

			const secondEvents = yield* Effect.promise(() => readStreamEvents(sessionId))
			expect(conversationEventIds(secondEvents)).toEqual(eventIds)
		}),
	)
})

function conversationEventIds(events: StreamStateEvent[]) {
	return events
		.filter(
			(event): event is StreamStateEvent & { value: ConversationEventStream } =>
				event.value.type === 'conversation_event',
		)
		.map((event) => event.value.conversation_event_id)
}
