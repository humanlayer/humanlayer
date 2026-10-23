import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import * as BunServices from '@effect/platform-bun/BunServices'
import { describe, it } from '@effect/vitest'
import { Deferred, Effect, Fiber, Layer, Stream } from 'effect'
import { TestClock } from 'effect/testing'
import { expect, vi } from 'vitest'

import { createInterruptState } from '../../src/agents/shared/interrupt-state.service'
import type { ClaudeSdkSession } from '../../src/effects/services/claude-sessions/sdk/claude-sdk-session.service'
import { processClaudeEvents } from '../../src/effects/services/claude-sessions/workflows/process-events'
import { DaemonApiLive } from '../../src/effects/services/daemon-api/daemon-api.layer'
import {
	DurableStreamWriter,
	StreamProducerLive,
} from '../../src/effects/services/stream-producer/stream-producer.service'
import { HostUsageLimitsLive } from '../../src/lib/usage-limits/host-usage-limits'
import { createTestSession } from '../helpers/session-fixtures'

const RESET_SECONDS = 600
const GRACE_MS = 60_000
const FIVE_HOURS_MS = 5 * 60 * 60 * 1000

const init = { type: 'system', subtype: 'init', session_id: 'sdk-session-1', model: 'haiku', cwd: '/tmp' }
const rejected = (resetsAt: number | undefined) => ({
	type: 'rate_limit_event',
	rate_limit_info: { status: 'rejected', rateLimitType: 'five_hour', utilization: 1, resetsAt },
})
const assistant = {
	type: 'assistant',
	uuid: 'assistant-1',
	session_id: 'sdk-session-1',
	parent_tool_use_id: null,
	message: { id: 'message-1', role: 'assistant', model: 'haiku', content: [{ type: 'text', text: 'hi' }] },
}
const apiRetry = { type: 'system', subtype: 'api_retry', attempt: 1, max_retries: 10, retry_delay_ms: 30_000 }

/** Runs the event loop over `events`, then holds the SDK stream open until the returned `end` runs. */
const startSession = (events: ReadonlyArray<Record<string, unknown>>, options: { interrupted?: boolean } = {}) =>
	Effect.gen(function* () {
		const update = vi.fn(async (_input: { status?: string }) => ({ success: true, transactionId: 'tx' }))
		const orpc = {
			sessions: {
				update,
				events: { create: vi.fn(async () => ({ eventId: 'event-1', transactionId: 'tx' })) },
				usage: { record: vi.fn(async () => ({ recorded: 1 })) },
			},
		}
		const session = createTestSession()
		const interruptState = yield* Effect.promise(createInterruptState)
		if (options.interrupted) yield* interruptState.markInterrupted('stop')
		const streamEnd = yield* Deferred.make<void>()
		const sdkSession: ClaudeSdkSession = {
			output: Stream.fromIterable(events as SDKMessage[]).pipe(
				Stream.concat(Stream.fromEffectDrain(Deferred.await(streamEnd))),
			),
			input: { sendMessage: () => Effect.void, close: Effect.void },
			controls: {
				interrupt: Effect.void,
				setModel: () => Effect.void,
				setPermissionMode: () => Effect.void,
				supportedCommands: Effect.succeed([]),
				readUsage: Effect.succeed(undefined),
			},
			markCompleted: Effect.void,
		}
		const writer = Layer.succeed(DurableStreamWriter, {
			sessionId: session.id,
			append: () => Effect.void,
			flush: () => Effect.void,
		})
		const fiber = yield* processClaudeEvents({ session, sdkSession, interruptState }).pipe(
			Effect.provide(StreamProducerLive.pipe(Layer.provide(writer))),
			Effect.provide(HostUsageLimitsLive),
			Effect.provide(DaemonApiLive(orpc as never)),
			Effect.provide(BunServices.layer),
			Effect.forkChild,
		)
		const settle = Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 20)))
		yield* settle
		const statuses = () => update.mock.calls.map(([input]) => input.status).filter((status) => status !== undefined)
		const advance = (millis: number) => TestClock.adjust(millis).pipe(Effect.andThen(settle))
		const end = Deferred.succeed(streamEnd, undefined).pipe(Effect.andThen(Fiber.join(fiber)))
		return { statuses, advance, end }
	})

describe('usage limit release', () => {
	it.effect('resumes a parked session once the window has reset and the SDK stayed silent', () =>
		Effect.gen(function* () {
			const session = yield* startSession([init, rejected(RESET_SECONDS)])
			expect(session.statuses()).toEqual(['running', 'waiting_for_usage_limit'])
			yield* session.advance(RESET_SECONDS * 1000 + GRACE_MS - 1)
			expect(session.statuses()).toEqual(['running', 'waiting_for_usage_limit'])
			yield* session.advance(1)
			expect(session.statuses()).toEqual(['running', 'waiting_for_usage_limit', 'running'])
			yield* session.end
		}),
	)

	it.effect('keeps the release scheduled through the api_retry messages of a waiting CLI', () =>
		Effect.gen(function* () {
			const session = yield* startSession([init, rejected(RESET_SECONDS), apiRetry, apiRetry])
			yield* session.advance(RESET_SECONDS * 1000 + GRACE_MS)
			expect(session.statuses()).toEqual(['running', 'waiting_for_usage_limit', 'running'])
			yield* session.end
		}),
	)

	it.effect('cancels the release when the SDK sends a real event first', () =>
		Effect.gen(function* () {
			const session = yield* startSession([
				init,
				rejected(RESET_SECONDS),
				assistant,
				{ type: 'result', subtype: 'success' },
			])
			yield* session.advance(RESET_SECONDS * 1000 + GRACE_MS)
			expect(session.statuses()).toEqual(['running', 'waiting_for_usage_limit', 'ready_for_input'])
			yield* session.end
		}),
	)

	it.effect('does not resume an interrupted session', () =>
		Effect.gen(function* () {
			const session = yield* startSession([init, rejected(RESET_SECONDS)], { interrupted: true })
			yield* session.advance(RESET_SECONDS * 1000 + GRACE_MS)
			expect(session.statuses()).toEqual(['running', 'waiting_for_usage_limit'])
			yield* session.end
		}),
	)

	it.effect('waits out the five-hour window when the rejection has no reset time', () =>
		Effect.gen(function* () {
			const session = yield* startSession([init, rejected(undefined)])
			yield* session.advance(FIVE_HOURS_MS + GRACE_MS - 1)
			expect(session.statuses()).toEqual(['running', 'waiting_for_usage_limit'])
			yield* session.advance(1)
			expect(session.statuses()).toEqual(['running', 'waiting_for_usage_limit', 'running'])
			yield* session.end
		}),
	)

	it.effect('stops the release when the session ends', () =>
		Effect.gen(function* () {
			const session = yield* startSession([init, rejected(RESET_SECONDS)])
			yield* session.end
			yield* session.advance(RESET_SECONDS * 1000 + GRACE_MS)
			expect(session.statuses()).toEqual(['running', 'waiting_for_usage_limit'])
		}),
	)
})
