import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import * as BunServices from '@effect/platform-bun/BunServices'
import { describe, it } from '@effect/vitest'
import { Effect, FileSystem, Option } from 'effect'
import * as Path from 'effect/Path'
import { expect } from 'vitest'

import {
	ClaudeExecutableNotFoundError,
	locateClaudeExecutable,
} from '../../src/effects/services/claude-sessions/claude-session-environment'

function tempHomeDirectory() {
	return mkdtemp(join(tmpdir(), 'claude-locate-'))
}

describe('locateClaudeExecutable', () => {
	it.effect('does not fall back to PATH when the configured path is invalid', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem
				const homeDirectory = yield* fs.makeTempDirectoryScoped({ prefix: 'claude-locate-' })
				const path = yield* Path.Path
				const executable = path.join(homeDirectory, 'claude')
				yield* fs.writeFileString(executable, '#!/bin/sh\nexit 0\n')
				yield* fs.chmod(executable, 0o755)

				const result = yield* Effect.flip(
					locateClaudeExecutable({
						configuredPath: Option.some('/missing/configured/claude'),
						executableSearchPath: homeDirectory,
						homeDirectory,
					}),
				)

				expect(result).toBeInstanceOf(ClaudeExecutableNotFoundError)
				expect(result.message).toContain('/missing/configured/claude')
			}),
		).pipe(Effect.provide(BunServices.layer)),
	)

	it.effect('does not fall back to a well-known path when the configured path is invalid', () =>
		Effect.gen(function* () {
			const path = yield* Path.Path
			const homeDirectory = yield* Effect.promise(tempHomeDirectory)
			yield* Effect.promise(() => mkdir(path.join(homeDirectory, '.local', 'bin'), { recursive: true }))
			yield* Effect.promise(() => writeFile(path.join(homeDirectory, '.local', 'bin', 'claude'), '', 'utf8'))

			const result = yield* Effect.flip(
				locateClaudeExecutable({
					configuredPath: Option.some('/missing/configured/claude'),
					executableSearchPath: '',
					homeDirectory,
				}),
			)

			expect(result).toBeInstanceOf(ClaudeExecutableNotFoundError)
			expect(result.message).toContain('/missing/configured/claude')
		}).pipe(Effect.provide(BunServices.layer)),
	)

	it.effect('falls back to a well-known path when PATH search fails and no configured path is set', () =>
		Effect.gen(function* () {
			const path = yield* Path.Path
			const homeDirectory = yield* Effect.promise(tempHomeDirectory)
			const expectedPath = path.join(homeDirectory, '.local', 'bin', 'claude')
			yield* Effect.promise(() => mkdir(path.join(homeDirectory, '.local', 'bin'), { recursive: true }))
			yield* Effect.promise(() => writeFile(expectedPath, '', 'utf8'))

			const result = yield* locateClaudeExecutable({
				configuredPath: Option.none(),
				executableSearchPath: '',
				homeDirectory,
			})

			expect(result).toBe(expectedPath)
		}).pipe(Effect.provide(BunServices.layer)),
	)

	it.effect('reports not found when PATH search and well-known paths both fail', () =>
		Effect.gen(function* () {
			const homeDirectory = yield* Effect.promise(tempHomeDirectory)

			const result = yield* Effect.flip(
				locateClaudeExecutable({
					configuredPath: Option.none(),
					executableSearchPath: '',
					homeDirectory,
				}),
			)

			expect(result).toBeInstanceOf(ClaudeExecutableNotFoundError)
			expect(result.message).toContain('PATH')
		}).pipe(Effect.provide(BunServices.layer)),
	)
})
