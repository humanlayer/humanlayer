import * as ConfigProvider from 'effect/ConfigProvider'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'

import { InheritedEnvironment } from './inherited-environment'

/** Native adapter: snapshots copy all defined inherited keys, without changing application Config. */
export const makeNativeEnvironmentLayer = (readEnvironment: () => Readonly<Record<string, string | undefined>>) =>
	Layer.succeed(InheritedEnvironment, {
		snapshot: Effect.sync(() =>
			Object.fromEntries(
				Object.entries(readEnvironment()).filter((entry): entry is [string, string] => entry[1] !== undefined),
			),
		).pipe(Effect.withSpan('native_environment.snapshot')),
	})

/** Provide ONLY to adapters migrated from raw env reads, never to the application/startup graph. */
export const makeNativeScalarConfigLayer = (readEnvironment: () => Readonly<Record<string, string | undefined>>) =>
	Layer.sync(ConfigProvider.ConfigProvider, () =>
		ConfigProvider.fromEnvRecord(readEnvironment(), { preserveEmptyStrings: true }),
	)

export const NativeEnvironmentLive = makeNativeEnvironmentLayer(() => process.env)
export const NativeScalarConfigLive = makeNativeScalarConfigLayer(() => process.env)
