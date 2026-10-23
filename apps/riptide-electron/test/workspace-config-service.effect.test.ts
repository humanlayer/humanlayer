import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import * as NodeServices from '@effect/platform-node/NodeServices'
import { afterEach, describe, expect, it } from '@effect/vitest'
import * as Effect from 'effect/Effect'
import type * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import type * as Path from 'effect/Path'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import * as Stream from 'effect/Stream'

import { EditorService } from '../src/editor/editor-service'
import { ElectronPlatform } from '../src/platform/electron-platform.service'
import { RepositoryDiscoveryServiceLive } from '../src/repository-discovery/repository-discovery.layer'
import { WorkspaceConfigService } from '../src/workspace/workspace-config-service'
import { WorkspaceConfigServiceLive } from '../src/workspace/workspace-config-service.layer'

const temporaryDirectories: string[] = []

const dependencies = (homeDirectory: string, openedPaths: string[]) =>
	Layer.mergeAll(
		NodeServices.layer,
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
		),
		Layer.succeed(
			EditorService,
			EditorService.of({ open: ({ path }) => Effect.sync(() => openedPaths.push(path)) }),
		),
	)

const runWithWorkspace = <A, E>(
	homeDirectory: string,
	openedPaths: string[],
	effect: Effect.Effect<
		A,
		E,
		WorkspaceConfigService | FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner
	>,
) =>
	Effect.runPromise(
		effect.pipe(
			Effect.provide(WorkspaceConfigServiceLive.pipe(Layer.provide(RepositoryDiscoveryServiceLive))),
			Effect.provide(dependencies(homeDirectory, openedPaths)),
		),
	)

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('WorkspaceConfigService', () => {
	it('reads shared and local workspace configurations independently', async () => {
		const home = mkdtempSync(join(tmpdir(), 'riptide-electron-workspace-read-'))
		temporaryDirectories.push(home)
		const configDirectory = join(home, '.humanlayer')
		mkdirSync(configDirectory)
		writeFileSync(join(configDirectory, 'workspace.json'), '{"repos":[{"localPath":"."}]}')
		writeFileSync(join(configDirectory, 'workspace.local.json'), '{"disabled":true}')

		const result = await runWithWorkspace(
			home,
			[],
			Effect.gen(function* () {
				const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner
				yield* Effect.scoped(
					childProcessSpawner
						.spawn(ChildProcess.make('git', ['init', '-q', '-b', 'trunk'], { cwd: home }))
						.pipe(Effect.flatMap((handle) => handle.exitCode)),
				)
				const workspace = yield* WorkspaceConfigService
				return {
					shared: yield* workspace.read({ directory: home, target: 'repo' }),
					local: yield* workspace.read({ directory: home, target: 'local' }),
				}
			}),
		)

		expect(result).toEqual({
			shared: {
				content: '{"repos":[{"localPath":"."}]}',
				exists: true,
				isInsideGitRepository: true,
				selectedRepository: {
					path: home,
					name: home.split('/').at(-1),
					remotes: [],
					defaultRemote: undefined,
					defaultBranch: 'trunk',
					sourceRef: 'trunk',
				},
			},
			local: { content: '{"disabled":true}', exists: true },
		})
	})

	it('returns normal absence values when workspace configurations are missing', async () => {
		const home = mkdtempSync(join(tmpdir(), 'riptide-electron-workspace-missing-'))
		temporaryDirectories.push(home)

		const result = await runWithWorkspace(
			home,
			[],
			Effect.gen(function* () {
				const workspace = yield* WorkspaceConfigService
				return {
					shared: yield* workspace.read({ directory: home, target: 'repo' }),
					local: yield* workspace.read({ directory: home, target: 'local' }),
				}
			}),
		)

		expect(result).toEqual({
			shared: { content: null, exists: false, isInsideGitRepository: false },
			local: { content: null, exists: false },
		})
	})

	it('preserves inside-Git status for a selected repository subdirectory', async () => {
		const home = mkdtempSync(join(tmpdir(), 'riptide-electron-workspace-subdirectory-'))
		temporaryDirectories.push(home)
		const child = join(home, 'packages', 'web')
		mkdirSync(child, { recursive: true })

		const result = await runWithWorkspace(
			home,
			[],
			Effect.gen(function* () {
				const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner
				yield* Effect.scoped(
					childProcessSpawner
						.spawn(ChildProcess.make('git', ['init', '-q', '-b', 'main'], { cwd: home }))
						.pipe(Effect.flatMap((handle) => handle.exitCode)),
				)
				return yield* (yield* WorkspaceConfigService).read({ directory: child, target: 'repo' })
			}),
		)

		expect(result).toEqual({
			content: null,
			exists: false,
			isInsideGitRepository: true,
			selectedRepository: undefined,
		})
	})

	it('writes, reads, and ignores local workspace configuration idempotently', async () => {
		const home = mkdtempSync(join(tmpdir(), 'riptide-electron-workspace-'))
		temporaryDirectories.push(home)
		const openedPaths: string[] = []

		const result = await runWithWorkspace(
			home,
			openedPaths,
			Effect.gen(function* () {
				const workspace = yield* WorkspaceConfigService
				yield* workspace.write({ directory: '~', target: 'local', content: '{"disabled":true}' })
				yield* workspace.ensureIgnored('~')
				yield* workspace.ensureIgnored('~')
				return yield* workspace.read({ directory: '~', target: 'local' })
			}),
		)

		expect(result).toEqual({ content: '{"disabled":true}', exists: true })
		expect(readFileSync(join(home, '.gitignore'), 'utf8')).toBe('.humanlayer/workspace.local.json\n')
	})

	it('creates preview content before opening a missing config', async () => {
		const home = mkdtempSync(join(tmpdir(), 'riptide-electron-workspace-open-'))
		temporaryDirectories.push(home)
		const openedPaths: string[] = []
		const configPath = join(home, '.humanlayer', 'workspace.json')

		await runWithWorkspace(
			home,
			openedPaths,
			WorkspaceConfigService.use((workspace) =>
				workspace.open({ directory: '~', target: 'repo', previewContent: '{"repos":[]}' }),
			),
		)

		expect(existsSync(configPath)).toBe(true)
		expect(readFileSync(configPath, 'utf8')).toBe('{"repos":[]}')
		expect(openedPaths).toEqual([configPath])
	})
})
