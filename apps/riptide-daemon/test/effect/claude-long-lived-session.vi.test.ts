import type { Query, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { it } from '@effect/vitest'
import { Deferred, Effect, Fiber, Stream } from 'effect'
import { TestClock } from 'effect/testing'
import { describe, expect, test, vi } from 'vitest'

import {
	makeClaudeSdkLive,
	type ClaudeQueryFactory,
} from '@/effects/services/claude-sessions/sdk/claude-sdk-session.layer'
import { ClaudeSdk } from '@/effects/services/claude-sessions/sdk/claude-sdk-session.service'

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
})
