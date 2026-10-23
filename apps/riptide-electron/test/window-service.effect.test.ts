import * as NodeFileSystem from '@effect/platform-node/NodeFileSystem'
import * as NodePath from '@effect/platform-node/NodePath'
import { describe, expect, it } from '@effect/vitest'
import * as ConfigProvider from 'effect/ConfigProvider'
import * as DateTime from 'effect/DateTime'
import * as Deferred from 'effect/Deferred'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Path from 'effect/Path'
import * as Queue from 'effect/Queue'
import * as Stream from 'effect/Stream'
import { TestClock } from 'effect/testing'
import { vi } from 'vitest'

import { protocolSchemesByChannel } from '../src/config/electron-channel'
import { channelFromProductName, loadElectronConfig, type ElectronConfig } from '../src/config/electron-config'
import { makeEffectLoggerLive } from '../src/logging/effect-logger'
import { ElectronPlatform } from '../src/platform/electron-platform.service'
import { WindowService } from '../src/window/window-service'
import { makeWindowServiceLive } from '../src/window/window-service.layer'

const fakePlatform = (overrides?: Partial<typeof ElectronPlatform.Service>) =>
	Layer.succeed(
		ElectronPlatform,
		ElectronPlatform.of({
			productName: 'HumanLayerElectronDev',
			version: '0.1.0',
			isPackaged: false,
			resourcesPath: '/resources',
			preloadPath: '/app/preload.cjs',
			homeDirectory: '/Users/test',
			userDataPath: '/tmp/electron-profile',
			configureBeforeReady: () => Effect.void,
			whenReady: Effect.void,
			requestSingleInstanceLock: Effect.succeed(true),
			secondInstanceEvents: Stream.empty,
			quit: Effect.void,
			resolveWindowState: ({ persistedState, defaultWidth, defaultHeight }) =>
				Effect.succeed(
					persistedState ?? { width: defaultWidth, height: defaultHeight, x: 0, y: 0, maximized: false },
				),
			setApplicationIcon: () => Effect.void,
			openWindow: () => Effect.die('openWindow was not expected'),
			...overrides,
		}),
	)

describe('Electron configuration', () => {
	it('derives channel identity from packaged product names', () => {
		expect(channelFromProductName('HumanLayerElectronLocal')).toBe('local')
		expect(channelFromProductName('HumanLayerElectronDev')).toBe('dev')
		expect(channelFromProductName('HumanLayerElectronBeta')).toBe('beta')
		expect(channelFromProductName('HumanLayerElectron')).toBe('prod')
	})

	it('uses Electron-only protocol schemes for every channel', () => {
		expect(protocolSchemesByChannel).toEqual({
			local: ['humanlayer-electron-local'],
			dev: ['humanlayer-electron-dev'],
			beta: ['humanlayer-electron-beta'],
			prod: ['humanlayer-electron'],
		})
	})

	it.effect('loads environment overrides through Effect Config', () =>
		Effect.gen(function* () {
			yield* TestClock.setTime(DateTime.toEpochMillis(DateTime.makeUnsafe('2026-07-13T20:10:09.123Z')))
			yield* Effect.gen(function* () {
				const config = yield* loadElectronConfig

				expect(config.channel).toBe('beta')
				expect(config.userDataPath).toBe('/tmp/electron-profile')
				expect(config.rendererUrl.toString()).toBe('https://renderer.example.test/')
				expect(config.applicationIconPath).toBe('/tmp/devstack-icon.png')
				expect(config.remoteDebuggingPort).toBe(9333)
				expect(config.cdpEnabled).toBe(false)
				expect(config.openDevTools).toBe(true)
				expect(config.logPath).toBe(
					'/Users/test/.humanlayer/electrondata/beta/logs/electron-beta-2026-07-13T20-10-09-123Z.log',
				)
			}).pipe(
				Effect.provide(fakePlatform()),
				Effect.provide(NodePath.layer),
				Effect.provide(
					ConfigProvider.layer(
						ConfigProvider.fromUnknown({
							ELECTRON_CHANNEL: 'beta',
							RIPTIDE_ELECTRON_RENDERER_URL: 'https://renderer.example.test',
							DEVSTACK_NATIVE_ICON: '/tmp/devstack-icon.png',
							RIPTIDE_ELECTRON_DISABLE_CDP: true,
							RIPTIDE_ELECTRON_CDP_PORT: 9333,
						}),
					),
				),
			)
		}),
	)

	it.effect('uses the packaged product channel instead of an inherited environment channel', () =>
		Effect.gen(function* () {
			const config = yield* loadElectronConfig

			expect(config.channel).toBe('dev')
			expect(config.protocolSchemes).toEqual(['humanlayer-electron-dev'])
		}).pipe(
			Effect.provide(fakePlatform({ productName: 'HumanLayerElectronDev', isPackaged: true })),
			Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ ELECTRON_CHANNEL: 'local' }))),
			Effect.provide(NodePath.layer),
		),
	)
})

describe('WindowService', () => {
	it.effect('opens the renderer with secure preferences and finalizes the window', () =>
		Effect.gen(function* () {
			const secondInstanceEvents = yield* Queue.unbounded<void>()
			const focused = yield* Deferred.make<void>()
			const opened: Array<Parameters<typeof ElectronPlatform.Service.openWindow>[0]> = []
			const themes: Array<'light' | 'dark'> = []
			const zoomFactors: number[] = []
			const writtenFiles: Array<{ readonly path: string; readonly contents: string }> = []
			const renames: Array<{ readonly from: string; readonly to: string }> = []
			let destroyed = 0
			let nextWindowId = 1
			let closeMainWindow: (() => void) | undefined
			const platform = fakePlatform({
				secondInstanceEvents: Stream.fromQueue(secondInstanceEvents),
				openWindow: (options) =>
					Effect.sync(() => {
						opened.push(options)
						return {
							id: nextWindowId++,
							dragWindow: Effect.die('dragWindow was not expected'),
							setThemeSource: (theme) => Effect.sync(() => themes.push(theme)),
							setZoomFactor: (zoomFactor) => Effect.sync(() => zoomFactors.push(zoomFactor)),
							stateChanges: Stream.empty,
							showAndFocus: Deferred.succeed(focused, undefined).pipe(Effect.asVoid),
							destroy: Effect.sync(() => destroyed++),
							postMessage: () => undefined,
							onRendererReady: () => () => undefined,
							onClosed: (callback) => {
								closeMainWindow = callback
								return () => undefined
							},
						}
					}),
			})
			const config: ElectronConfig = {
				channel: 'dev',
				isPackaged: false,
				userDataPath: '/tmp/profile',
				homeDirectory: '/tmp/home',
				devstackId: undefined,
				rendererUrl: new URL('http://localhost:3000'),
				applicationIconPath: undefined,
				remoteDebuggingPort: 9222,
				cdpEnabled: true,
				openDevTools: true,
				logPath: '/tmp/electron.log',
				daemonMode: 'external',
				protocolSchemes: protocolSchemesByChannel.dev,
			}
			const layer = makeWindowServiceLive(config).pipe(Layer.provide(Layer.mergeAll(platform, NodePath.layer)))
			const fileSystem = FileSystem.layerNoop({
				readFileString: () =>
					Effect.succeed(JSON.stringify({ width: 1200, height: 760, x: 40, y: 60, maximized: true })),
				makeDirectory: () => Effect.void,
				writeFileString: (path, contents) => Effect.sync(() => writtenFiles.push({ path, contents })),
				rename: (from, to) => Effect.sync(() => renames.push({ from, to })),
			})

			const { additional, emittedWindowIds, result } = yield* Effect.gen(function* () {
				const service = yield* WindowService
				const [first, second] = yield* Effect.all([service.openMainWindow, service.openMainWindow], {
					concurrency: 'unbounded',
				})
				yield* service.setWindowTheme({ theme: 'dark' })
				yield* service.setZoom({ zoomFactor: 1.5 })
				yield* Queue.offer(secondInstanceEvents, undefined)
				yield* Deferred.await(focused)
				expect(second).toBe(first)
				closeMainWindow?.()
				const reopened = yield* service.openMainWindow
				const additional = yield* service.openNewWindow
				expect(reopened).not.toBe(first)
				const emitted = yield* service.openedWindows.pipe(Stream.take(2), Stream.runCollect)
				return { additional, emittedWindowIds: emitted.map((handle) => handle.id), result: reopened }
			}).pipe(Effect.provide(layer), Effect.provide(fileSystem))

			expect(result.rendererUrl).toBe('http://localhost:3000/')
			expect(result.security).toEqual({ sandbox: true, contextIsolation: true, nodeIntegration: false })
			expect(emittedWindowIds).toEqual([1, 2])
			expect(additional.rendererUrl).toBe('http://localhost:3000/')
			expect(opened).toHaveLength(3)
			expect(opened[0]).toEqual({
				width: 1200,
				height: 760,
				x: 40,
				y: 60,
				maximized: true,
				minWidth: 800,
				minHeight: 600,
				webPreferences: {
					sandbox: true,
					contextIsolation: true,
					nodeIntegration: false,
					additionalArguments: [
						'--riptide-renderer-url=http://localhost:3000/',
						'--riptide-daemon-mode=external',
						'--riptide-window-role=main',
					],
				},
				rendererUrl: 'http://localhost:3000/',
				preloadPath: '/app/preload.cjs',
				openDevTools: true,
			})
			expect(opened[1]).toEqual(opened[0])
			expect(opened[2]?.webPreferences.additionalArguments).toEqual([
				'--riptide-renderer-url=http://localhost:3000/',
				'--riptide-daemon-mode=external',
				'--riptide-window-role=additional',
			])
			expect(destroyed).toBe(2)
			expect(themes).toEqual(['dark'])
			expect(zoomFactors).toEqual([1.5])
			expect(writtenFiles).toEqual([
				{
					path: '/tmp/profile/window-state.json.tmp',
					contents: '{"width":1200,"height":760,"x":40,"y":60,"maximized":true}\n',
				},
			])
			expect(renames).toEqual([
				{ from: '/tmp/profile/window-state.json.tmp', to: '/tmp/profile/window-state.json' },
			])
		}),
	)
})

describe('Effect logger', () => {
	it.effect('writes structured Effect logs and flushes them on scope close', () =>
		Effect.gen(function* () {
			const fileSystem = yield* FileSystem.FileSystem
			const pathService = yield* Path.Path
			const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: 'riptide-electron-log-' })
			const path = pathService.join(directory, 'electron-test.log')
			const config: ElectronConfig = {
				channel: 'local',
				isPackaged: false,
				userDataPath: '/tmp/profile',
				homeDirectory: '/tmp/home',
				devstackId: undefined,
				rendererUrl: new URL('http://localhost:3000'),
				applicationIconPath: undefined,
				remoteDebuggingPort: 9222,
				cdpEnabled: true,
				openDevTools: true,
				logPath: path,
				daemonMode: 'external',
				protocolSchemes: protocolSchemesByChannel.local,
			}

			yield* Effect.logInfo('structured message').pipe(
				Effect.annotateLogs({ feature: 'shell' }),
				Effect.provide(makeEffectLoggerLive(config)),
				Effect.provide(NodeFileSystem.layer),
				Effect.provide(NodePath.layer),
			)

			const contents = yield* fileSystem.readFileString(path, 'utf8')
			expect(contents).toContain('structured message')
			expect(contents).toContain('shell')
		}).pipe(Effect.provide(NodeFileSystem.layer), Effect.provide(NodePath.layer), Effect.scoped),
	)

	it.effect('does not install a console logger in packaged builds', () =>
		Effect.gen(function* () {
			const fileSystem = yield* FileSystem.FileSystem
			const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: 'riptide-electron-log-' })
			const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined)
			const config: ElectronConfig = {
				channel: 'dev',
				isPackaged: true,
				userDataPath: '/tmp/profile',
				homeDirectory: '/tmp/home',
				devstackId: undefined,
				rendererUrl: new URL('http://localhost:3000'),
				applicationIconPath: undefined,
				remoteDebuggingPort: 9222,
				cdpEnabled: false,
				openDevTools: false,
				logPath: `${directory}/electron-dev.log`,
				daemonMode: 'packaged',
				protocolSchemes: protocolSchemesByChannel.dev,
			}

			yield* Effect.logInfo('packaged file-only log').pipe(
				Effect.provide(makeEffectLoggerLive(config)),
				Effect.provide(NodeFileSystem.layer),
				Effect.provide(NodePath.layer),
			)

			expect(consoleLog).not.toHaveBeenCalled()
			consoleLog.mockRestore()
		}).pipe(Effect.provide(NodeFileSystem.layer), Effect.scoped),
	)
})
