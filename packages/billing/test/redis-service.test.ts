import { describe, it } from '@effect/vitest'
import { ConfigProvider, Effect, Exit, Fiber, Layer, Logger } from 'effect'
import { TestClock } from 'effect/testing'
import { expect } from 'vitest'

import { makeRedisDriverLive, type RedisDriverClient } from '../src/redis/redis-client-live'
import { redisClientModeConfig } from '../src/redis/redis-config'
import {
	decodeRedisIntegerReply,
	decodeRedisNullableStringReply,
	decodeRedisOkayReply,
	RedisCommandError,
	RedisConnectionError,
	RedisConnectionTimeoutError,
	RedisService,
} from '../src/redis/redis-service'

interface DriverState {
	connectCount: number
	quitCount: number
	disconnectCount: number
	readonly commands: Array<ReadonlyArray<string>>
}

interface CapturedRedisLog {
	readonly message: string
	readonly annotations: unknown
}

const makeDriverState = (): DriverState => ({
	connectCount: 0,
	quitCount: 0,
	disconnectCount: 0,
	commands: [],
})

const makeClient = (state: DriverState, overrides: Partial<RedisDriverClient> = {}): RedisDriverClient => ({
	connect: async () => {
		state.connectCount += 1
	},
	call: async (command, ...args) => {
		state.commands.push([command, ...args])
		return command === 'GET' ? 'value' : 'OK'
	},
	quit: async () => {
		state.quitCount += 1
		return 'OK'
	},
	disconnect: () => {
		state.disconnectCount += 1
	},
	...overrides,
})

const makeTestRedisLayer = (
	client: RedisDriverClient,
	logs: Array<CapturedRedisLog> = [],
	config: Record<string, unknown> = { KV_URL: 'redis://127.0.0.1:6379', REDIS_READINESS_TIMEOUT: '1 second' },
	mode: 'standalone' | 'cluster' = 'standalone',
) => {
	const logger = Logger.make<unknown, void>((options) => {
		const entry = Logger.formatStructured.log(options)
		logs.push({
			message: Array.isArray(entry.message) ? entry.message.map(String).join(' ') : String(entry.message),
			annotations: entry.annotations,
		})
	})
	const configProvider = ConfigProvider.layer(ConfigProvider.fromUnknown(config))
	const loggerLayer = Logger.layer([logger])
	return Layer.mergeAll(
		makeRedisDriverLive(mode, { create: () => client }).pipe(
			Layer.provide(configProvider),
			Layer.provide(loggerLayer),
		),
		loggerLayer,
	)
}

describe('RedisService', () => {
	it.effect('decodes command replies without unchecked generic result types', () =>
		Effect.gen(function* () {
			expect(yield* decodeRedisNullableStringReply('GET', null)).toBeNull()
			expect(yield* decodeRedisNullableStringReply('GET', 'value')).toBe('value')
			yield* decodeRedisOkayReply('SET', 'OK')
			expect(yield* decodeRedisIntegerReply('DEL', 1)).toBe(1)

			for (const invalidReply of [undefined, 1, {}, []]) {
				const error = yield* decodeRedisNullableStringReply('GET', invalidReply).pipe(Effect.flip)
				expect(error).toBeInstanceOf(RedisCommandError)
			}
		}),
	)

	it.effect('rejects malformed acknowledgement and integer replies with schema-backed command errors', () =>
		Effect.gen(function* () {
			for (const [decode, reply] of [
				[decodeRedisOkayReply, 'NO'],
				[decodeRedisIntegerReply, 1.5],
			] as const) {
				const error = yield* decode('DEL', reply).pipe(Effect.flip)
				expect(error).toBeInstanceOf(RedisCommandError)
				expect(error.cause).toBeInstanceOf(Error)
			}
		}),
	)

	it.effect('connects exactly once, sends commands, and quits on successful scope disposal', () =>
		Effect.gen(function* () {
			const state = makeDriverState()
			const layer = makeTestRedisLayer(makeClient(state))

			const reply = yield* Effect.gen(function* () {
				const redis = yield* RedisService
				return yield* redis.send('GET', 'private-key')
			}).pipe(Effect.provide(layer))

			expect(reply).toBe('value')
			expect(state.connectCount).toBe(1)
			expect(state.commands).toEqual([['GET', 'private-key']])
			expect(state.quitCount).toBe(1)
			expect(state.disconnectCount).toBe(0)
		}),
	)

	it.effect('logs sanitized command evidence before returning the classified failure', () =>
		Effect.gen(function* () {
			const state = makeDriverState()
			const logs: Array<CapturedRedisLog> = []
			const client = makeClient(state, {
				call: async () => {
					throw new Error('driver failure contains redis://user:password@host and private-key')
				},
			})
			const error = yield* Effect.gen(function* () {
				const redis = yield* RedisService
				return yield* redis.send('GET', 'private-key')
			}).pipe(Effect.provide(makeTestRedisLayer(client, logs, undefined, 'cluster')), Effect.flip)

			expect(error).toBeInstanceOf(RedisCommandError)
			expect(logs).toContainEqual({
				message: 'Redis operation failed',
				annotations: expect.objectContaining({
					redis_mode: 'cluster',
					redis_command: 'GET',
					redis_failure_class: 'command',
				}),
			})
			expect(JSON.stringify(logs)).not.toContain('redis://user:password@host')
			expect(JSON.stringify(logs)).not.toContain('private-key')
		}),
	)

	it.effect('captures an unexpected driver reply before returning a command error', () =>
		Effect.gen(function* () {
			const state = makeDriverState()
			const logs: Array<CapturedRedisLog> = []
			const client = makeClient(state, { call: async () => ({ secret: 'not logged' }) })
			const error = yield* Effect.gen(function* () {
				const redis = yield* RedisService
				return yield* redis.send('GET', 'private-key')
			}).pipe(Effect.provide(makeTestRedisLayer(client, logs)), Effect.flip)

			expect(error).toBeInstanceOf(RedisCommandError)
			expect(logs).toContainEqual({
				message: 'Redis operation failed',
				annotations: expect.objectContaining({
					redis_mode: 'standalone',
					redis_command: 'GET',
					redis_failure_class: 'command',
				}),
			})
			expect(JSON.stringify(logs)).not.toContain('not logged')
		}),
	)

	it.effect('disconnects a partially acquired client when connect fails', () =>
		Effect.gen(function* () {
			const state = makeDriverState()
			const logs: Array<CapturedRedisLog> = []
			const client = makeClient(state, {
				connect: async () => {
					state.connectCount += 1
					throw new Error('connection rejected')
				},
			})

			const error = yield* RedisService.pipe(Effect.provide(makeTestRedisLayer(client, logs)), Effect.flip)
			expect(error).toBeInstanceOf(RedisConnectionError)
			expect(state.connectCount).toBe(1)
			expect(state.disconnectCount).toBe(1)
			expect(state.quitCount).toBe(0)
			expect(logs).toContainEqual({
				message: 'Redis operation failed',
				annotations: expect.objectContaining({
					redis_mode: 'standalone',
					redis_command: 'CONNECT',
					redis_failure_class: 'connection',
				}),
			})
		}),
	)

	it.effect('times out readiness and releases the client without sleeps', () =>
		Effect.gen(function* () {
			const state = makeDriverState()
			const logs: Array<CapturedRedisLog> = []
			const client = makeClient(state, {
				connect: () => {
					state.connectCount += 1
					return new Promise<void>(() => undefined)
				},
			})
			const fiber = yield* RedisService.pipe(Effect.provide(makeTestRedisLayer(client, logs)), Effect.forkChild)
			yield* TestClock.adjust('1 second')
			const error = yield* Fiber.join(fiber).pipe(Effect.flip)

			expect(error).toBeInstanceOf(RedisConnectionTimeoutError)
			expect(state.connectCount).toBe(1)
			expect(state.disconnectCount).toBe(1)
			expect(logs).toContainEqual({
				message: 'Redis operation failed',
				annotations: expect.objectContaining({
					redis_mode: 'standalone',
					redis_command: 'CONNECT',
					redis_failure_class: 'timeout',
				}),
			})
		}),
	)

	it.effect('registers cleanup before readiness so interruption disconnects immediately', () =>
		Effect.gen(function* () {
			const state = makeDriverState()
			const started = Promise.withResolvers<void>()
			const client = makeClient(state, {
				connect: () => {
					state.connectCount += 1
					started.resolve()
					return new Promise<void>(() => undefined)
				},
			})
			const fiber = yield* RedisService.pipe(Effect.provide(makeTestRedisLayer(client)), Effect.forkChild)
			yield* Effect.promise(() => started.promise)
			yield* Fiber.interrupt(fiber)

			expect(state.connectCount).toBe(1)
			expect(state.disconnectCount).toBe(1)
			expect(state.quitCount).toBe(0)
		}),
	)

	it.effect('defaults only a missing mode and rejects an invalid supplied mode', () =>
		Effect.gen(function* () {
			expect(
				yield* redisClientModeConfig.pipe(Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({})))),
			).toBe('standalone')

			const invalid = yield* redisClientModeConfig.pipe(
				Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ REDIS_CLIENT_MODE: 'invalid' }))),
				Effect.exit,
			)
			expect(Exit.isFailure(invalid)).toBe(true)
		}),
	)
})
