import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import * as NodeServices from '@effect/platform-node/NodeServices'
import { describe, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import * as ConfigProvider from 'effect/ConfigProvider'

import { WorkspacePathResolverLive } from '@/effects/services/workspace-path-resolver/workspace-path-resolver.layer'
import { WorkspacePathResolver } from '@/effects/services/workspace-path-resolver/workspace-path-resolver.service'

const testConfigLayer = Layer.succeed(
	ConfigProvider.ConfigProvider,
	ConfigProvider.fromUnknown({ HOME: '/users/test' }),
)
const resolverLayer = WorkspacePathResolverLive.pipe(Layer.provide(NodeServices.layer), Layer.provide(testConfigLayer))

describe('WorkspacePathResolver', () => {
	it.effect('expands home-relative source and target paths', ({ expect }) =>
		Effect.gen(function* () {
			const resolver = yield* WorkspacePathResolver
			expect(
				yield* resolver.resolveSourceDirectory({
					directory: '~/projects/repo',
					localPath: '.',
				}),
			).toBe('/users/test/projects/repo')
			expect(yield* resolver.resolveTargetDirectory({ targetPath: '~/wt/task/repo' })).toBe(
				'/users/test/wt/task/repo',
			)
		}).pipe(Effect.provide(resolverLayer)),
	)

	it.effect('expands exact-home source and target paths', ({ expect }) =>
		Effect.gen(function* () {
			const resolver = yield* WorkspacePathResolver
			expect(yield* resolver.resolveSourceDirectory({ directory: '~', localPath: '.' })).toBe('/users/test')
			expect(yield* resolver.resolveTargetDirectory({ targetPath: '~' })).toBe('/users/test')
		}).pipe(Effect.provide(resolverLayer)),
	)

	it.effect('resolves sibling repositories from the selected directory', ({ expect }) =>
		Effect.gen(function* () {
			const resolver = yield* WorkspacePathResolver
			expect(yield* resolver.resolveSourceDirectory({ directory: '/projects/main', localPath: '.' })).toBe(
				'/projects/main',
			)
			expect(yield* resolver.resolveSourceDirectory({ directory: '/projects/main', localPath: '../api' })).toBe(
				'/projects/api',
			)
		}).pipe(Effect.provide(resolverLayer)),
	)

	it.effect('finds a single repository inside its selected parent folder', ({ expect }) => {
		const parentDirectory = join(tmpdir(), `workspace-path-resolver-${randomUUID()}`)
		return Effect.sync(() => mkdirSync(join(parentDirectory, 'syncopate', '.git'), { recursive: true })).pipe(
			Effect.andThen(
				Effect.gen(function* () {
					const resolver = yield* WorkspacePathResolver
					expect(
						yield* resolver.resolveSourceDirectory({
							directory: parentDirectory,
							localPath: '.',
							singleRepositoryName: 'syncopate',
						}),
					).toBe(join(parentDirectory, 'syncopate'))
				}),
			),
			Effect.ensuring(Effect.sync(() => rmSync(parentDirectory, { recursive: true, force: true }))),
			Effect.provide(resolverLayer),
		)
	})
})
