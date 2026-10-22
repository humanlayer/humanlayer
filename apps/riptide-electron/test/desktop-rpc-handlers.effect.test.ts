import * as NodePath from '@effect/platform-node/NodePath'
import * as NodeServices from '@effect/platform-node/NodeServices'
import { describe, expect, it } from '@effect/vitest'
import {
	DesktopRpc,
	type Editor,
	ExternalUrlNotAllowedError,
	ExternalUrlOpenError,
	HostIdPersistenceError,
	WindowThemeSetError,
} from '@humanlayer/riptide-electron-rpc'
import * as Crypto from 'effect/Crypto'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as PlatformError from 'effect/PlatformError'
import * as RpcTest from 'effect/rpc/RpcTest'
import * as Stream from 'effect/Stream'

import type { ElectronConfig } from '../src/config/electron-config'
import { DaemonSupervisor } from '../src/daemon/daemon-supervisor.service'
import { ClaudeCodeCli } from '../src/diagnostics/claude-code-cli.service'
import { HumanLayerCli } from '../src/diagnostics/humanlayer-cli.service'
import { DirectoryPicker } from '../src/directory-picker/directory-picker.service'
import { EditorService } from '../src/editor/editor-service'
import { HostIdService } from '../src/host/host-id-service'
import { makeHostIdServiceLive } from '../src/host/host-id-service.layer'
import { HostLogService } from '../src/logging/host-log-service'
import { ElectronPlatform } from '../src/platform/electron-platform.service'
import { InheritedEnvironment } from '../src/platform/inherited-environment'
import { DesktopRpcHandlers } from '../src/rpc/desktop-rpc-handlers'
import { ElectronShell, ElectronShellFailure } from '../src/shell/electron-shell.service'
import { ElectronUpdaterService } from '../src/updater/electron-updater.service'
import { WindowService, type WindowServiceShape } from '../src/window/window-service'
import { WindowThemeError } from '../src/window/window.errors'
import { deepLinkServiceTestLayer } from './deep-link-service.test-layer'
import { ptyServiceTestLayer } from './pty-service.test-layer'
import { workspaceFilesystemServicesTestLayer } from './workspace-filesystem-services.test-layer'

const persistedHostId = '01c33ef3-1aa9-4740-89fc-407118590020'
const pickedDirectory = '/Users/test/projects/example'
const electronPlatform = Layer.succeed(
	ElectronPlatform,
	ElectronPlatform.of({
		productName: 'HumanLayer-Test Electron',
		version: '1.2.3',
		isPackaged: false,
		resourcesPath: '/resources',
		preloadPath: '/preload.cjs',
		homeDirectory: '/Users/test',
		userDataPath: '/test/profile',
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
	}),
)
const config: ElectronConfig = {
	channel: 'local',
	isPackaged: false,
	userDataPath: '/test/profile',
	homeDirectory: '/test/home',
	devstackId: undefined,
	rendererUrl: new URL('http://localhost:3000'),
	applicationIconPath: undefined,
	remoteDebuggingPort: 9222,
	cdpEnabled: false,
	openDevTools: false,
	logPath: '/test/electron.log',
	daemonMode: 'external',
	protocolSchemes: ['humanlayer-electron-local'],
}
const hostLogService = Layer.succeed(
	HostLogService,
	HostLogService.of({
		writeHostLog: () => Effect.void,
		getLogDirectory: Effect.succeed('/test/logs'),
		getCurrentLogFiles: Effect.succeed([]),
	}),
)
const diagnosticsServices = Layer.mergeAll(
	Layer.succeed(HumanLayerCli, HumanLayerCli.of({ updateToLatest: Effect.void })),
	Layer.succeed(
		ClaudeCodeCli,
		ClaudeCodeCli.of({
			checkInstallation: Effect.die('checkInstallation was not expected'),
			updateToLatest: Effect.die('updateToLatest was not expected'),
			probeAgent: () => Effect.die('probeAgent was not expected'),
		}),
	),
)
const daemonService = Layer.succeed(
	DaemonSupervisor,
	DaemonSupervisor.of({
		start: () => Effect.die('start daemon was not expected'),
		stop: () => Effect.die('stop daemon was not expected'),
		isRunning: () => Effect.succeed(false),
		setManagementEnabled: () => Effect.die('daemon management was not expected'),
		lifecycleEvents: Stream.empty,
	}),
)
const updaterService = Layer.succeed(
	ElectronUpdaterService,
	ElectronUpdaterService.of({
		checkForAppUpdate: () => Effect.succeed(null),
		downloadAvailableUpdate: () => Effect.void,
		downloadProgress: Stream.empty,
		quitAndInstallUpdate: () => Effect.die('quitAndInstall was not expected'),
	}),
)
const statefulDomainServices = Layer.mergeAll(
	Layer.succeed(InheritedEnvironment, { snapshot: Effect.die('Native environment was not expected') }),
	daemonService,
	ptyServiceTestLayer,
	workspaceFilesystemServicesTestLayer,
	deepLinkServiceTestLayer,
	updaterService,
	NodeServices.layer,
	Layer.succeed(DirectoryPicker, DirectoryPicker.of({ pickDirectory: Effect.succeed(pickedDirectory) })),
)
const windowService = (setWindowTheme: WindowServiceShape['setWindowTheme'] = () => Effect.void) =>
	Layer.succeed(
		WindowService,
		WindowService.of({
			openMainWindow: Effect.die('openMainWindow was not expected'),
			openNewWindow: Effect.die('openNewWindow was not expected'),
			openedWindows: Stream.empty,
			setWindowTheme,
			setZoom: () => Effect.void,
		}),
	)

const hostIdDependencies = (fileSystem: Layer.Layer<FileSystem.FileSystem>) =>
	Layer.mergeAll(
		fileSystem,
		NodePath.layer,
		Layer.succeed(
			Crypto.Crypto,
			Crypto.make({
				randomBytes: (size) => new Uint8Array(size),
				digest: (_algorithm, data) => Effect.succeed(data),
			}),
		),
	)

describe('DesktopRpcHandlers', () => {
	it.effect('routes typed RPC calls through the real handler layer', () => {
		const editorCalls: Array<{ readonly path: string; readonly editor: Editor | null }> = []
		const diagnosticCalls: string[] = []
		const hostId = makeHostIdServiceLive(config).pipe(
			Layer.provide(
				hostIdDependencies(
					FileSystem.layerNoop({ readFileString: () => Effect.succeed(`${persistedHostId}\n`) }),
				),
			),
		)
		const dependencies = Layer.mergeAll(
			Layer.succeed(
				HumanLayerCli,
				HumanLayerCli.of({ updateToLatest: Effect.sync(() => diagnosticCalls.push('update-cli')) }),
			),
			Layer.succeed(
				ClaudeCodeCli,
				ClaudeCodeCli.of({
					checkInstallation: Effect.sync(() => {
						diagnosticCalls.push('check-claude')
						return {
							path: '/Users/test/.local/bin/claude',
							version: '2.1.177',
							installationSource: 'native',
							isRecommendedPath: true,
							isVersionSupported: true,
						}
					}),
					updateToLatest: Effect.sync(() => diagnosticCalls.push('update-claude')),
					probeAgent: (input) =>
						Effect.sync(() => {
							diagnosticCalls.push(`probe-${input.agent}`)
							return {
								status: 'ready' as const,
								agent: input.agent,
								path: input.preferredPath ?? `/Users/test/.local/bin/${input.agent}`,
								version: '1.0.0',
								installationSource: 'native',
								checkedAt: 42,
							}
						}),
				}),
			),
			hostLogService,
			electronPlatform,
			windowService(),
			hostId,
			Layer.succeed(ElectronShell, ElectronShell.of({ openExternal: () => Effect.void })),
			Layer.succeed(
				EditorService,
				EditorService.of({
					open: (input) =>
						Effect.sync(() => {
							editorCalls.push(input)
						}),
				}),
			),
		)
		const handlers = DesktopRpcHandlers.pipe(Layer.provide(Layer.mergeAll(dependencies, statefulDomainServices)))

		return Effect.gen(function* () {
			const client = yield* RpcTest.makeClient(DesktopRpc.omit('DragWindow'))

			const hostId = yield* client.GetHostId()
			const appVersion = yield* client.GetAppVersion()
			const file = yield* client.ReadFile({ path: '/test/file.txt' })
			yield* client.OpenInEditor({ path: '/test/worktree', editor: 'cursor' })
			yield* client.UpdateCli()
			const claudeDiagnostic = yield* client.CheckClaudeInstalled()
			const codexProbe = yield* client.ProbeCodingAgent({ agent: 'codex', preferredPath: null })
			const directory = yield* client.PickDirectory()
			yield* client.UpdateClaudeCode()

			expect(hostId).toBe(persistedHostId)
			expect(appVersion).toBe('1.2.3')
			expect(file).toEqual(new Uint8Array())
			expect(editorCalls).toEqual([{ path: '/test/worktree', editor: 'cursor' }])
			expect(claudeDiagnostic.path).toBe('/Users/test/.local/bin/claude')
			expect(codexProbe).toMatchObject({ status: 'ready', agent: 'codex' })
			expect(directory).toBe(pickedDirectory)
			expect(diagnosticCalls).toEqual(['update-cli', 'check-claude', 'probe-codex', 'update-claude'])
		}).pipe(Effect.provide(handlers))
	})

	it.effect('preserves typed Host ID persistence failures across RPC', () => {
		const persistenceFailure = PlatformError.systemError({
			_tag: 'PermissionDenied',
			module: 'FileSystem',
			method: 'readFileString',
			pathOrDescriptor: '/test/profile/host_id',
			description: 'denied by test filesystem',
		})
		const hostId = makeHostIdServiceLive(config).pipe(
			Layer.provide(
				hostIdDependencies(FileSystem.layerNoop({ readFileString: () => Effect.fail(persistenceFailure) })),
			),
		)
		const dependencies = Layer.mergeAll(
			diagnosticsServices,
			hostLogService,
			electronPlatform,
			windowService(),
			hostId,
			Layer.succeed(ElectronShell, ElectronShell.of({ openExternal: () => Effect.void })),
			Layer.succeed(EditorService, EditorService.of({ open: () => Effect.void })),
		)
		const handlers = DesktopRpcHandlers.pipe(Layer.provide(Layer.mergeAll(dependencies, statefulDomainServices)))

		return Effect.gen(function* () {
			const client = yield* RpcTest.makeClient(DesktopRpc.omit('DragWindow'))
			const error = yield* Effect.flip(client.GetHostId())

			expect(error).toStrictEqual(new HostIdPersistenceError({ message: persistenceFailure.message }))
		}).pipe(Effect.provide(handlers))
	})

	it.effect('allowlists web URLs and maps rich shell failures', () => {
		const opened: string[] = []
		const shell = Layer.succeed(
			ElectronShell,
			ElectronShell.of({
				openExternal: ({ url }) =>
					url.includes('failure')
						? Effect.fail(
								new ElectronShellFailure({
									cause: new Error('native details'),
									message: 'open failed',
								}),
							)
						: Effect.sync(() => opened.push(url)),
			}),
		)
		const dependencies = Layer.mergeAll(
			diagnosticsServices,
			hostLogService,
			electronPlatform,
			windowService(),
			Layer.succeed(EditorService, EditorService.of({ open: () => Effect.void })),
			Layer.succeed(HostIdService, HostIdService.of({ get: Effect.succeed(persistedHostId) })),
			shell,
		)

		return Effect.gen(function* () {
			const client = yield* RpcTest.makeClient(DesktopRpc.omit('DragWindow'))
			yield* client.OpenExternalUrl({ url: 'https://example.com/path' })
			const blocked = yield* Effect.flip(client.OpenExternalUrl({ url: 'file:///private/data' }))
			const failed = yield* Effect.flip(client.OpenExternalUrl({ url: 'https://failure.example' }))

			expect(opened).toEqual(['https://example.com/path'])
			expect(blocked).toBeInstanceOf(ExternalUrlNotAllowedError)
			expect(failed).toStrictEqual(new ExternalUrlOpenError({ message: 'open failed' }))
		}).pipe(
			Effect.provide(
				DesktopRpcHandlers.pipe(Layer.provide(Layer.mergeAll(dependencies, statefulDomainServices))),
			),
		)
	})

	it.effect('sets the window theme and narrows rich service failures', () => {
		const themes: Array<'light' | 'dark'> = []
		const dependencies = Layer.mergeAll(
			diagnosticsServices,
			hostLogService,
			electronPlatform,
			Layer.succeed(EditorService, EditorService.of({ open: () => Effect.void })),
			Layer.succeed(HostIdService, HostIdService.of({ get: Effect.succeed(persistedHostId) })),
			Layer.succeed(ElectronShell, ElectronShell.of({ openExternal: () => Effect.void })),
			windowService(({ theme }) =>
				theme === 'dark'
					? Effect.fail(new WindowThemeError({ cause: new Error('native details') }))
					: Effect.sync(() => themes.push(theme)),
			),
		)

		return Effect.gen(function* () {
			const client = yield* RpcTest.makeClient(DesktopRpc.omit('DragWindow'))
			yield* client.SetWindowTheme({ theme: 'light' })
			const failure = yield* Effect.flip(client.SetWindowTheme({ theme: 'dark' }))

			expect(themes).toEqual(['light'])
			expect(failure).toStrictEqual(new WindowThemeSetError({ message: 'Failed to set window theme' }))
		}).pipe(
			Effect.provide(
				DesktopRpcHandlers.pipe(Layer.provide(Layer.mergeAll(dependencies, statefulDomainServices))),
			),
		)
	})

	it.effect('sets zoom and delegates host logging operations', () => {
		const zoomFactors: number[] = []
		const rendererLogs: Array<{ readonly level: 'info'; readonly message: string }> = []
		const dependencies = Layer.mergeAll(
			diagnosticsServices,
			electronPlatform,
			Layer.succeed(EditorService, EditorService.of({ open: () => Effect.void })),
			Layer.succeed(HostIdService, HostIdService.of({ get: Effect.succeed(persistedHostId) })),
			Layer.succeed(ElectronShell, ElectronShell.of({ openExternal: () => Effect.void })),
			Layer.succeed(
				HostLogService,
				HostLogService.of({
					writeHostLog: (input) =>
						Effect.sync(() => rendererLogs.push({ level: 'info', message: input.message })),
					getLogDirectory: Effect.succeed('/test/logs'),
					getCurrentLogFiles: Effect.succeed(['electron-local.log']),
				}),
			),
			Layer.succeed(
				WindowService,
				WindowService.of({
					openMainWindow: Effect.die('openMainWindow was not expected'),
					openNewWindow: Effect.die('openNewWindow was not expected'),
					openedWindows: Stream.empty,
					setWindowTheme: () => Effect.void,
					setZoom: ({ zoomFactor }) => Effect.sync(() => zoomFactors.push(zoomFactor)),
				}),
			),
		)

		return Effect.gen(function* () {
			const client = yield* RpcTest.makeClient(DesktopRpc.omit('DragWindow'))
			yield* client.SetZoom({ zoomFactor: 1.25 })
			yield* client.WriteHostLog({ level: 'info', message: 'renderer ready' })

			expect(yield* client.GetLogDirectory()).toBe('/test/logs')
			expect(yield* client.GetCurrentLogFiles()).toEqual(['electron-local.log'])
			expect(zoomFactors).toEqual([1.25])
			expect(rendererLogs).toEqual([{ level: 'info', message: 'renderer ready' }])
		}).pipe(
			Effect.provide(
				DesktopRpcHandlers.pipe(Layer.provide(Layer.mergeAll(dependencies, statefulDomainServices))),
			),
		)
	})
})
