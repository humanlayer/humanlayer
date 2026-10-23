import { DurableStream, DurableStreamError, IdempotentProducer } from '@durable-streams/client'
import { conversationEvents } from '@humanlayer/db/tables/conversation-events'
import { sessions } from '@humanlayer/db/tables/sessions'
import { DURABLE_STREAM_CREATE_BACKOFF_OPTIONS } from '@humanlayer/streams/config'
import type { StreamEvent } from '@humanlayer/streams/events'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { Context, Data, Duration, Effect, Layer } from 'effect'

import { PostgresDb, type PostgresDbClient, PostgresDbLive } from '../postgres/postgres-db.service'
import { DurableStreamsConfig, DurableStreamsConfigLive } from './durable-streams-config.service'

/**
 * Shared shape for the authenticated caller on durable-stream session operations.
 */
export type StreamAuth = { organizationId: string; userId: string }

export type StreamHydrationStatus = 'created' | 'hydrated' | 'exists'

export type StreamHydrationResult = {
	sessionId: string
	status: StreamHydrationStatus
	eventCount?: number
}

/**
 * For bounding stream hydration concurrency so if a client asks for 50 hydrated streams,
 * we only do 4 at a time to prevent draining DB collection pool or overloading the DSS server
 */
const STREAM_HYDRATION_CONCURRENCY = 4

export class StreamCheckError extends Data.TaggedError('StreamCheckError')<{
	streamCause: unknown
	message: string
}> {}

export class StreamCreateError extends Data.TaggedError('StreamCreateError')<{
	streamCause: unknown
	message: string
}> {}

export class StreamCreateConflict extends Data.TaggedError('StreamCreateConflict')<{
	streamCause: unknown
	message: string
}> {}

export class StreamHydrationError extends Data.TaggedError('StreamHydrationError')<{
	streamCause: unknown
	message: string
}> {}

export class LoadSessionEventsForHydrationError extends Data.TaggedError('LoadSessionEventsForHydrationError')<{
	streamCause: unknown
	message: string
}> {}

export class ProducerFlushError extends Data.TaggedError('ProducerFlushError')<{
	streamCause: unknown
	message: string
}> {}

export class ProducerDetachError extends Data.TaggedError('ProducerDetachError')<{
	streamCause: unknown
	message: string
}> {}

export type StreamLifecycleError =
	| StreamCheckError
	| StreamCreateError
	| StreamCreateConflict
	| StreamHydrationError
	| LoadSessionEventsForHydrationError
	| ProducerFlushError
	| ProducerDetachError

/**
 * Procedure-facing error for the durable-stream session service.
 *
 * `DurableStreamSessionService` is a deep module: callers (the API/daemon Effect
 * procedures) only ever see this domain error, never the lower-level Postgres,
 * stream-check, stream-create, hydration, flush, or detach errors. The `operation`
 * field describes which durable-stream step failed, and `cause` preserves the
 * original internal error for logging/Sentry.
 */
export class DurableStreamSessionUnavailableError extends Data.TaggedError('DurableStreamSessionUnavailableError')<{
	operation: string
	cause: unknown
}> {}

/**
 * The single error type durable-stream session procedures must handle.
 */
export type DurableStreamSessionError = DurableStreamSessionUnavailableError

/**
 * `StreamEvent` is the wire protocol for our stream that the client UI, daemon, and API speak
 * this function converts a `StreamEvent` into the wire protocl that is used for StreamDB (https://durablestreams.com/stream-db) under the hood -
 * that is, Durable State's wire protocol (https://durablestreams.com/durable-state)  which wraps our wire protocol. Think of it like StreamEvent is the HTTP message, and the stateEvent is that event with TCP encapsulation
 * It's the transport.
 *
 * This allows us to use StreamDB, which means we can use a useLiveQuery to read against the contents of our stream client-side and join against other tanstack DB collections
 * for example, we can do live query joins against electric collections
 * @param event
 * @returns
 */
const toStateEvent = (event: StreamEvent) => ({
	type: event.type,
	key: event.id,
	value: event,
	headers: {
		operation: 'insert',
		timestamp: new Date(event.timestamp).toISOString(),
	},
})

/**
 * Create a stable producer ID for stream hydration. This ensures that when we hydrate streams, publication is done idempotently
 * This solves a concurrency problem where a client has multiple durableStreams.sessions.getOrHydrate requests outstanding
 * OR when different clients make the same request.
 *
 * Since hydration involves snapshotting the events in the db and then batching them onto the stream, multiple non-idempotent producers will race
 * which would wind up with duplicate events on the stream. Using a stable producer ID for hydration ensure that multiple same-client or different-client requests
 * for the same stream are idempotent without complicated distributed mutexes or pg advisory locks
 *
 * @param sessionId
 * @returns
 */
const hydrationProducerId = (sessionId: string) => `riptide-api:hydrate:${sessionId}`

/**
 * Checks if a durable stream exists for a given session i.e. /sessions/:sessionID
 * since sessions auto-expire - this determines how we hydrate it (create + write events) or just write events to it
 * @param sessionId
 * @returns
 */
export const streamExists = (sessionId: string) =>
	Effect.gen(function* () {
		const config = yield* DurableStreamsConfig
		const url = config.streamUrl(sessionId)
		yield* Effect.logInfo('Checking durable stream existence').pipe(
			Effect.annotateLogs({ sessionId, url, durableStreamsOrigin: config.origin }),
		)

		const response = yield* Effect.tryPromise({
			try: async () => {
				return await fetch(url, { method: 'HEAD' })
			},
			catch: (cause) =>
				new StreamCheckError({
					streamCause: cause,
					message: 'Failed to check durable stream lifecycle state',
				}),
		}).pipe(Effect.tapError((error) => Effect.logError('Durable stream HEAD request failed', error)))

		const nextOffset = response.headers.get('Stream-Next-Offset')
		yield* Effect.logInfo('Durable stream HEAD response').pipe(
			Effect.annotateLogs({ sessionId, url, status: response.status, ok: response.ok, nextOffset }),
		)

		if (response.status === 404) return false
		if (response.ok) return nextOffset === '0000000000000000_0000000000000000' ? 'empty' : 'exists'
		return yield* Effect.fail(
			new StreamCheckError({
				streamCause: new Error(`Unexpected stream HEAD status ${response.status}`),
				message: 'Failed to check durable stream lifecycle state',
			}),
		)
	})

/**
 * Effect that creates the durable stream for a given session.
 * @param sessionId
 * @returns
 */
export const createStream = (sessionId: string) =>
	Effect.gen(function* () {
		const config = yield* DurableStreamsConfig
		const url = config.streamUrl(sessionId)
		yield* Effect.logInfo('Creating durable stream').pipe(Effect.annotateLogs({ sessionId, url }))

		yield* Effect.tryPromise({
			try: async (signal) => {
				const stream = new DurableStream({
					url,
					contentType: config.contentType,
					backoffOptions: DURABLE_STREAM_CREATE_BACKOFF_OPTIONS,
					signal,
				})
				await stream.create({ ttlSeconds: config.ttlSeconds })
			},
			catch: (cause) => {
				if (cause instanceof DurableStreamError && cause.code === 'CONFLICT_EXISTS') {
					return new StreamCreateConflict({
						streamCause: cause,
						message: 'Durable stream already exists',
					})
				}

				return new StreamCreateError({
					streamCause: cause,
					message: 'Failed to create durable stream',
				})
			},
		}).pipe(Effect.tapError((error) => Effect.logError('Durable stream PUT request failed', error)))

		yield* Effect.logInfo('Durable stream created').pipe(Effect.annotateLogs({ sessionId, url }))
	})

/**
 * Effect that adds events to the stream with an idempotent producer (stable ID) - THIS is what
 * prevents the concurrency issue.
 */
const idempotentPublishEventsToStream = (sessionId: string, events: StreamEvent[]) =>
	Effect.gen(function* () {
		if (events.length === 0) return

		const config = yield* DurableStreamsConfig
		const producer = yield* Effect.try({
			try: () => {
				const handle = new DurableStream({
					url: config.streamUrl(sessionId),
					contentType: config.contentType,
				})

				// Idempotent prodcuers uses the stable producer ID for the session
				const producer = new IdempotentProducer(handle, hydrationProducerId(sessionId), {
					epoch: 0,
					autoClaim: false,
					lingerMs: 0,
					maxInFlight: 1,
				})
				for (const event of events) {
					producer.append(JSON.stringify(toStateEvent(event)))
				}

				return producer
			},
			catch: (cause) =>
				new StreamHydrationError({
					streamCause: cause,
					message: 'Failed to append durable stream hydration events',
				}),
		})

		// Create an effect that flushes the producer.
		// Bounded (5s) so the daemon's awaited ensureStreamHydrated call can never hang session
		// startup on a stuck hydration flush.
		const flush = Effect.tryPromise({
			try: () => producer.flush(),
			catch: (cause) =>
				new ProducerFlushError({
					streamCause: cause,
					message: 'Failed to flush durable stream hydration producer',
				}),
		}).pipe(
			Effect.timeout(Duration.seconds(5)),
			Effect.catchTag('TimeoutError', () =>
				Effect.fail(
					new ProducerFlushError({
						streamCause: new Error('timeout'),
						message: 'Durable stream hydration flush timed out after 5s',
					}),
				),
			),
		)

		// Create an effect that detaches from the stream once done (bounded 5s)
		const detach = Effect.tryPromise({
			try: () => producer.detach(),
			catch: (cause) =>
				new ProducerDetachError({
					streamCause: cause,
					message: 'Failed to detach durable stream hydration producer',
				}),
		}).pipe(
			Effect.timeout(Duration.seconds(5)),
			Effect.catchTag('TimeoutError', () =>
				Effect.fail(
					new ProducerDetachError({
						streamCause: new Error('timeout'),
						message: 'Durable stream hydration detach timed out after 5s',
					}),
				),
			),
		)

		// Flush it - catch an error and then detach if possible
		return yield* flush.pipe(
			Effect.catch((flushError) => detach.pipe(Effect.flatMap(() => Effect.fail(flushError)))),
			Effect.flatMap(() => detach),
		)
	})

/**
 * An event that loads events from the DB for hydration
 * @param sessionId
 * @param auth
 * @returns
 */
const loadHydrationEvents = (sessionId: string, auth: { organizationId: string; userId: string }) =>
	Effect.gen(function* () {
		// Load the wrapped postgres service so the hydration read gets typed query
		// errors, query logging, and a postgres.query span like other Effect DB reads.
		const postgres = yield* PostgresDb

		// Get rows from the database via the wrapped service, mapping shared Postgres
		// query failures back into the durable-stream-specific hydration error so
		// callers and tests keep their existing semantics.
		const rows = yield* postgres
			.query(
				postgres.client
					.select()
					.from(conversationEvents)
					.where(
						and(
							eq(conversationEvents.session_id, sessionId),
							eq(conversationEvents.organization_id, auth.organizationId),
						),
					)
					.orderBy(asc(conversationEvents.created_at), asc(conversationEvents.id)),
			)
			.pipe(
				Effect.mapError(
					(cause) =>
						new LoadSessionEventsForHydrationError({
							streamCause: cause,
							message: 'Failed to load session events for stream hydration',
						}),
				),
			)

		const events: StreamEvent[] = []
		for (const row of rows) {
			const timestamp = Number(row.created_at)

			// Some normalization is needed like created at / updated at -> number; this is converting it to our StreamEvent Wire protocol
			events.push({
				id: row.id,
				type: 'conversation_event',
				conversation_event_id: row.id,
				session_id: sessionId,
				message_seq: -1,
				timestamp,
				coding_agent_event_id: row.coding_agent_event_id,
				coding_agent_session_id: row.coding_agent_session_id,
				organization_id: row.organization_id,
				resource_owner_user_id: row.resource_owner_user_id,
				task_id: row.task_id,
				event_type: row.event_type,
				role: row.role,
				content: row.content,
				tool_call_id: row.tool_call_id,
				tool_name: row.tool_name,
				tool_input_json: row.tool_input_json,
				parent_tool_use_id: row.parent_tool_use_id,
				tool_result_for_id: row.tool_result_for_id,
				tool_result_content: row.tool_result_content,
				approval_status: row.approval_status,
				approval_id: row.approval_id,
				user_id: row.user_id,
				user_name: row.user_name,
				next_step_suggestion: row.next_step_suggestion,
				input_tokens: row.input_tokens,
				output_tokens: row.output_tokens,
				run_index: row.run_index,
				created_at: Number(row.created_at),
				updated_at: Number(row.updated_at),
			})
		}

		return events
	})

/**
 * Effect for hydrating a stream which loads events and then writes them to stream
 * @param sessionId
 * @param auth
 * @returns
 */
export const hydrateStream = (sessionId: string, auth: { organizationId: string; userId: string }) =>
	Effect.gen(function* () {
		const events = yield* loadHydrationEvents(sessionId, auth)
		return yield* idempotentPublishEventsToStream(sessionId, events).pipe(Effect.as(events.length))
	})

/**
 * Effect which hydrates the stream for a single session
 * @param sessionId
 * @param auth
 * @returns
 */
export const getOrHydrateOne = (sessionId: string, auth: { organizationId: string; userId: string }) =>
	Effect.gen(function* () {
		const exists = yield* streamExists(sessionId)
		if (exists === 'exists') return { sessionId, status: 'exists' as const }
		const wasMissing = !exists

		if (wasMissing) {
			yield* createStream(sessionId).pipe(
				Effect.catchTag('StreamCreateConflict', () =>
					Effect.logInfo('Durable stream already created by concurrent hydrator').pipe(
						Effect.annotateLogs({ sessionId }),
					),
				),
			)
			const rechecked = yield* streamExists(sessionId)
			if (rechecked === 'exists') return { sessionId, status: 'exists' as const }
		}

		const eventCount = yield* hydrateStream(sessionId, auth)
		if (eventCount === 0 && !wasMissing) return { sessionId, status: 'exists' as const }
		return { sessionId, status: eventCount > 0 ? ('hydrated' as const) : ('created' as const), eventCount }
	})

/**
 * Effect which hydrates streams with bounded concurrency
 * @param sessionIds
 * @param auth
 * @returns
 */
export const getOrHydrateAll = (sessionIds: string[], auth: { organizationId: string; userId: string }) =>
	Effect.all(
		sessionIds.map((sessionId) => getOrHydrateOne(sessionId, auth)),
		{ concurrency: STREAM_HYDRATION_CONCURRENCY },
	).pipe(Effect.map((streams) => ({ streams })))

export const tryEnsureSessionStreamHydrated = async (
	sessionId: string,
	db: PostgresDbClient,
	auth: { organizationId: string; userId: string },
	lifecycle: 'create' | 'continue' | 'fork' | 'launch',
) => {
	try {
		const result = await Effect.runPromise(
			getOrHydrateOne(sessionId, auth).pipe(
				Effect.provide(PostgresDbLive(db)),
				Effect.provide(DurableStreamsConfigLive),
			),
		)
		await Effect.runPromise(
			Effect.logInfo('Ensured durable stream for session lifecycle').pipe(
				Effect.annotateLogs({ sessionId, lifecycle, result }),
			),
		)
		return result
	} catch (error) {
		await Effect.runPromise(
			Effect.logError('Failed to ensure durable stream for session lifecycle', error).pipe(
				Effect.annotateLogs({
					sessionId,
					lifecycle,
					streamCause:
						error && typeof error === 'object' && 'streamCause' in error ? error.streamCause : undefined,
				}),
			),
		)
		return null
	}
}

/**
 * Loads the subset of requested session IDs that belong to the caller's organization.
 *
 * This is the authorization read for durable-stream hydration: a client may only
 * hydrate streams for sessions inside its own organization. The query runs through
 * the wrapped Postgres service so it gets typed query errors, query logging, and a
 * `postgres.query` span like other Effect DB reads. Shared Postgres failures are
 * mapped into the durable-stream domain error so callers never see persistence
 * details.
 */
const authorizeSessions = (input: { organizationId: string; sessionIds: string[] }) =>
	Effect.gen(function* () {
		const postgres = yield* PostgresDb

		const uniqueSessionIds = Array.from(new Set(input.sessionIds))
		if (uniqueSessionIds.length === 0) return new Set<string>()

		const rows = yield* postgres.query(
			postgres.client
				.select({ id: sessions.id })
				.from(sessions)
				.where(and(eq(sessions.organization_id, input.organizationId), inArray(sessions.id, uniqueSessionIds))),
		)

		return new Set(rows.map((row) => row.id))
	})

/**
 * Runtime boundary for durable-stream session authorization and hydration.
 *
 * `DurableStreamSessionService` is a deep module. It owns session authorization,
 * stream existence checks, stream creation, hydration event loading, publish, flush,
 * and detach internally, and translates every internal error
 * (`PostgresDbQueryError`, `StreamCheckError`, `StreamCreateError`,
 * `StreamCreateConflict`, `StreamHydrationError`, `LoadSessionEventsForHydrationError`,
 * `ProducerFlushError`, `ProducerDetachError`) into a single
 * `DurableStreamSessionError` before returning to procedures.
 */
export class DurableStreamSessionService extends Context.Service<
	DurableStreamSessionService,
	{
		authorizeSessions: (input: {
			organizationId: string
			sessionIds: string[]
		}) => Effect.Effect<Set<string>, DurableStreamSessionError, PostgresDb>
		getOrHydrateSessions: (input: {
			sessionIds: string[]
			auth: StreamAuth
		}) => Effect.Effect<
			{ streams: StreamHydrationResult[] },
			DurableStreamSessionError,
			PostgresDb | DurableStreamsConfig
		>
		getOrHydrateSession: (input: {
			sessionId: string
			auth: StreamAuth
		}) => Effect.Effect<StreamHydrationResult, DurableStreamSessionError, PostgresDb | DurableStreamsConfig>
	}
>()('DurableStreamSessionService') {}

/**
 * Live layer for `DurableStreamSessionService`. Requires `PostgresDb` and
 * `DurableStreamsConfig` to be present in the runtime.
 *
 * Every method maps the lower-level internal errors into the procedure-facing
 * `DurableStreamSessionUnavailableError` so the durable-stream module stays deep.
 */
export const DurableStreamSessionServiceLive = Layer.effect(
	DurableStreamSessionService,
	Effect.succeed({
		authorizeSessions: (input) =>
			authorizeSessions(input).pipe(
				Effect.withSpan('durable_streams.authorize_sessions', {
					attributes: {
						organization_id: input.organizationId,
						session_count: input.sessionIds.length,
					},
				}),
				Effect.mapError(
					(cause) =>
						new DurableStreamSessionUnavailableError({
							operation: 'authorize sessions',
							cause,
						}),
				),
			),

		getOrHydrateSessions: (input) =>
			getOrHydrateAll(input.sessionIds, input.auth).pipe(
				Effect.withSpan('durable_streams.get_or_hydrate_sessions', {
					attributes: {
						organization_id: input.auth.organizationId,
						user_id: input.auth.userId,
						session_count: input.sessionIds.length,
					},
				}),
				Effect.mapError(
					(cause) =>
						new DurableStreamSessionUnavailableError({
							operation: 'hydrate sessions',
							cause,
						}),
				),
			),

		getOrHydrateSession: (input) =>
			getOrHydrateOne(input.sessionId, input.auth).pipe(
				Effect.withSpan('durable_streams.get_or_hydrate_session', {
					attributes: {
						session_id: input.sessionId,
						organization_id: input.auth.organizationId,
						user_id: input.auth.userId,
					},
				}),
				Effect.mapError(
					(cause) =>
						new DurableStreamSessionUnavailableError({
							operation: 'hydrate session',
							cause,
						}),
				),
			),
	}),
)
