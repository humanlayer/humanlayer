import { randomUUID } from 'node:crypto'

import { DurableStreamTestServer } from '@durable-streams/server'
import { describe, it } from '@effect/vitest'
import { conversationEvents } from '@humanlayer/db/tables/conversation-events'
import { organizations } from '@humanlayer/db/tables/organizations'
import { sessions } from '@humanlayer/db/tables/sessions'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { Clock, DateTime, Effect, Layer } from 'effect'
import { uuidv7 } from 'uuidv7'
import { afterAll, beforeAll } from 'vitest'

import { DurableStreamsConfig } from '../../src/effects/services/durable-streams/durable-streams-config.service'
import { getOrHydrateAll } from '../../src/effects/services/durable-streams/streams'
import { PostgresDbLive } from '../../src/effects/services/postgres/postgres-db.service'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('durable stream Effects', () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let server: DurableStreamTestServer

	let organizationId: string
	const userId = 'durable-stream-session-user'
	const workosOrganizationId = 'org_durable_stream_sessions'

	function testConfigLayer() {
		return Layer.succeed(DurableStreamsConfig, {
			origin: server.url,
			contentType: 'application/json',
			ttlSeconds: 600,
			streamUrl: (sessionId: string) => `${server.url}/v1/stream/sessions/${sessionId}`,
		})
	}

	function testLayer() {
		return Layer.merge(testConfigLayer(), PostgresDbLive(db))
	}

	async function createSession(overrides?: { userId?: string; organizationId?: string }) {
		const sessionId = uuidv7()
		await db.insert(sessions).values({
			id: sessionId,
			organization_id: overrides?.organizationId ?? organizationId,
			resource_owner_user_id: overrides?.userId ?? userId,
			created_by: overrides?.userId ?? userId,
			host_id: randomUUID(),
			working_directory: '/tmp/durable-stream-session-test',
			coding_agent: 'claude',
			status: 'ready_for_input',
			provider: 'anthropic',
			model: 'claude-sonnet-4-5',
			permissions_mode: 'default',
		})
		return sessionId
	}

	async function readStreamEvents(sessionId: string) {
		const response = await fetch(`${server.url}/v1/stream/sessions/${sessionId}?offset=-1`)
		if (!response.ok) throw new Error(`Unable to read stream events: ${response.status}`)
		return await response.json()
	}

	beforeAll(async () => {
		const testDb = await createTestDb('durable_stream_sessions')
		cleanupTestDb = testDb.cleanup
		db = testDb.db

		const [org] = await db
			.insert(organizations)
			.values({ name: 'durable stream sessions test org', workos_organization_id: workosOrganizationId })
			.returning()
		if (!org) throw new Error('Unable to insert organization for setup')
		organizationId = org.id

		server = new DurableStreamTestServer({ port: 0, host: '127.0.0.1' })
		await server.start()
	}, 30000)

	afterAll(async () => {
		await server?.stop()
		await cleanupTestDb?.()
	}, 30000)

	it.effect('creates an empty session stream and reports exists on the next call', ({ expect }) =>
		Effect.gen(function* () {
			const sessionId = yield* Effect.promise(() => createSession())

			const created = yield* getOrHydrateAll([sessionId], { organizationId, userId }).pipe(
				Effect.provide(testLayer()),
			)

			expect(created.streams).toEqual([{ sessionId, status: 'created', eventCount: 0 }])

			const exists = yield* getOrHydrateAll([sessionId], { organizationId, userId }).pipe(
				Effect.provide(testLayer()),
			)

			expect(exists.streams).toEqual([{ sessionId, status: 'exists' }])
		}),
	)

	it.effect('hydrates assistant message events into the session stream', ({ expect }) =>
		Effect.gen(function* () {
			const sessionId = yield* Effect.promise(() => createSession())
			const eventId = uuidv7()
			const timestamp = BigInt(yield* Clock.currentTimeMillis)

			yield* Effect.promise(() =>
				db.insert(conversationEvents).values({
					id: eventId,
					session_id: sessionId,
					organization_id: organizationId,
					resource_owner_user_id: userId,
					event_type: 'message',
					role: 'assistant',
					content: 'streamed from history',
					created_at: timestamp,
					updated_at: timestamp,
				}),
			)

			const result = yield* getOrHydrateAll([sessionId], { organizationId, userId }).pipe(
				Effect.provide(testLayer()),
			)

			expect(result.streams).toEqual([{ sessionId, status: 'hydrated', eventCount: 1 }])

			const events = yield* Effect.promise(() => readStreamEvents(sessionId))
			expect(events).toEqual([
				{
					type: 'conversation_event',
					key: eventId,
					value: expect.objectContaining({
						id: eventId,
						type: 'conversation_event',
						conversation_event_id: eventId,
						session_id: sessionId,
						message_seq: -1,
						timestamp: Number(timestamp),
						event_type: 'message',
						role: 'assistant',
						content: 'streamed from history',
					}),
					headers: expect.objectContaining({
						operation: 'insert',
						timestamp: DateTime.formatIso(DateTime.makeUnsafe(Number(timestamp))),
					}),
				},
			])
		}),
	)
})
