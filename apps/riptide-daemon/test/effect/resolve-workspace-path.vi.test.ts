import { describe, it } from '@effect/vitest'
import { Effect, Layer, Path } from 'effect'
import * as ConfigProvider from 'effect/ConfigProvider'
import { expect } from 'vitest'

import { resolveWorkspacePath } from '@/effects/services/workspace-path-resolver/resolve-workspace-path'

const homeDirectory = '/users/workspace-owner'
const configProvider = Layer.succeed(ConfigProvider.ConfigProvider, ConfigProvider.fromUnknown({ HOME: homeDirectory }))
const testDependencies = Layer.mergeAll(Path.layer, configProvider)

describe('resolveWorkspacePath', () => {
	it.effect('expands home-relative paths before resolving them', () =>
		Effect.gen(function* () {
			const pathService = yield* Path.Path
			expect(yield* resolveWorkspacePath({ path: '~/projects/example' })).toBe(
				pathService.join(homeDirectory, 'projects/example'),
			)
		}).pipe(Effect.provide(testDependencies)),
	)

	it.effect('resolves ordinary relative paths from the current directory', () =>
		Effect.gen(function* () {
			const pathService = yield* Path.Path
			expect(yield* resolveWorkspacePath({ path: 'projects/example' })).toBe(
				pathService.resolve('projects/example'),
			)
		}).pipe(Effect.provide(testDependencies)),
	)
})
