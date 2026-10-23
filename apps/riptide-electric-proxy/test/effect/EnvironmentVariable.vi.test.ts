import { it } from '@effect/vitest'
import { Config, ConfigProvider, Effect } from 'effect'

import { EnvironmentVariable, EnvironmentVariableNotFoundError } from '../../src/lib/effect/environment'

// Construct before providing configuration to guard against eager ambient reads.
const readVariable = EnvironmentVariable('TEST_VARIABLE')

it.effect('loads the scoped value without trimming it', ({ expect }) =>
	Effect.gen(function* () {
		expect(yield* readVariable).toBe(' test value ')
	}).pipe(Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ TEST_VARIABLE: ' test value ' })))),
)

for (const values of [{}, { TEST_VARIABLE: '' }]) {
	it.effect(`rejects ${'TEST_VARIABLE' in values ? 'empty' : 'missing'} values`, ({ expect }) =>
		Effect.gen(function* () {
			expect(yield* Effect.flip(readVariable)).toEqual(
				new EnvironmentVariableNotFoundError({ variableName: 'TEST_VARIABLE' }),
			)
		}).pipe(
			Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(values, { preserveEmptyStrings: true }))),
		),
	)
}

it.effect('preserves source failures as ConfigErrors rather than missing variables', ({ expect }) =>
	Effect.gen(function* () {
		const sourceError = new ConfigProvider.SourceError({ message: 'Configuration source unavailable' })
		const error = yield* Effect.flip(readVariable).pipe(
			Effect.provide(ConfigProvider.layer(ConfigProvider.make(() => Effect.fail(sourceError)))),
		)
		expect(error).toEqual(new Config.ConfigError(sourceError))
	}),
)
