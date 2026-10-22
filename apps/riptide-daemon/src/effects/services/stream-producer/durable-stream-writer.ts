import { DurableStream, IdempotentProducer } from '@durable-streams/client'
import type { ChangeEvent } from '@durable-streams/state'
import { STREAM_CONFIG } from '@humanlayer/streams/config'
import type { StreamEvent } from '@humanlayer/streams/events'
import { Cause, Clock, Config, Context, Data, Duration, Effect, Layer, Match } from 'effect'
import { uuidv7 } from 'uuidv7'

import { Sentry } from '@/instrument'
import logger from '@/logger'

import { DaemonApi } from '../daemon-api/daemon-api.service'
import { DurableStreamFetch } from './durable-stream-fetch'
import {
	isNotFoundCause,
	notFoundHealDelayMs,
	NOT_FOUND_LOG_THROTTLE_MS,
	NOT_FOUND_SUPERVISOR_TICK_MS,
	planNotFoundHeal,
} from './stream-producer-recovery'

export interface DurableStreamWriterService {
	readonly sessionId: string
	readonly append: (event: ChangeEvent<StreamEvent>) => Effect.Effect<void, DurableStreamWriterError>
	readonly flush: () => Effect.Effect<void, DurableStreamWriterError>
}

export class DurableStreamWriter extends Context.Service<DurableStreamWriter, DurableStreamWriterService>()(
	'DurableStreamWriter',
) {}

export class DurableStreamAppendError extends Data.TaggedError('DurableStreamAppendError')<{
	message: string
	cause?: unknown
}> {}

export class DurableStreamFlushError extends Data.TaggedError('DurableStreamFlushError')<{
	message: string
	cause?: unknown
	diagnostics?: FlushTimeoutDiagnostics
}> {}

export interface FlushTimeoutDiagnostics {
	classification: 'slow_drain' | 'stalled'
	elapsedMs: number
	inFlightCount: number
	pendingCount: number
	nextSeq: number
	epoch: number
	startOffset: string | undefined
	endOffset: string | undefined
}

export class DurableStreamDetachError extends Data.TaggedError('DurableStreamDetachError')<{
	message: string
	cause?: unknown
}> {}

export type DurableStreamWriterError = DurableStreamAppendError | DurableStreamFlushError | DurableStreamDetachError

export interface DurableStreamWriterInput {
	readonly sessionId: string
}

export const createSessionStreamUrl = (input: { origin: string; sessionId: string }) =>
	`${input.origin.replace(/\/$/, '')}/streams/sessions/${input.sessionId}`

const captureEnsureConversationStreamFailure = (input: {
	readonly cause: Cause.Cause<unknown>
	readonly sessionId: string
}) =>
	Effect.logError('Failed to ensure conversation stream', input.cause).pipe(
		Effect.annotateLogs({ sessionId: input.sessionId }),
		Effect.andThen(
			Effect.sync(() =>
				Sentry.captureException(Cause.squash(input.cause), {
					tags: { error_type: 'ensure_conversation_stream', session_id: input.sessionId },
					extra: { cause: Cause.pretty(input.cause) },
				}),
			),
		),
	)

export const DurableStreamWriterLive = (input: DurableStreamWriterInput) =>
	Layer.effect(
		DurableStreamWriter,
		Effect.gen(function* () {
			const daemonApi = yield* DaemonApi
			const durableStreamFetch = yield* DurableStreamFetch
			const origin = yield* Config.String('RIPTIDE_SYNC_ORIGIN')
			const streamUrl = createSessionStreamUrl({ origin, sessionId: input.sessionId })
			const ensureConversationStream = daemonApi.ensureConversationStream({ sessionId: input.sessionId }).pipe(
				Effect.interruptible,
				Effect.timeout(Duration.seconds(3)),
				Effect.as(true),
				Effect.catchCause((cause) =>
					Cause.hasInterrupts(cause)
						? Effect.interrupt
						: captureEnsureConversationStreamFailure({ cause, sessionId: input.sessionId }).pipe(
								Effect.as(false),
							),
				),
			)

			if (!(yield* ensureConversationStream)) {
				// Streaming is optional; callers still allocate IDs and persist conversation events.
				return {
					sessionId: input.sessionId,
					append: () => Effect.void,
					flush: () => Effect.void,
				}
			}

			const stream = new DurableStream({
				url: streamUrl,
				contentType: STREAM_CONFIG.contentType,
				fetch: durableStreamFetch.fetch,
			})
			let notFoundStreak = 0
			let lastNotFoundLogAt = 0
			let healAttempts = 0
			let nextHealAt = 0
			let healInFlight = false
			let halted = false
			let lastObservedOffset: unknown
			const producerId = `riptide-daemon:${input.sessionId}:${uuidv7()}`
			// SDK adapter: cancellation belongs to the producer lifetime, not one Effect
			// promise wait. Abort explicitly between the graceful drain and SDK detach.
			// oxlint-disable-next-line effecttsgo/abort-controller-in-effect
			const producerAbort = new AbortController()
			const producer = new IdempotentProducer(stream, producerId, {
				epoch: 0,
				maxInFlight: 1,
				lingerMs: 50,
				signal: producerAbort.signal,
				fetch: Object.assign(
					async (...args: Parameters<typeof fetch>) => {
						// The SDK can dequeue another batch after an aborted request settles.
						producerAbort.signal.throwIfAborted()
						return durableStreamFetch.fetch(...args)
					},
					{ preconnect: durableStreamFetch.fetch.preconnect },
				),
				onError: (error) => {
					if (producerAbort.signal.aborted) return
					if (isNotFoundCause(error)) {
						notFoundStreak += 1
						const now = Date.now()
						if (now - lastNotFoundLogAt >= NOT_FOUND_LOG_THROTTLE_MS) {
							lastNotFoundLogAt = now
							logger.warn(
								{ sessionId: input.sessionId, consecutive: notFoundStreak },
								'Durable stream returned 404; attempting stream recovery',
							)
						}
						return
					}
					logger.error({ sessionId: input.sessionId, error }, 'Durable stream producer batch failed')
					Sentry.captureException(error, {
						tags: { error_type: 'durable_stream_producer_batch', session_id: input.sessionId },
						extra: { producerId, streamUrl },
					})
				},
			})

			lastObservedOffset = producer.lastSuccessfulOffset
			const applyNotFoundRecoveryAction = Effect.fn('durableStreamWriter.applyNotFoundRecoveryAction')(
				(action: ReturnType<typeof planNotFoundHeal>, offset: unknown, now: number) =>
					Match.value(action).pipe(
						Match.when('reset', () =>
							Effect.sync(() => {
								lastObservedOffset = offset
								notFoundStreak = 0
								healAttempts = 0
								nextHealAt = 0
							}),
						),
						Match.when('wait', () => Effect.void),
						Match.when('halt', () => {
							halted = true
							const error = new Error('durable stream producer halted after repeated 404s')
							return Effect.logError(
								'Durable stream producer halted after repeated 404s; dropping later events for this run',
							).pipe(
								Effect.annotateLogs({ sessionId: input.sessionId, healAttempts, streamUrl }),
								Effect.andThen(
									Effect.sync(() =>
										Sentry.captureException(error, {
											tags: {
												error_type: 'durable_stream_producer_halted',
												session_id: input.sessionId,
											},
											extra: { producerId, streamUrl, healAttempts },
										}),
									),
								),
							)
						}),
						Match.when('heal', () => {
							healAttempts += 1
							nextHealAt = now + notFoundHealDelayMs(healAttempts)
							healInFlight = true
							return ensureConversationStream.pipe(
								Effect.tap((ensured) =>
									Effect.sync(() => {
										if (!ensured) {
											halted = true
											producerAbort.abort()
										}
									}),
								),
								Effect.asVoid,
								Effect.ensuring(Effect.sync(() => (healInFlight = false))),
							)
						}),
						Match.exhaustive,
					),
			)
			const superviseNotFoundRecovery = Effect.gen(function* () {
				while (!halted) {
					yield* Effect.sleep(Duration.millis(NOT_FOUND_SUPERVISOR_TICK_MS))
					const offset = producer.lastSuccessfulOffset
					const now = yield* Clock.currentTimeMillis
					const action = planNotFoundHeal({
						notFoundStreak,
						healAttempts,
						healInFlight,
						offsetAdvanced: offset !== lastObservedOffset,
						now,
						nextHealAt,
					})

					yield* applyNotFoundRecoveryAction(action, offset, now)
				}
			})
			const flushProducer = Effect.gen(function* () {
				const startedAt = yield* Clock.currentTimeMillis
				const startOffset = producer.lastSuccessfulOffset
				return yield* Effect.tryPromise({
					try: () => producer.flush(),
					catch: (cause) =>
						new DurableStreamFlushError({ message: 'Failed to flush stream producer', cause }),
				}).pipe(
					Effect.interruptible,
					Effect.timeout(Duration.seconds(2)),
					Effect.catchTag('TimeoutError', () =>
						Effect.gen(function* () {
							const endOffset = producer.lastSuccessfulOffset
							const diagnostics: FlushTimeoutDiagnostics = {
								classification: endOffset !== startOffset ? 'slow_drain' : 'stalled',
								elapsedMs: (yield* Clock.currentTimeMillis) - startedAt,
								inFlightCount: producer.inFlightCount,
								pendingCount: producer.pendingCount,
								nextSeq: producer.nextSeq,
								epoch: producer.epoch,
								startOffset,
								endOffset,
							}
							return yield* Effect.fail(
								new DurableStreamFlushError({
									message: `Durable stream producer flush timed out after 2s (${diagnostics.classification})`,
									cause: new Error('timeout'),
									diagnostics,
								}),
							)
						}),
					),
				)
			})
			const detachProducer = Effect.tryPromise({
				try: () => producer.detach(),
				catch: (cause) => new DurableStreamDetachError({ message: 'Failed to detach stream producer', cause }),
			}).pipe(
				Effect.interruptible,
				Effect.timeout(Duration.seconds(1)),
				Effect.catchTag('TimeoutError', (cause) =>
					Effect.fail(new DurableStreamDetachError({ message: 'Stream producer detach timed out', cause })),
				),
			)
			const captureFinalizerFailure = (operation: 'flush' | 'detach', error: DurableStreamWriterError) =>
				Effect.logError(`Durable stream producer finalizer ${operation} failed`, error).pipe(
					Effect.annotateLogs({ sessionId: input.sessionId, operation, streamUrl }),
					Effect.andThen(
						Effect.sync(() =>
							Sentry.captureException(error, {
								tags: {
									error_type: 'durable_stream_producer_finalizer',
									operation,
									session_id: input.sessionId,
								},
								extra: { producerId, streamUrl },
							}),
						),
					),
				)

			yield* Effect.addFinalizer(() =>
				Effect.gen(function* () {
					if (!halted) {
						yield* flushProducer.pipe(Effect.catch((error) => captureFinalizerFailure('flush', error)))
					}
				}).pipe(
					Effect.ensuring(
						Effect.gen(function* () {
							halted = true
							producerAbort.abort()
							// detach closes the SDK producer and flushes again. Never race its flush
							// against ours; bound it even if the transport ignores cancellation.
							yield* detachProducer.pipe(
								Effect.catch((error) => captureFinalizerFailure('detach', error)),
							)
						}),
					),
				),
			)

			// Register last so scope shutdown stops recovery before draining the producer.
			yield* superviseNotFoundRecovery.pipe(Effect.forkScoped)

			return {
				sessionId: input.sessionId,
				append: (event) => {
					const eventSessionId = event.value?.session_id
					if (event.value && eventSessionId !== input.sessionId) {
						return Effect.logWarning(
							'Dropping durable stream event because its session does not match the destination stream',
						).pipe(
							Effect.annotateLogs({
								streamSessionId: input.sessionId,
								eventSessionId,
								eventType: event.type,
								eventKey: event.key,
								producerId,
							}),
						)
					}

					return halted
						? Effect.void
						: Effect.try({
								try: () => producer.append(JSON.stringify(event)),
								catch: (cause) =>
									new DurableStreamAppendError({ message: 'Failed to enqueue stream event', cause }),
							})
				},
				flush: () => (halted ? Effect.void : flushProducer),
			}
		}),
	)
