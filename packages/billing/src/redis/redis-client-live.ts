import { Effect, Layer, type Redacted } from 'effect'
import * as ClusterAllFailedErrorModule from 'ioredis/built/errors/ClusterAllFailedError'
import * as MaxRetriesPerRequestErrorModule from 'ioredis/built/errors/MaxRetriesPerRequestError'

import { redisConnectionConfig } from './redis-config'
import {
	RedisClusterUnavailableError,
	RedisCommandError,
	decodeRedisCommandReply,
	type RedisCommandName,
	RedisConnectionError,
	RedisConnectionTimeoutError,
	type RedisClientMode,
	RedisRetriesExhaustedError,
	RedisService,
	type RedisServiceError,
} from './redis-service'

const RedisFailureClass = {
	connection: 'connection',
	timeout: 'timeout',
	clusterUnavailable: 'cluster_unavailable',
	retriesExhausted: 'retries_exhausted',
	command: 'command',
	cleanup: 'cleanup',
} as const

export interface RedisDriverClient {
	readonly connect: () => Promise<void>
	readonly call: (command: string, ...args: ReadonlyArray<string>) => Promise<unknown>
	readonly quit: () => Promise<unknown>
	readonly disconnect: () => void
}

export interface RedisDriverClientFactory {
	readonly create: (url: Redacted.Redacted<URL>) => RedisDriverClient
}

const classifyCommandFailure = (command: RedisCommandName, cause: unknown): RedisServiceError => {
	if (
		typeof ClusterAllFailedErrorModule.default === 'function' &&
		cause instanceof ClusterAllFailedErrorModule.default
	) {
		return new RedisClusterUnavailableError({ command, cause })
	}
	if (
		typeof MaxRetriesPerRequestErrorModule.default === 'function' &&
		cause instanceof MaxRetriesPerRequestErrorModule.default
	) {
		return new RedisRetriesExhaustedError({ command, cause })
	}
	return new RedisCommandError({ command, cause })
}

const reportRedisFailure = (
	mode: RedisClientMode,
	command: RedisCommandName | 'CONNECT' | 'QUIT',
	failureClass: (typeof RedisFailureClass)[keyof typeof RedisFailureClass],
) =>
	Effect.logError('Redis operation failed').pipe(
		Effect.annotateLogs({
			redis_mode: mode,
			redis_command: command,
			redis_failure_class: failureClass,
		}),
	)

const reportCommandFailure = (mode: RedisClientMode, error: RedisServiceError) =>
	Effect.fail(error).pipe(
		Effect.catchTags({
			RedisClusterUnavailableError: (failure) =>
				reportRedisFailure(mode, failure.command, RedisFailureClass.clusterUnavailable),
			RedisRetriesExhaustedError: (failure) =>
				reportRedisFailure(mode, failure.command, RedisFailureClass.retriesExhausted),
			RedisCommandError: (failure) => reportRedisFailure(mode, failure.command, RedisFailureClass.command),
		}),
	)

export const makeRedisDriverLive = (mode: RedisClientMode, factory: RedisDriverClientFactory) =>
	Layer.effect(
		RedisService,
		Effect.gen(function* () {
			const config = yield* redisConnectionConfig
			const client = yield* Effect.try({
				try: () => factory.create(config.url),
				catch: (cause) => new RedisConnectionError({ mode, cause }),
			}).pipe(Effect.tapError(() => reportRedisFailure(mode, 'CONNECT', RedisFailureClass.connection)))
			let ready = false
			let released = false
			const disconnectImmediately = Effect.try({
				try: () => client.disconnect(),
				catch: (cause) => new RedisCommandError({ command: 'PING', cause }),
			}).pipe(
				Effect.tapError(() => reportRedisFailure(mode, 'QUIT', RedisFailureClass.cleanup)),
				Effect.ignore,
			)

			yield* Effect.addFinalizer(() =>
				Effect.suspend(() => {
					if (released) return Effect.void
					released = true
					if (!ready) {
						return disconnectImmediately
					}

					return Effect.tryPromise({
						try: () => client.quit(),
						catch: (cause) => new RedisCommandError({ command: 'PING', cause }),
					}).pipe(
						Effect.timeoutOrElse({
							duration: config.readinessTimeout,
							orElse: () => Effect.fail(new RedisConnectionTimeoutError({ mode })),
						}),
						Effect.tapError(() => reportRedisFailure(mode, 'QUIT', RedisFailureClass.cleanup)),
						Effect.catch(() => disconnectImmediately),
					)
				}),
			)

			yield* Effect.tryPromise({
				try: () => client.connect(),
				catch: (cause) => new RedisConnectionError({ mode, cause }),
			}).pipe(
				Effect.tapError(() => reportRedisFailure(mode, 'CONNECT', RedisFailureClass.connection)),
				Effect.timeoutOrElse({
					duration: config.readinessTimeout,
					orElse: () =>
						reportRedisFailure(mode, 'CONNECT', RedisFailureClass.timeout).pipe(
							Effect.andThen(Effect.fail(new RedisConnectionTimeoutError({ mode }))),
						),
				}),
			)
			ready = true
			yield* Effect.logInfo('Redis client ready').pipe(Effect.annotateLogs({ redis_mode: mode }))

			return RedisService.of({
				send: (command, ...args) =>
					Effect.tryPromise({
						try: () => client.call(command, ...args),
						catch: (cause) => classifyCommandFailure(command, cause),
					}).pipe(
						Effect.flatMap((reply) => decodeRedisCommandReply(command, reply)),
						Effect.tapError((error) => reportCommandFailure(mode, error)),
						Effect.withSpan('redis.send', { attributes: { redis_mode: mode, redis_command: command } }),
					),
			})
		}),
	)
