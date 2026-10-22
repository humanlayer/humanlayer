import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import * as NodeServices from '@effect/platform-node/NodeServices'
import { afterEach, describe, expect, it } from '@effect/vitest'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Stream from 'effect/Stream'

import { FilesystemService } from '../src/filesystem/filesystem-service'
import { FilesystemServiceLive } from '../src/filesystem/filesystem-service.layer'
import { ElectronPlatform } from '../src/platform/electron-platform.service'

const temporaryDirectories: string[] = []

const platformLayer = (homeDirectory: string) =>
	Layer.succeed(
		ElectronPlatform,
		ElectronPlatform.of({
			productName: 'HumanLayer-Test Electron',
			version: '1.0.0',
			isPackaged: false,
			resourcesPath: '/resources',
			preloadPath: '/preload.cjs',
			homeDirectory,
			userDataPath: '/test/profile',
			configureBeforeReady: () => Effect.void,
			whenReady: Effect.void,
			requestSingleInstanceLock: Effect.succeed(true),
			secondInstanceEvents: Stream.empty,
			quit: Effect.void,
			resolveWindowState: ({ defaultWidth, defaultHeight }) =>
				Effect.succeed({ width: defaultWidth, height: defaultHeight, x: 0, y: 0, maximized: false }),
			setApplicationIcon: () => Effect.void,
			openWindow: () => Effect.die('openWindow was not expected'),
		}),
	)

const runWithFilesystem = <A, E>(homeDirectory: string, effect: Effect.Effect<A, E, FilesystemService>) =>
	Effect.runPromise(
		effect.pipe(
			Effect.provide(FilesystemServiceLive),
			Effect.provide(Layer.mergeAll(NodeServices.layer, platformLayer(homeDirectory))),
		),
	)

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('FilesystemService', () => {
	it('resolves home paths, stats entries, and browses directories', async () => {
		const home = mkdtempSync(join(tmpdir(), 'riptide-electron-filesystem-'))
		temporaryDirectories.push(home)
		mkdirSync(join(home, 'alpha'))
		mkdirSync(join(home, 'beta'))
		writeFileSync(join(home, 'file.txt'), 'content')

		const result = await runWithFilesystem(
			home,
			Effect.gen(function* () {
				const filesystem = yield* FilesystemService
				return {
					home: yield* filesystem.getHomeDirectory,
					stat: yield* filesystem.statPath('~/alpha'),
					file: yield* filesystem.readFile('~/file.txt'),
					directories: yield* filesystem.browseDirectories('~'),
				}
			}),
		)

		expect(result.home).toBe(home)
		expect(result.stat).toEqual({ exists: true, isDirectory: true, isFile: false })
		expect([...result.file]).toEqual([99, 111, 110, 116, 101, 110, 116])
		expect(result.directories.map((entry) => entry.name)).toEqual(['alpha', 'beta'])
	})

	it('bounds traversal and returns ranked fuzzy file matches', async () => {
		const home = mkdtempSync(join(tmpdir(), 'riptide-electron-search-'))
		temporaryDirectories.push(home)
		mkdirSync(join(home, 'src'))
		writeFileSync(join(home, 'src', 'workspace-service.ts'), 'content')
		writeFileSync(join(home, 'src', 'unrelated.ts'), 'content')

		const matches = await runWithFilesystem(
			home,
			FilesystemService.use((filesystem) =>
				filesystem.fuzzySearchFiles({ query: 'workspace', paths: [home], limit: 1 }),
			),
		)

		expect(matches).toHaveLength(1)
		expect(matches[0]?.display_path).toBe('src/workspace-service.ts')
	})
})
