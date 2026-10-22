import { Config, Data, Effect, Option } from 'effect'

/**
 * Tagged Error for if an environment variable is not found.
 */
export class EnvironmentVariableNotFoundError extends Data.TaggedError('EnvironmentVariableNotFoundError')<{
	variableName: string
}> {}

/**
 * Effect for loading an environment variable
 * @param variableName
 * @returns
 */
export const EnvironmentVariable = (
	variableName: string,
): Effect.Effect<string, EnvironmentVariableNotFoundError | Config.ConfigError> =>
	Effect.gen(function* () {
		// Only absence and empty strings are missing; provider/decoding failures remain ConfigErrors.
		const variable = yield* Config.option(Config.String(variableName))
		if (Option.isNone(variable) || variable.value === '') {
			return yield* Effect.fail(new EnvironmentVariableNotFoundError({ variableName }))
		}
		return variable.value
	}).pipe(Effect.withSpan('EnvironmentVariable.load'))
