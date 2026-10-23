import * as NodeFileSystem from '@effect/platform-node/NodeFileSystem'
import * as NodePath from '@effect/platform-node/NodePath'
import { describe, expect, it } from '@effect/vitest'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'

import { parseVerifiedClaudePath } from '../src/daemon/verified-claude-path'

const platform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

describe('parseVerifiedClaudePath', () => {
	it.effect('resolves null when no path is selected', () =>
		Effect.gen(function* () {
			expect(yield* parseVerifiedClaudePath(null)).toBeNull()
			expect(yield* parseVerifiedClaudePath('')).toBeNull()
		}).pipe(Effect.provide(platform)),
	)

	it.effect('returns the path when it is absolute and exists', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const fileSystem = yield* FileSystem.FileSystem
				const directory = yield* fileSystem.makeTempDirectoryScoped()
				const claude = `${directory}/claude`
				yield* fileSystem.writeFileString(claude, 'fixture')

				expect(yield* parseVerifiedClaudePath(claude)).toBe(claude)
			}),
		).pipe(Effect.provide(platform)),
	)

	it.effect('fails when a present path is not absolute', () =>
		Effect.gen(function* () {
			const result = yield* Effect.exit(parseVerifiedClaudePath('claude'))
			expect(result._tag).toBe('Failure')
		}).pipe(Effect.provide(platform)),
	)

	it.effect('fails when an absolute path does not exist', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const fileSystem = yield* FileSystem.FileSystem
				const directory = yield* fileSystem.makeTempDirectoryScoped()

				const result = yield* Effect.exit(parseVerifiedClaudePath(`${directory}/missing-claude`))
				expect(result._tag).toBe('Failure')
			}),
		).pipe(Effect.provide(platform)),
	)
})
