import { DurableStream } from '@durable-streams/client'
import { DurableStreamTestServer } from '@durable-streams/server'
import { describe, it } from '@effect/vitest'
import type { ConversationEventStream } from '@humanlayer/streams/events'
import { Effect, Layer } from 'effect'
import { uuidv7 } from 'uuidv7'
import { afterAll, beforeAll } from 'vitest'

import { DurableStreamsConfig } from '../../src/effects/services/durable-streams/durable-streams-config.service'
import { PostgresDbLive } from '../../src/effects/services/postgres/postgres-db.service'
import {
	createConversationEventsDb,
	createHydratedConversationEvent,
	installSyncAuthMock,
	type StreamStateEvent,
} from './durable-streams-concurrency-fixtures'

installSyncAuthMock()
const { getOrHydrateAll } = await import('../../src/effects/services/durable-streams/streams')

describe('durable stream hydration concurrency', () => {
	let server: DurableStreamTestServer

	beforeAll(async () => {
		server = new DurableStreamTestServer({ port: 0, host: '127.0.0.1' })
		await server.start()
	})

	afterAll(async () => {
		await server?.stop()
	})

	function testLayer(rows: Parameters<typeof createConversationEventsDb>[0]) {
		return Layer.merge(
			Layer.succeed(DurableStreamsConfig, {
				origin: server.url,
				contentType: 'application/json',
				ttlSeconds: 600,
				streamUrl: (sessionId: string) => `${server.url}/v1/stream/sessions/${sessionId}`,
			}),
			PostgresDbLive(createConversationEventsDb(rows) as never),
		)
	}

	async function readStreamEvents(sessionId: string) {
		const response = await fetch(`${server.url}/v1/stream/sessions/${sessionId}?offset=-1`)
		if (!response.ok) throw new Error(`Unable to read stream events: ${response.status}`)
		return (await response.json()) as StreamStateEvent[]
	}

	it.effect('does not duplicate conversation events when an empty stream is hydrated concurrently', ({ expect }) =>
		Effect.gen(function* () {
			const sessionId = uuidv7()
			const organizationId = uuidv7()
			const userId = 'durable-stream-concurrency-user'
			const eventId = uuidv7()
			const rows = [
				createHydratedConversationEvent({
					id: eventId,
					session_id: sessionId,
					organization_id: organizationId,
				}),
			]

			const streamUrl = `${server.url}/v1/stream/sessions/${sessionId}`
			yield* Effect.promise(() => DurableStream.create({ url: streamUrl, contentType: 'application/json' }))

			yield* Effect.all(
				Array.from({ length: 8 }, () =>
					getOrHydrateAll([sessionId], { organizationId, userId }).pipe(Effect.provide(testLayer(rows))),
				),
				{ concurrency: 'unbounded' },
			)

			const events = yield* Effect.promise(() => readStreamEvents(sessionId))
			const conversationEvents = events.filter(
				(event): event is StreamStateEvent & { value: ConversationEventStream } =>
					event.value.type === 'conversation_event',
			)
			const matchingEvents = conversationEvents.filter((event) => event.value.conversation_event_id === eventId)

			expect(matchingEvents).toHaveLength(1)
			expect(new Set(conversationEvents.map((event) => event.key)).size).toBe(conversationEvents.length)
		}),
	)
})
