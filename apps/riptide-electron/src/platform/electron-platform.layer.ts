import { homedir } from 'node:os'
import { basename, join } from 'node:path'

import * as ConfigProvider from 'effect/ConfigProvider'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Stream from 'effect/Stream'
import { app, BrowserWindow, MessageChannelMain, nativeTheme, screen, shell } from 'electron'

import { navigationPolicy, rendererPermissionPolicy } from '../window/window-security'
import { ElectronPlatformError } from './electron-platform.errors'
import { ElectronPlatform, type ElectronWindowOptions, type ElectronWindowState } from './electron-platform.service'
import { configuredWindowDragSupport, makeWindowDrag } from './window-drag'

function readWindowState(window: BrowserWindow): ElectronWindowState {
	const maximized = window.isMaximized()
	const bounds = maximized ? window.getNormalBounds() : window.getBounds()
	return { ...bounds, maximized }
}

function windowStateChanges(window: BrowserWindow): Stream.Stream<ElectronWindowState> {
	const listenerWrappers = new Map<(state: ElectronWindowState) => void, () => void>()
	const eventTarget: Stream.EventListener<ElectronWindowState> = {
		addEventListener: (_event, listener) => {
			const emit = () => listener(readWindowState(window))
			listenerWrappers.set(listener, emit)
			window.on('move', emit)
			window.on('resize', emit)
			window.on('maximize', emit)
			window.on('unmaximize', emit)
		},
		removeEventListener: (_event, listener) => {
			const emit = listenerWrappers.get(listener)
			if (emit === undefined) return
			listenerWrappers.delete(listener)
			window.off('move', emit)
			window.off('resize', emit)
			window.off('maximize', emit)
			window.off('unmaximize', emit)
		},
	}
	return Stream.fromEventListener(eventTarget, 'state-change', { bufferSize: 1 })
}

function openExternalBestEffort(url: string): void {
	void shell.openExternal(url).catch(() => undefined)
}

function openElectronWindow(options: ElectronWindowOptions, nativeConfig: ConfigProvider.ConfigProvider) {
	return Effect.tryPromise({
		try: async () => {
			const window = new BrowserWindow({
				width: options.width,
				height: options.height,
				x: options.x,
				y: options.y,
				minWidth: options.minWidth,
				minHeight: options.minHeight,
				show: false,
				titleBarStyle: 'hiddenInset',
				trafficLightPosition: { x: 16, y: 15 },
				// Linux/Windows draw the application menu inside the window; macOS puts it
				// in the system menu bar. Hide it there — Alt still reveals it, and menu
				// accelerators keep working.
				autoHideMenuBar: true,
				webPreferences: {
					preload: options.preloadPath,
					...options.webPreferences,
				},
			})
			window.webContents.on('will-navigate', (event, url) => {
				const policy = navigationPolicy(url, options.rendererUrl)
				if (policy === 'allow') return
				event.preventDefault()
				if (policy === 'external') openExternalBestEffort(url)
			})
			window.webContents.setWindowOpenHandler(({ url }) => {
				if (navigationPolicy(url, options.rendererUrl) === 'external') openExternalBestEffort(url)
				return { action: 'deny' }
			})
			window.webContents.on('will-attach-webview', (event) => event.preventDefault())
			window.webContents.session.setPermissionRequestHandler((webContents, permission, callback, details) =>
				callback(
					rendererPermissionPolicy(permission, webContents.getURL(), options.rendererUrl) &&
						rendererPermissionPolicy(permission, details.requestingUrl, options.rendererUrl),
				),
			)
			window.webContents.session.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
				if (webContents === null) return false
				return (
					rendererPermissionPolicy(permission, webContents.getURL(), options.rendererUrl) &&
					rendererPermissionPolicy(permission, requestingOrigin, options.rendererUrl)
				)
			})

			window.once('ready-to-show', () => {
				if (options.maximized) window.maximize()
				window.show()
			})
			await window.loadURL(options.rendererUrl)
			if (options.openDevTools) window.webContents.openDevTools({ mode: 'detach' })
			return window
		},
		catch: (cause) => new ElectronPlatformError({ operation: 'open_window', cause }),
	}).pipe(
		Effect.flatMap((window) =>
			Effect.gen(function* () {
				const ozonePlatform = yield* Effect.try({
					try: () => app.commandLine.getSwitchValue('ozone-platform'),
					catch: (cause) => new ElectronPlatformError({ operation: 'open_window', cause }),
				})
				const supported = yield* configuredWindowDragSupport({
					platform: process.platform,
					ozonePlatform,
				})
					.parse(nativeConfig)
					.pipe(Effect.withSpan('electron_platform.window_drag_support'))
				return yield* Effect.try({
					try: () => ({
						id: window.id,
						dragWindow: makeWindowDrag({
							window,
							screen,
							supported,
						}),
						setThemeSource: (theme: 'light' | 'dark') =>
							Effect.try({
								try: () => {
									nativeTheme.themeSource = theme
								},
								catch: (cause) => new ElectronPlatformError({ operation: 'set_window_theme', cause }),
							}).pipe(Effect.withSpan('electron_platform.set_window_theme')),
						setZoomFactor: (zoomFactor: number) =>
							Effect.try({
								try: () => window.webContents.setZoomFactor(zoomFactor),
								catch: (cause) => new ElectronPlatformError({ operation: 'set_zoom', cause }),
							}).pipe(Effect.withSpan('electron_platform.set_zoom')),
						stateChanges: windowStateChanges(window),
						showAndFocus: Effect.try({
							try: () => {
								if (window.isMinimized()) window.restore()
								window.show()
								window.focus()
							},
							catch: (cause) => new ElectronPlatformError({ operation: 'show_and_focus_window', cause }),
						}).pipe(Effect.withSpan('electron_platform.show_and_focus_window')),
						createMessageChannel: () => new MessageChannelMain(),
						postMessage: (channel: string, port: Electron.MessagePortMain) =>
							window.webContents.postMessage(channel, undefined, [port]),
						onRendererReady: (listener: () => void) => {
							window.webContents.on('did-finish-load', listener)
							return () => window.webContents.off('did-finish-load', listener)
						},
						onClosed: (listener: () => void) => {
							window.on('closed', listener)
							return () => window.off('closed', listener)
						},
						destroy: Effect.try({
							try: () => {
								if (!window.isDestroyed()) window.destroy()
							},
							catch: (cause) => new ElectronPlatformError({ operation: 'destroy_window', cause }),
						}).pipe(Effect.withSpan('electron_platform.destroy_window')),
					}),
					catch: (cause) => new ElectronPlatformError({ operation: 'open_window', cause }),
				})
			}).pipe(
				Effect.catchTag('ConfigError', (cause) =>
					Effect.fail(new ElectronPlatformError({ operation: 'open_window', cause })),
				),
				Effect.onError(() =>
					Effect.sync(() => {
						if (!window.isDestroyed()) window.destroy()
					}),
				),
			),
		),
		Effect.withSpan('electron_platform.open_window'),
	)
}

export const ElectronPlatformLive = Layer.effect(
	ElectronPlatform,
	Effect.gen(function* () {
		const nativeConfig = yield* ConfigProvider.ConfigProvider
		return ElectronPlatform.of({
			productName: app.isPackaged ? basename(process.execPath) : app.getName(),
			version: app.getVersion(),
			isPackaged: app.isPackaged,
			resourcesPath: process.resourcesPath,
			preloadPath: join(__dirname, 'preload.cjs'),
			homeDirectory: homedir(),
			userDataPath: app.getPath('userData'),
			configureBeforeReady: ({ remoteDebuggingPort }) =>
				Effect.try({
					try: () => {
						if (remoteDebuggingPort !== undefined) {
							app.commandLine.appendSwitch('remote-debugging-port', String(remoteDebuggingPort))
						}
					},
					catch: (cause) => new ElectronPlatformError({ operation: 'configure_before_ready', cause }),
				}).pipe(Effect.withSpan('electron_platform.configure_before_ready')),
			whenReady: Effect.tryPromise({
				try: () => app.whenReady().then(() => undefined),
				catch: (cause) => new ElectronPlatformError({ operation: 'wait_until_ready', cause }),
			}).pipe(Effect.withSpan('electron_platform.wait_until_ready')),
			requestSingleInstanceLock: Effect.try({
				try: () => app.requestSingleInstanceLock(),
				catch: (cause) => new ElectronPlatformError({ operation: 'request_single_instance_lock', cause }),
			}).pipe(Effect.withSpan('electron_platform.request_single_instance_lock')),
			secondInstanceEvents: Stream.fromEventListener(
				{
					addEventListener: (_event, listener) => app.on('second-instance', listener),
					removeEventListener: (_event, listener) => app.off('second-instance', listener),
				},
				'second-instance',
			).pipe(Stream.map(() => undefined)),
			quit: Effect.try({
				try: () => app.quit(),
				catch: (cause) => new ElectronPlatformError({ operation: 'quit_application', cause }),
			}).pipe(Effect.withSpan('electron_platform.quit')),
			resolveWindowState: ({ persistedState, defaultWidth, defaultHeight }) =>
				Effect.try({
					try: () => {
						const displays = screen.getAllDisplays()
						if (persistedState !== undefined) {
							const visible = displays.some(({ workArea }) => {
								const overlapWidth =
									Math.min(persistedState.x + persistedState.width, workArea.x + workArea.width) -
									Math.max(persistedState.x, workArea.x)
								const overlapHeight =
									Math.min(persistedState.y + persistedState.height, workArea.y + workArea.height) -
									Math.max(persistedState.y, workArea.y)
								return overlapWidth >= 100 && overlapHeight >= 100
							})
							if (visible) return persistedState
						}

						const workArea = screen.getPrimaryDisplay().workArea
						const width = Math.min(defaultWidth, workArea.width)
						const height = Math.min(defaultHeight, workArea.height)
						return {
							width,
							height,
							x: workArea.x + Math.floor((workArea.width - width) / 2),
							y: workArea.y + Math.floor((workArea.height - height) / 2),
							maximized: false,
						}
					},
					catch: (cause) => new ElectronPlatformError({ operation: 'resolve_window_state', cause }),
				}).pipe(Effect.withSpan('electron_platform.resolve_window_state')),
			setApplicationIcon: (iconPath) =>
				Effect.try({
					try: () => {
						if (iconPath) app.dock?.setIcon(iconPath)
					},
					catch: (cause) => new ElectronPlatformError({ operation: 'set_application_icon', cause }),
				}).pipe(Effect.withSpan('electron_platform.set_application_icon')),
			openWindow: (options) => openElectronWindow(options, nativeConfig),
		})
	}),
)
