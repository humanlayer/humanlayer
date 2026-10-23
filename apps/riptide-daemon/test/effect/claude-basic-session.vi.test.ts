import type { Query } from '@anthropic-ai/claude-agent-sdk'
import { it } from '@effect/vitest'
import { Cause, Effect, Exit, Fiber } from 'effect'
import { describe, expect, vi } from 'vitest'

import { makeClaudeSdkLive } from '@/effects/services/claude-sessions/sdk/claude-sdk-session.layer'
import { ClaudeSdk } from '@/effects/services/claude-sessions/sdk/claude-sdk-session.service'
import { DaemonSessionUpdateError } from '@/effects/services/daemon-api/daemon-api.errors'
import { DaemonApiLive } from '@/effects/services/daemon-api/daemon-api.layer'
import { DaemonApi } from '@/effects/services/daemon-api/daemon-api.service'

describe('basic Effect-backed Claude session', () => {
	it.effect('keeps one prompt open until close and interrupts unfinished queries on scope exit', () => {
		let prompt: AsyncIterable<unknown> | undefined
		const interrupt = vi.fn(async () => {})
		const fakeQuery = vi.fn((input: { prompt: AsyncIterable<unknown> }) => {
			prompt = input.prompt
			return {
				interrupt,
				close: vi.fn(),
				reinitialize: vi.fn(async () => ({})),
				[Symbol.asyncIterator]: async function* () {},
			} as unknown as Query
		})
		const layer = makeClaudeSdkLive(fakeQuery as never)

		return Effect.scoped(
			Effect.gen(function* () {
				const sdk = yield* ClaudeSdk
				const session = yield* sdk.open({
					sessionId: 'session-1',
					prompt: 'hello',
					options: {
						pathToClaudeCodeExecutable: '/tmp/claude',
						cwd: '/tmp',
						model: 'opus',
						permissionMode: 'bypassPermissions',
					},
				})
				const iterator = prompt?.[Symbol.asyncIterator]()
				if (!iterator) return yield* Effect.die('SDK query did not receive a prompt')
				expect(yield* Effect.promise(() => iterator.next())).toEqual(
					expect.objectContaining({ value: expect.objectContaining({ type: 'user' }), done: false }),
				)
				const waitingForClose = iterator?.next()
				yield* session.input.close
				if (!waitingForClose) return yield* Effect.die('SDK prompt did not wait for close')
				expect(yield* Effect.promise(() => waitingForClose)).toEqual({ value: undefined, done: true })
			}),
		).pipe(Effect.provide(layer), Effect.ensuring(Effect.sync(() => expect(interrupt).toHaveBeenCalledTimes(1))))
	})

	it.effect('reads the usage snapshot without the transcript scan', () => {
		const usage = vi.fn(async (_options?: { skipBehaviors?: boolean }) => ({
			subscription_type: 'max',
			rate_limits_available: false,
			rate_limits: null,
		}))
		const fakeQuery = vi.fn(
			() =>
				({
					interrupt: vi.fn(async () => {}),
					close: vi.fn(),
					reinitialize: vi.fn(async () => ({})),
					usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: usage,
					[Symbol.asyncIterator]: async function* () {},
				}) as unknown as Query,
		)

		return Effect.scoped(
			Effect.gen(function* () {
				const sdk = yield* ClaudeSdk
				const session = yield* sdk.open({
					sessionId: 'session-1',
					prompt: 'hello',
					options: {
						pathToClaudeCodeExecutable: '/tmp/claude',
						cwd: '/tmp',
						model: 'opus',
						permissionMode: 'bypassPermissions',
					},
				})
				yield* session.controls.readUsage
				expect(usage).toHaveBeenCalledWith({ skipBehaviors: true })
			}),
		).pipe(Effect.provide(makeClaudeSdkLive(fakeQuery as never)))
	})

	it.effect('forwards fiber cancellation and retains rejected API causes', () =>
		Effect.gen(function* () {
			const rejectedCause = new Error('transport failed')
			let observedSignal: AbortSignal | undefined
			const update = vi
				.fn()
				.mockImplementationOnce(async (_input: unknown, options: { signal: AbortSignal }) => {
					observedSignal = options.signal
					await new Promise<void>((_resolve, reject) => {
						options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
					})
				})
				.mockRejectedValueOnce(rejectedCause)
			const client = {
				settings: { get: vi.fn() },
				sessions: {
					update,
					events: { create: vi.fn() },
					usage: { record: vi.fn() },
				},
			}
			const apiLayer = DaemonApiLive(client as never)
			const cancellable = Effect.gen(function* () {
				const api = yield* DaemonApi
				return yield* api.updateSession({ sessionId: 'session-1', status: 'running' })
			}).pipe(Effect.provide(apiLayer))
			const fiber = yield* Effect.forkChild(cancellable)
			yield* Effect.yieldNow
			yield* Fiber.interrupt(fiber)

			expect(observedSignal?.aborted).toBe(true)

			const exit = yield* Effect.exit(
				Effect.gen(function* () {
					const api = yield* DaemonApi
					return yield* api.updateSession({ sessionId: 'session-1', status: 'failed' })
				}).pipe(Effect.provide(apiLayer)),
			)
			expect(Exit.isFailure(exit)).toBe(true)
			if (Exit.isFailure(exit)) {
				const failure = exit.cause.reasons.find(Cause.isFailReason)
				expect(failure?.error).toBeInstanceOf(DaemonSessionUpdateError)
				expect((failure?.error as DaemonSessionUpdateError).cause).toBe(rejectedCause)
			}
		}),
	)
})
