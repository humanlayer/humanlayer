import './config/configure-user-data'
import './instrument'
import './deep-links/open-url-capture'
import { join } from 'node:path'

import * as Data from 'effect/Data'
import * as Effect from 'effect/Effect'
import { app, BrowserWindow, Menu, session } from 'electron'

import { applicationMenuTemplate } from './application-menu'
import { startupChannel } from './config/configure-user-data'
import { DeepLinkService } from './deep-links/deep-link-service'
import { Sentry } from './instrument'
import { ElectronPlatform } from './platform/electron-platform.service'
import { installPackagedRendererProtocol, registerPackagedRendererScheme } from './renderer-protocol'
import { rendererSchemeForChannel } from './renderer-protocol-config'
import { appRuntime } from './runtime/app-runtime'
import { WindowService } from './window/window-service'

registerPackagedRendererScheme(rendererSchemeForChannel(startupChannel))

const launchApplication = Effect.gen(function* () {
	const platform = yield* ElectronPlatform
	const windowService = yield* WindowService
	const deepLinks = yield* DeepLinkService

	const ownsSingleInstanceLock = yield* platform.requestSingleInstanceLock
	if (!ownsSingleInstanceLock) {
		yield* Effect.logInfo('Another Electron instance already owns this application profile')
		yield* platform.quit
		return
	}

	yield* platform.whenReady
	if (platform.isPackaged) {
		yield* Effect.sync(() =>
			installPackagedRendererProtocol(
				rendererSchemeForChannel(startupChannel),
				join(platform.resourcesPath, 'renderer'),
			),
		)
	}
	yield* deepLinks.enableWindowActivation
	yield* deepLinks.initializePackagedProtocolClients
	yield* Effect.sync(() => {
		Menu.setApplicationMenu(
			Menu.buildFromTemplate(
				applicationMenuTemplate({
					appName: app.name,
					isMac: process.platform === 'darwin',
					onNewWindow: () => {
						runBackground(
							'electron_new_window_menu',
							WindowService.use((service) => service.openNewWindow).pipe(Effect.asVoid),
						)
					},
					onCloseWindow: () => BrowserWindow.getFocusedWindow()?.close(),
				}),
			),
		)
	})
	const openedWindow = yield* windowService.openMainWindow
	yield* Effect.logInfo('Electron shell started').pipe(
		Effect.annotateLogs({ renderer_url: openedWindow.rendererUrl }),
	)
}).pipe(Effect.withSpan('electron_app.launch'))

let shutdownPromise: Promise<void> | undefined
let shutdownRequested = false

const captureFailure = (operation: string, error: unknown) =>
	Effect.logError(`${operation} failed`).pipe(
		Effect.annotateLogs({ error, operation }),
		Effect.andThen(Effect.sync(() => Sentry.captureException(error, { tags: { operation } }))),
	)

class ElectronStorageFlushError extends Data.TaggedError('ElectronStorageFlushError')<{
	readonly cause: unknown
}> {}

function runBackground<E>(operation: string, effect: Effect.Effect<void, E, WindowService>): void {
	void appRuntime
		.runPromise(effect.pipe(Effect.tapError((error) => captureFailure(operation, error))))
		.catch(() => undefined)
}

function shutdown(): Promise<void> {
	shutdownPromise ??= appRuntime.dispose()
	return shutdownPromise
}

app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') app.quit()
})
app.on('activate', () => {
	if (BrowserWindow.getAllWindows().length !== 0 || shutdownRequested) return
	runBackground(
		'electron_window_activation',
		WindowService.use((service) => service.openMainWindow).pipe(Effect.asVoid),
	)
})
app.on('before-quit', (event) => {
	event.preventDefault()
	if (shutdownRequested) return
	shutdownRequested = true
	// app.exit skips Chromium's profile teardown, which can drop DOM storage
	// writes committed in the final seconds, including fresh auth tokens.
	try {
		session.defaultSession.flushStorageData()
	} catch (cause) {
		runBackground('electron_storage_flush', Effect.fail(new ElectronStorageFlushError({ cause })))
	}
	void shutdown().finally(() => app.exit(0))
})

const main = launchApplication.pipe(Effect.tapCause((cause) => captureFailure('electron_startup', cause)))

void appRuntime.runPromise(main).catch((error) => {
	Sentry.captureException(error, { tags: { operation: 'electron_runtime_startup' } })
	console.error('Electron runtime startup failed', error)
	return shutdown().finally(() => app.exit(1))
})
