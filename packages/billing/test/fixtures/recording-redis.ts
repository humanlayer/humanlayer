import { Context, Effect, Layer, Ref } from 'effect'

import {
	RedisCommandError,
	type RedisCommandName,
	RedisService,
	type RedisServiceError,
} from '../../src/redis/redis-service'

export interface RecordedRedisCommand {
	readonly command: RedisCommandName
	readonly args: ReadonlyArray<string>
}

export interface RecordingRedisControlShape {
	readonly commands: Ref.Ref<ReadonlyArray<RecordedRedisCommand>>
	readonly values: Map<string, string>
}

export class RecordingRedisControl extends Context.Service<RecordingRedisControl, RecordingRedisControlShape>()(
	'billing/test/RecordingRedisControl',
) {}

export const RecordingRedisLive = Layer.effect(
	RecordingRedisControl,
	Effect.gen(function* () {
		const commands = yield* Ref.make<ReadonlyArray<RecordedRedisCommand>>([])
		return { commands, values: new Map<string, string>() }
	}),
)

export const RecordingRedisServiceLive = Layer.effect(
	RedisService,
	Effect.gen(function* () {
		const control = yield* RecordingRedisControl
		return RedisService.of({
			send: (command, ...args) =>
				Ref.update(control.commands, (commands) => [...commands, { command, args }]).pipe(
					Effect.andThen(
						Effect.suspend((): Effect.Effect<unknown, RedisServiceError> => {
							const key = args[0]
							if (key === undefined && command !== 'PING') {
								return Effect.fail(
									new RedisCommandError({
										command,
										cause: new Error('Expected a Redis key argument'),
									}),
								)
							}
							if (command === 'GET') return Effect.succeed(control.values.get(key ?? '') ?? null)
							if (command === 'SET') {
								const value = args[1]
								if (value === undefined) {
									return Effect.fail(
										new RedisCommandError({
											command,
											cause: new Error('Expected a Redis value argument'),
										}),
									)
								}
								control.values.set(key ?? '', value)
								return Effect.succeed('OK')
							}
							if (command === 'DEL') return Effect.succeed(control.values.delete(key ?? '') ? 1 : 0)
							if (command === 'PING') return Effect.succeed('PONG')
							return Effect.fail(
								new RedisCommandError({
									command,
									cause: new Error('Unexpected recording Redis command'),
								}),
							)
						}),
					),
				),
		})
	}),
)

export const RecordingRedisTestLive = RecordingRedisServiceLive.pipe(Layer.provideMerge(RecordingRedisLive))
