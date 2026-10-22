import type { ChangeEvent } from '@durable-streams/state'
import { describe, it } from '@effect/vitest'
import type { StreamEvent } from '@humanlayer/streams/events'
import { Cause, ConfigProvider, Deferred, Effect, Exit, Fiber, Layer, Queue } from 'effect'
import { TestClock } from 'effect/testing'
import { expect } from 'vitest'

import { DaemonConversationStreamHydrationError } from '../../src/effects/services/daemon-api/daemon-api.errors'
import { DurableStreamFetch } from '../../src/effects/services/stream-producer/durable-stream-fetch'
import {
	DurableStreamWriter,
	DurableStreamWriterLive,
	type DurableStreamWriterService,
} from '../../src/effects/services/stream-producer/durable-stream-writer'
import { StreamProducer, StreamProducerLive } from '../../src/effects/services/stream-producer/stream-producer.service'
import { makeMockDaemonApiLayer } from '../mocks/daemon-api.mock'

const sessionId = 'session-1'
const event: ChangeEvent<StreamEvent> = {
	type: 'message_start',
	key: 'message-1',
	headers: { operation: 'insert' },
	value: { type: 'message_start', id: 'message-1', session_id: sessionId, message_seq: 0, timestamp: 0 },
}
const ensured = Effect.succeed({ sessionId, status: 'exists' as const })
const writerLayer = (
	ensureConversationStream: Effect.Effect<
		{ sessionId: string; status: 'exists' },
		DaemonConversationStreamHydrationError
	>,
	transport: typeof fetch,
) =>
	DurableStreamWriterLive({ sessionId }).pipe(
		Layer.provide(makeMockDaemonApiLayer({ ensureConversationStream: () => ensureConversationStream })),
		Layer.provide(Layer.succeed(DurableStreamFetch, { fetch: transport })),
		Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ RIPTIDE_SYNC_ORIGIN: 'https://stream.test' }))),
	)

const makeTransport = (handler: (init: RequestInit) => Promise<Response>) =>
	Object.assign(async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => handler(init ?? {}), {
		preconnect: () => {},
	}) satisfies typeof fetch

describe('DurableStreamWriter lifecycle (real SDK)', () => {
	it.effect('streams without reading the existing stream', () =>
		Effect.gen(function* () {
			const requests: RequestInit[] = []
			yield* Effect.gen(function* () {
				const writer = yield* DurableStreamWriter
				yield* writer.append(event)
				yield* writer.flush()
			}).pipe(
				Effect.provide(
					writerLayer(
						ensured,
						makeTransport(async (init) => {
							requests.push(init)
							return new Response(null, { status: 200 })
						}),
					),
				),
			)
			expect(requests.map((request) => request.method)).toEqual(['POST'])
		}),
	)

	for (const [name, failure] of [
		['typed failure', Effect.fail(new DaemonConversationStreamHydrationError({ cause: new Error('unavailable') }))],
		['defect', Effect.die(new Error('setup defect'))],
	] as const) {
		it.effect(`disables all streaming after setup ${name}`, () =>
			Effect.gen(function* () {
				let requests = 0
				const transport = makeTransport(async () => {
					requests++
					throw new Error('Unexpected streaming request')
				})
				yield* Effect.gen(function* () {
					const writer = yield* DurableStreamWriter
					yield* writer.append(event)
					yield* writer.flush()
					const ids = yield* Effect.gen(function* () {
						const producer = yield* StreamProducer
						yield* producer.writeMessageStart()
						const first = yield* producer.startTextBlock(0)
						yield* producer.writeTextDelta('hello')
						const second = yield* producer.startThinkingBlock(1)
						return [first.conversationEventId, second.conversationEventId]
					}).pipe(Effect.provide(StreamProducerLive))
					expect(ids[0]).not.toBe(ids[1])
				}).pipe(Effect.provide(writerLayer(failure, transport)))
				expect(requests).toBe(0)
			}),
		)
	}

	it.effect('bounds hung setup at 3 seconds and cancels it without starting streaming', () =>
		Effect.gen(function* () {
			const started = yield* Deferred.make<void>()
			let cancelled = false
			let requests = 0
			const setup = Deferred.succeed(started, undefined).pipe(
				Effect.andThen(Effect.never),
				Effect.ensuring(
					Effect.sync(() => {
						cancelled = true
					}),
				),
			)
			const fiber = yield* Effect.gen(function* () {
				const writer = yield* DurableStreamWriter
				yield* writer.append(event)
				yield* writer.flush()
			}).pipe(
				Effect.provide(
					writerLayer(
						setup,
						makeTransport(async () => {
							requests++
							throw new Error('Unexpected streaming request')
						}),
					),
				),
				Effect.forkChild,
			)
			yield* Deferred.await(started)
			yield* TestClock.adjust('2999 millis')
			expect(cancelled).toBe(false)
			yield* TestClock.adjust('1 millis')
			yield* Fiber.join(fiber)
			expect(cancelled).toBe(true)
			expect(requests).toBe(0)
		}),
	)

	it.effect('preserves interruption during setup instead of returning a disabled writer', () =>
		Effect.gen(function* () {
			const started = yield* Deferred.make<void>()
			let acquired = false
			const fiber = yield* Effect.gen(function* () {
				yield* DurableStreamWriter
				acquired = true
			}).pipe(
				Effect.provide(
					writerLayer(
						Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
						makeTransport(async () => {
							throw new Error('Unexpected streaming request')
						}),
					),
				),
				Effect.forkChild,
			)
			yield* Deferred.await(started)
			yield* Fiber.interrupt(fiber)
			const exit = yield* Fiber.await(fiber)
			expect(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)).toBe(true)
			expect(acquired).toBe(false)
		}),
	)

	it.effect('drains healthy batches before abort and detach, without closing the stream', () =>
		Effect.gen(function* () {
			const requests = yield* Queue.unbounded<RequestInit>()
			const ready = yield* Deferred.make<DurableStreamWriterService>()
			const firstResponse = Promise.withResolvers<Response>()
			const secondResponse = Promise.withResolvers<Response>()
			let count = 0
			const fiber = yield* Effect.gen(function* () {
				const writer = yield* DurableStreamWriter
				yield* writer.append(event)
				yield* Deferred.succeed(ready, writer)
			}).pipe(
				Effect.provide(
					writerLayer(
						ensured,
						makeTransport((init) => {
							Queue.offerUnsafe(requests, init)
							return ++count === 1 ? firstResponse.promise : secondResponse.promise
						}),
					),
				),
				Effect.forkChild,
			)
			const writer = yield* Deferred.await(ready)
			const first = yield* Queue.take(requests)
			expect(first.method).toBe('POST')
			expect(JSON.parse(String(first.body))).toEqual([event])
			expect(first.signal?.aborted).toBe(false)
			// detach sets the SDK's closed flag before flushing. This append must still
			// succeed while the initial flush is in progress (not race with detach).
			// Cross the SDK batch threshold so this queues synchronously, not on its native linger timer.
			yield* writer.append({ ...event, key: 'x'.repeat(1024 * 1024) })
			firstResponse.resolve(new Response(null, { status: 200, headers: { 'stream-next-offset': '1' } }))
			const second = yield* Queue.take(requests)
			expect(second.signal?.aborted).toBe(false)
			secondResponse.resolve(new Response(null, { status: 200 }))
			yield* Fiber.join(fiber)
			expect(first.signal?.aborted).toBe(true)
			expect(count).toBe(2)
		}),
	)

	for (const [honorsAbort, interrupted] of [
		[true, false],
		[false, false],
		[true, true],
		[false, true],
	] as const) {
		it.effect(`bounds hung POST cleanup (honors abort: ${honorsAbort}, interrupted: ${interrupted})`, () =>
			Effect.gen(function* () {
				const requests = yield* Queue.unbounded<RequestInit>()
				const aborted = yield* Queue.unbounded<void>()
				const ready = yield* Deferred.make<DurableStreamWriterService>()
				const response = Promise.withResolvers<Response>()
				let count = 0
				const fiber = yield* Effect.gen(function* () {
					const writer = yield* DurableStreamWriter
					yield* writer.append({ ...event, key: 'x'.repeat(1024 * 1024) })
					yield* Deferred.succeed(ready, writer)
					if (interrupted) yield* Effect.never
				}).pipe(
					Effect.provide(
						writerLayer(
							ensured,
							makeTransport((init) => {
								count++
								Queue.offerUnsafe(requests, init)
								init.signal?.addEventListener(
									'abort',
									() => {
										Queue.offerUnsafe(aborted, undefined)
										if (honorsAbort) response.reject(new Error('aborted'))
									},
									{ once: true },
								)
								return response.promise
							}),
						),
					),
					Effect.forkChild,
				)
				const writer = yield* Deferred.await(ready)
				const request = yield* Queue.take(requests)
				// Leave a queued batch behind the hung POST. It must not reach fetch after abort.
				yield* writer.append({ ...event, key: 'y'.repeat(1024 * 1024) })
				const interrupt = interrupted ? yield* Fiber.interrupt(fiber).pipe(Effect.forkChild) : undefined
				yield* TestClock.adjust('2 seconds')
				yield* Queue.take(aborted)
				expect(request.signal?.aborted).toBe(true)
				yield* TestClock.adjust('1 second')
				if (interrupt) {
					yield* Fiber.join(interrupt)
					const exit = yield* Fiber.await(fiber)
					expect(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)).toBe(true)
				} else {
					yield* Fiber.join(fiber)
				}
				expect(count).toBe(1)
				// Release the deliberately non-cooperative test transport after proving
				// scope closure does not depend on it.
				if (!honorsAbort) response.resolve(new Response(null, { status: 200 }))
			}),
		)
	}

	for (const interrupted of [false, true]) {
		it.effect(`stops active hung recovery before producer cleanup (interrupted: ${interrupted})`, () =>
			Effect.gen(function* () {
				const ready = yield* Deferred.make<DurableStreamWriterService>()
				const recoveryStarted = yield* Deferred.make<void>()
				const finish = yield* Deferred.make<void>()
				const requests = yield* Queue.unbounded<RequestInit>()
				const aborted = yield* Queue.unbounded<void>()
				const response = Promise.withResolvers<Response>()
				const recoveryResponse = Promise.withResolvers<{ sessionId: string; status: 'exists' }>()
				let ensureCalls = 0
				let recoveryCancelled = false
				let cancelledBeforeProducerAbort = false
				let requestCount = 0
				const setup = Effect.suspend(() => {
					ensureCalls++
					if (ensureCalls === 1) return ensured
					return Deferred.succeed(recoveryStarted, undefined).pipe(
						Effect.andThen(
							Effect.tryPromise({
								try: (signal) => {
									signal.addEventListener(
										'abort',
										() => {
											recoveryCancelled = true
										},
										{ once: true },
									)
									// Like a transport that ignores cancellation: the Effect must stop waiting.
									return recoveryResponse.promise
								},
								catch: (cause) => new DaemonConversationStreamHydrationError({ cause }),
							}),
						),
					)
				})
				const fiber = yield* Effect.gen(function* () {
					const writer = yield* DurableStreamWriter
					yield* Deferred.succeed(ready, writer)
					yield* Deferred.await(finish)
				}).pipe(
					Effect.provide(
						writerLayer(
							setup,
							makeTransport(async (init) => {
								requestCount++
								Queue.offerUnsafe(requests, init)
								if (requestCount <= 3) return new Response(null, { status: 404 })
								init.signal?.addEventListener(
									'abort',
									() => {
										cancelledBeforeProducerAbort = recoveryCancelled
										Queue.offerUnsafe(aborted, undefined)
									},
									{ once: true },
								)
								return response.promise
							}),
						),
					),
					Effect.forkChild,
				)
				const writer = yield* Deferred.await(ready)
				for (let index = 0; index < 3; index++) {
					yield* writer.append(event)
					// SDK flush joins the batch worker, including its onError callback.
					yield* writer.flush()
					yield* Queue.take(requests)
				}
				yield* TestClock.adjust('1 second')
				yield* Deferred.await(recoveryStarted)
				yield* writer.append({ ...event, key: 'x'.repeat(1024 * 1024) })
				const request = yield* Queue.take(requests)
				const shutdown = yield* (
					interrupted
						? Fiber.interrupt(fiber)
						: Deferred.succeed(finish, undefined).pipe(Effect.andThen(Fiber.await(fiber)))
				).pipe(Effect.forkChild)
				yield* TestClock.adjust('2 seconds')
				yield* Queue.take(aborted)
				expect(cancelledBeforeProducerAbort).toBe(true)
				expect(request.signal?.aborted).toBe(true)
				yield* TestClock.adjust('1 second')
				yield* Fiber.join(shutdown)
				const exit = yield* Fiber.await(fiber)
				if (interrupted) expect(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)).toBe(true)
				else expect(Exit.isSuccess(exit)).toBe(true)
				expect(ensureCalls).toBe(2)
				expect(requestCount).toBe(4)
				response.resolve(new Response(null, { status: 200 }))
				recoveryResponse.resolve({ sessionId, status: 'exists' })
			}),
		)
	}
})
