import type { Query, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { it } from '@effect/vitest'
import { Deferred, Effect, Fiber, Logger, Option, Stream } from 'effect'
import { TestClock } from 'effect/testing'
import { describe, expect, test, vi } from 'vitest'

import {
	makeClaudeSdkLive,
	type ClaudeQueryFactory,
} from '@/effects/services/claude-sessions/sdk/claude-sdk-session.layer'
import { ClaudeSdk } from '@/effects/services/claude-sessions/sdk/claude-sdk-session.service'

import { makeSdkShapedQuery } from '../mocks/claude-sdk-query.mock'

function makeQueryHarness(interruptQuery: () => Promise<void> = async () => {}) {
	let prompt: AsyncIterable<SDKUserMessage> | undefined
	const interrupt = vi.fn(interruptQuery)
	const close = vi.fn(() => {})

	async function* output(): AsyncGenerator<SDKMessage, void> {
		return
	}

	const query = Object.assign(output(), {
		interrupt,
		close,
		setModel: vi.fn(async () => {}),
		setPermissionMode: vi.fn(async () => {}),
	}) as unknown as Query
	const factory = vi.fn(({ prompt: input }: Parameters<ClaudeQueryFactory>[0]) => {
		if (typeof input === 'string') throw new Error('Expected streaming input')
		prompt = input
		return query
	}) as unknown as ClaudeQueryFactory

	return {
		factory,
		query,
		interrupt,
		close,
		getPrompt: () => {
			if (!prompt) throw new Error('Prompt stream was not created')
			return prompt
		},
	}
}

describe('long-lived Claude SDK input', () => {
	test('keeps one streaming input open across ordered follow-up messages', async () => {
		const harness = makeQueryHarness()

		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const sdk = yield* ClaudeSdk
					const session = yield* sdk.open({ sessionId: 'session-1', prompt: 'first', options: {} })
					const input = harness.getPrompt()[Symbol.asyncIterator]()

					expect((yield* Effect.promise(() => input.next())).value?.message.content).toBe('first')
					yield* session.input.sendMessage('second')
					yield* session.input.sendMessage('third')
					expect((yield* Effect.promise(() => input.next())).value?.message.content).toBe('second')
					expect((yield* Effect.promise(() => input.next())).value?.message.content).toBe('third')

					yield* session.input.close
					expect((yield* Effect.promise(() => input.next())).done).toBe(true)
					yield* session.markCompleted
				}),
			).pipe(Effect.provide(makeClaudeSdkLive(harness.factory))),
		)

		expect(harness.factory).toHaveBeenCalledTimes(1)
		expect(harness.interrupt).not.toHaveBeenCalled()
		expect(harness.close).not.toHaveBeenCalled()
	})

	test('rejects send after input close and finalizes an incomplete query once', async () => {
		const harness = makeQueryHarness()

		const exit = await Effect.runPromiseExit(
			Effect.scoped(
				Effect.gen(function* () {
					const sdk = yield* ClaudeSdk
					const session = yield* sdk.open({ sessionId: 'session-1', prompt: 'first', options: {} })
					yield* session.input.close
					yield* session.input.sendMessage('too late')
				}),
			).pipe(Effect.provide(makeClaudeSdkLive(harness.factory))),
		)

		expect(exit._tag).toBe('Failure')
		expect(harness.interrupt).toHaveBeenCalledTimes(1)
		expect(harness.close).toHaveBeenCalledTimes(1)
	})

	it.effect('force closes a query when graceful interruption does not respond', ({ expect }) =>
		Effect.gen(function* () {
			const opened = yield* Deferred.make<void>()
			const harness = makeQueryHarness(() => new Promise<void>(() => {}))
			const run = yield* Effect.scoped(
				Effect.gen(function* () {
					const sdk = yield* ClaudeSdk
					yield* sdk.open({ sessionId: 'stuck-session', prompt: 'first', options: {} })
					yield* Deferred.succeed(opened, undefined)
					yield* Effect.never
				}),
			).pipe(Effect.provide(makeClaudeSdkLive(harness.factory)), Effect.forkChild)
			yield* Deferred.await(opened)
			const stop = yield* Fiber.interrupt(run).pipe(Effect.forkChild)
			yield* Effect.yieldNow
			expect(harness.interrupt).toHaveBeenCalledTimes(1)

			yield* TestClock.adjust('2 seconds')
			yield* Fiber.join(stop)

			expect(harness.close).toHaveBeenCalledTimes(1)
		}),
	)

	describe('stopping a session whose output is being read', () => {
		const resultMessage = { type: 'result', subtype: 'success' } as SDKMessage

		const readOutput = (
			harness: ReturnType<typeof makeSdkShapedQuery>,
			onMessage: (message: SDKMessage) => Effect.Effect<void> = () => Effect.void,
		) =>
			Effect.scoped(
				Effect.gen(function* () {
					const sdk = yield* ClaudeSdk
					const session = yield* sdk.open({ sessionId: 'session-1', prompt: 'first', options: {} })
					yield* session.output.pipe(Stream.runForEach(onMessage))
					yield* session.markCompleted
				}),
			).pipe(Effect.provide(makeClaudeSdkLive(harness.factory)))

		it.effect('closes the query when the session is stopped while it waits for the next message', ({ expect }) => {
			const harness = makeSdkShapedQuery()
			return Effect.gen(function* () {
				harness.emit(resultMessage)
				const run = yield* readOutput(harness).pipe(Effect.forkChild)
				yield* Effect.promise(harness.whenWaiting)

				const stopped = yield* Fiber.interrupt(run).pipe(Effect.timeoutOption('1 second'), TestClock.withLive)

				expect(Option.isSome(stopped)).toBe(true)
				expect(harness.isChildAlive()).toBe(false)
				expect(harness.interrupt).toHaveBeenCalledTimes(1)
				expect(harness.close).toHaveBeenCalledTimes(1)
			}).pipe(Effect.ensuring(Effect.sync(harness.exitChild)))
		})

		it.effect(
			'closes the query when its output stops, before the rest of the session scope closes',
			({ expect }) => {
				const harness = makeSdkShapedQuery()
				let releaseSessionFinalizer = () => {}
				const sessionFinalizerHeld = new Promise<void>((resolve) => {
					releaseSessionFinalizer = resolve
				})
				return Effect.gen(function* () {
					const sessionFinalizerStarted = yield* Deferred.make<void>()
					const run = yield* Effect.scoped(
						Effect.gen(function* () {
							const sdk = yield* ClaudeSdk
							const session = yield* sdk.open({ sessionId: 'session-1', prompt: 'first', options: {} })
							yield* Effect.addFinalizer(() =>
								Deferred.succeed(sessionFinalizerStarted, undefined).pipe(
									Effect.andThen(Effect.promise(() => sessionFinalizerHeld)),
								),
							)
							yield* session.output.pipe(Stream.runDrain)
						}),
					).pipe(Effect.provide(makeClaudeSdkLive(harness.factory)), Effect.forkChild)
					yield* Effect.promise(harness.whenWaiting)

					const stop = yield* Fiber.interrupt(run).pipe(Effect.forkChild)
					const started = yield* Deferred.await(sessionFinalizerStarted).pipe(
						Effect.timeoutOption('1 second'),
						TestClock.withLive,
					)

					expect(Option.isSome(started)).toBe(true)
					expect(harness.interrupt).toHaveBeenCalledTimes(1)
					expect(harness.close).toHaveBeenCalledTimes(1)
					releaseSessionFinalizer()
					yield* Fiber.join(stop)
				}).pipe(
					Effect.ensuring(
						Effect.sync(() => {
							releaseSessionFinalizer()
							harness.exitChild()
						}),
					),
				)
			},
		)

		it.effect('interrupts the query before closing it when the session is stopped mid-message', ({ expect }) => {
			const harness = makeSdkShapedQuery()
			const logs: unknown[] = []
			const logger = Logger.layer([Logger.map(Logger.formatStructured, (output) => logs.push(output.message))])
			return Effect.gen(function* () {
				const handling = yield* Deferred.make<void>()
				harness.emit(resultMessage)
				const run = yield* readOutput(harness, () =>
					Deferred.succeed(handling, undefined).pipe(Effect.andThen(Effect.never)),
				).pipe(Effect.forkChild)
				yield* Deferred.await(handling)

				yield* Fiber.interrupt(run)

				expect(harness.interrupt).toHaveBeenCalledTimes(1)
				expect(harness.close).toHaveBeenCalledTimes(1)
				expect(harness.interrupt.mock.invocationCallOrder[0]).toBeLessThan(
					harness.close.mock.invocationCallOrder[0] ?? Number.NEGATIVE_INFINITY,
				)
				expect(logs).not.toContain('Graceful Claude SDK interruption failed')
			}).pipe(Effect.provide(logger), Effect.ensuring(Effect.sync(harness.exitChild)))
		})

		it.effect('leaves a query alone when its output already ended', ({ expect }) => {
			const harness = makeSdkShapedQuery()
			return Effect.gen(function* () {
				harness.emit(resultMessage)
				harness.exitChild()

				yield* readOutput(harness)

				expect(harness.interrupt).not.toHaveBeenCalled()
				expect(harness.close).not.toHaveBeenCalled()
			})
		})

		it.effect('closes the query when the session stops reading before the output ends', ({ expect }) => {
			const harness = makeSdkShapedQuery()
			return Effect.gen(function* () {
				harness.emit(resultMessage)

				yield* Effect.scoped(
					Effect.gen(function* () {
						const sdk = yield* ClaudeSdk
						const session = yield* sdk.open({ sessionId: 'session-1', prompt: 'first', options: {} })
						yield* session.output.pipe(Stream.take(1), Stream.runDrain)
						yield* session.markCompleted
					}),
				).pipe(Effect.provide(makeClaudeSdkLive(harness.factory)))

				expect(harness.interrupt).toHaveBeenCalledTimes(1)
				expect(harness.close).toHaveBeenCalledTimes(1)
				expect(harness.isChildAlive()).toBe(false)
			}).pipe(Effect.ensuring(Effect.sync(harness.exitChild)))
		})
	})
})
