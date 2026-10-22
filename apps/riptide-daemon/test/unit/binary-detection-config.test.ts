import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { describe, it } from '@effect/vitest'
import { ConfigProvider, Effect, FileSystem, Layer, Path } from 'effect'
import { TestConsole } from 'effect/testing'
import { expect } from 'vitest'

import { createCachedBinaryLocator, detectBinaryPathEffect } from '../../src/lib/binary-detection'

const platform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)
const configuration = (record: Record<string, unknown>) =>
	ConfigProvider.layer(ConfigProvider.fromUnknown(record, { preserveEmptyStrings: true }))

describe('binary override configuration', () => {
	it.effect('isolates providers and falls through missing, empty, invalid, and skipped overrides', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem
				const path = yield* Path.Path
				const directory = yield* fs.makeTempDirectoryScoped()
				const first = path.join(directory, 'first')
				const second = path.join(directory, 'second')
				for (const file of [first, second]) {
					yield* fs.writeFileString(file, '#!/bin/sh\nexit 0\n')
					yield* fs.chmod(file, 0o755)
				}
				const detect = detectBinaryPathEffect({
					binaryName: 'config-fixture-binary',
					envVarName: 'BINARY_OVERRIDE',
					additionalPaths: [first],
					enableLogging: false,
				})
				const results = yield* Effect.all(
					[
						detect.pipe(Effect.provide(configuration({ BINARY_OVERRIDE: second }))),
						detect.pipe(Effect.provide(configuration({ BINARY_OVERRIDE: first }))),
						detect.pipe(Effect.provide(configuration({}))),
						detect.pipe(Effect.provide(configuration({ BINARY_OVERRIDE: '' }))),
						detect.pipe(Effect.provide(configuration({ BINARY_OVERRIDE: '/missing/binary' }))),
						detect.pipe(
							Effect.provide(configuration({ BINARY_OVERRIDE: `${directory}/node_modules/bin` })),
						),
					],
					{ concurrency: 'unbounded' },
				)
				expect(results).toEqual([second, first, first, first, first, first])
				const failingProvider = ConfigProvider.layer(
					ConfigProvider.make(() => Effect.fail(new ConfigProvider.SourceError({ message: 'Unavailable' }))),
				)
				const error = yield* detect.pipe(Effect.provide(failingProvider), Effect.flip)
				expect(error).toMatchObject({ _tag: 'ConfigError' })
			}),
		).pipe(Effect.provide(platform)),
	)

	it.effect('rereads override on retry and after resetting the same locator', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem
				const path = yield* Path.Path
				const directory = yield* fs.makeTempDirectoryScoped()
				const executable = path.join(directory, 'appeared-later')
				const locator = createCachedBinaryLocator({
					binaryName: 'missing-config-fixture-binary-84329',
					envVarName: 'BINARY_OVERRIDE',
					enableLogging: false,
				})
				yield* locator.initialize().pipe(Effect.provide(configuration({})))
				expect(locator.getCachedPath()).toBeUndefined()
				expect(yield* TestConsole.errorLines).toEqual([
					'[riptide-daemon] ERROR: Could not locate missing-config-fixture-binary-84329 binary. Please ensure missing-config-fixture-binary-84329 is installed and accessible via PATH, or set BINARY_OVERRIDE environment variable.',
				])
				yield* fs.writeFileString(executable, '#!/bin/sh\nexit 0\n')
				yield* fs.chmod(executable, 0o755)
				expect(
					yield* locator.getPath().pipe(Effect.provide(configuration({ BINARY_OVERRIDE: executable }))),
				).toBe(executable)
				yield* Effect.sync(() => locator.resetCache())
				expect(locator.getCachedPath()).toBeUndefined()
				expect(
					yield* locator.getPath().pipe(Effect.provide(configuration({ BINARY_OVERRIDE: executable }))),
				).toBe(executable)
			}),
		).pipe(Effect.provide(platform)),
	)
})
