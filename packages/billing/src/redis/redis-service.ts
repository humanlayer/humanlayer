import { Context, Data, Effect, Schema } from 'effect'

export const RedisClientMode = Schema.Literals(['standalone', 'cluster'])
export type RedisClientMode = typeof RedisClientMode.Type

export const RedisCommandName = Schema.Literals(['GET', 'SET', 'DEL', 'PING', 'CLUSTER'])
export type RedisCommandName = typeof RedisCommandName.Type

export type RedisOperationName = RedisCommandName | 'CONNECT' | 'QUIT'

export class RedisConnectionError extends Data.TaggedError('RedisConnectionError')<{
	readonly mode: RedisClientMode
	readonly cause: unknown
}> {}

export class RedisConnectionTimeoutError extends Data.TaggedError('RedisConnectionTimeoutError')<{
	readonly mode: RedisClientMode
}> {}

export class RedisClusterUnavailableError extends Data.TaggedError('RedisClusterUnavailableError')<{
	readonly command: RedisCommandName
	readonly cause: unknown
}> {}

export class RedisRetriesExhaustedError extends Data.TaggedError('RedisRetriesExhaustedError')<{
	readonly command: RedisCommandName
	readonly cause: unknown
}> {}

export class RedisCommandError extends Data.TaggedError('RedisCommandError')<{
	readonly command: RedisCommandName
	readonly cause: unknown
}> {}

export type RedisInitializationError = RedisConnectionError | RedisConnectionTimeoutError

export type RedisServiceError = RedisClusterUnavailableError | RedisRetriesExhaustedError | RedisCommandError

export interface RedisServiceShape {
	readonly send: (
		command: RedisCommandName,
		...args: ReadonlyArray<string>
	) => Effect.Effect<unknown, RedisServiceError>
}

export class RedisService extends Context.Service<RedisService, RedisServiceShape>()('billing/RedisService') {}

const RedisNullableStringReply = Schema.NullOr(Schema.String)
const RedisOkayReply = Schema.Literal('OK')
const RedisIntegerReply = Schema.Int
const RedisPingReply = Schema.String

const decodeRedisReply = <A, E>(
	decode: (reply: unknown) => Effect.Effect<A, E>,
	command: RedisCommandName,
	reply: unknown,
	message: string,
): Effect.Effect<A, RedisCommandError> =>
	decode(reply).pipe(
		Effect.mapError(
			(cause) =>
				new RedisCommandError({
					command,
					cause: new Error(message, { cause }),
				}),
		),
	)

export const decodeRedisNullableStringReply = (
	command: RedisCommandName,
	reply: unknown,
): Effect.Effect<string | null, RedisCommandError> =>
	decodeRedisReply(
		Schema.decodeUnknownEffect(RedisNullableStringReply),
		command,
		reply,
		'Redis returned an unexpected nullable string reply',
	)

export const decodeRedisOkayReply = (
	command: RedisCommandName,
	reply: unknown,
): Effect.Effect<void, RedisCommandError> =>
	decodeRedisReply(
		Schema.decodeUnknownEffect(RedisOkayReply),
		command,
		reply,
		'Redis returned an unexpected acknowledgement reply',
	).pipe(Effect.asVoid)

export const decodeRedisIntegerReply = (
	command: RedisCommandName,
	reply: unknown,
): Effect.Effect<number, RedisCommandError> =>
	decodeRedisReply(
		Schema.decodeUnknownEffect(RedisIntegerReply),
		command,
		reply,
		'Redis returned an unexpected integer reply',
	)

export const decodeRedisCommandReply = (
	command: RedisCommandName,
	reply: unknown,
): Effect.Effect<unknown, RedisCommandError> => {
	switch (command) {
		case 'GET':
			return decodeRedisNullableStringReply(command, reply)
		case 'SET':
			return decodeRedisOkayReply(command, reply).pipe(Effect.as(reply))
		case 'DEL':
			return decodeRedisIntegerReply(command, reply)
		case 'PING':
			return decodeRedisReply(
				Schema.decodeUnknownEffect(RedisPingReply),
				command,
				reply,
				'Redis returned an unexpected PING reply',
			)
		case 'CLUSTER':
			return Effect.succeed(reply)
	}
}
