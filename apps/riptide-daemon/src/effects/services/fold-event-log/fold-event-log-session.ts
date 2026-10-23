import {
	EventLogCorruptEntryError,
	EventLogUnavailableError,
	Ids,
	decodeStoredLogEntry,
	storedLogEntry,
	type EventLogService,
	type LogEntry,
	type LogSeq,
} from '@humanlayer/fold-core'
import { Effect, PubSub, Ref, Schema, Semaphore, Stream } from 'effect'

import { DaemonFoldSessionEventAppendError, DaemonFoldSessionEventListError } from '../daemon-api/daemon-api.errors'
import { DaemonApi } from '../daemon-api/daemon-api.service'

export interface FoldEventLogSessionInput {
	readonly sessionId: string
}

const entriesFrom = (entries: ReadonlyArray<LogEntry>, fromSeq: LogSeq) =>
	entries.filter((entry) => entry.seq >= fromSeq)

const encodeJsonText = Schema.encodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))
const decodeJsonText = Schema.decodeEffect(Schema.fromJsonString(Schema.Json))

/**
 * API rows are passthrough objects and Fold decodes JSON. Round-trip through JSON text so an in-process
 * response reads like a wire one: `undefined` properties drop instead of failing the JSON check.
 */
export const decodePersistedFoldEntry = (row: unknown) =>
	encodeJsonText(row).pipe(
		Effect.flatMap(decodeJsonText),
		Effect.mapError(
			(cause) =>
				new EventLogCorruptEntryError({
					operation: 'entries',
					message: 'Persisted Fold event is not JSON',
					cause,
				}),
		),
		Effect.flatMap(decodeStoredLogEntry),
	)

const unavailable = (operation: 'append' | 'entries' | 'subscribe', message: string, cause: unknown) =>
	new EventLogUnavailableError({
		operation,
		message,
		retryable: true,
		cause,
	})

/**
 * Acquires one Postgres-backed Fold EventLogService for one Riptide session.
 * Its cache, serialization semaphore, and subscriber fan-out all belong to this scope.
 */
export const makeFoldEventLogSession = Effect.fn('fold.event_log_session.acquire')(function* (
	input: FoldEventLogSessionInput,
) {
	const daemonApi = yield* DaemonApi
	const ids = yield* Ids
	const persistedEntries = yield* daemonApi.listFoldSessionEvents({ sessionId: input.sessionId }).pipe(
		Effect.mapError((error: DaemonFoldSessionEventListError) =>
			unavailable('entries', 'Unable to load Fold event log entries', error.cause),
		),
		Effect.flatMap((entries) => Effect.forEach(entries, decodePersistedFoldEntry)),
	)

	const entriesRef = yield* Ref.make<ReadonlyArray<LogEntry>>(persistedEntries)
	const pubsub = yield* PubSub.unbounded<LogEntry>()
	const appendLock = yield* Semaphore.make(1)

	const append: EventLogService['append'] = Effect.fn('fold.event_log_session.append')((entry) =>
		appendLock.withPermit(
			Effect.gen(function* () {
				const currentEntries = yield* Ref.get(entriesRef)
				const nextSequence = (currentEntries.at(-1)?.seq ?? -1) + 1
				const storedEntry = yield* storedLogEntry(entry, nextSequence, yield* ids.makeEventId)
				const persistedPayload = yield* daemonApi
					.appendFoldSessionEvent({ sessionId: input.sessionId, entry: storedEntry })
					.pipe(
						Effect.mapError((error: DaemonFoldSessionEventAppendError) =>
							unavailable('append', 'Unable to append Fold event log entry', error.cause),
						),
					)
				const persistedEntry = yield* decodePersistedFoldEntry(persistedPayload)

				if (
					persistedEntry.seq !== storedEntry.seq ||
					persistedEntry.eventId !== storedEntry.eventId ||
					persistedEntry.ts !== storedEntry.ts ||
					persistedEntry.version !== storedEntry.version
				) {
					return yield* Effect.fail(
						new EventLogCorruptEntryError({
							operation: 'append',
							message: 'Persisted Fold event did not match the accepted append',
							seq: persistedEntry.seq,
						}),
					)
				}

				yield* Ref.set(entriesRef, [...currentEntries, persistedEntry])
				yield* PubSub.publish(pubsub, persistedEntry)
				return persistedEntry
			}),
		),
	)

	const entries: EventLogService['entries'] = (fromSeq = 0) =>
		Stream.fromIterableEffect(Ref.get(entriesRef).pipe(Effect.map((snapshot) => entriesFrom(snapshot, fromSeq))))

	const subscribe: EventLogService['subscribe'] = (fromSeq = 0) =>
		Stream.unwrap(
			appendLock.withPermit(
				Effect.gen(function* () {
					const subscription = yield* PubSub.subscribe(pubsub)
					const snapshot = yield* Ref.get(entriesRef)

					return Stream.fromIterable(entriesFrom(snapshot, fromSeq)).pipe(
						Stream.concat(
							Stream.fromSubscription(subscription).pipe(Stream.filter((entry) => entry.seq >= fromSeq)),
						),
					)
				}),
			),
		)

	return { append, entries, subscribe } satisfies EventLogService
})
