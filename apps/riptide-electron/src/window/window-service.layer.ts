import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Path from 'effect/Path'
import * as Queue from 'effect/Queue'
import * as Ref from 'effect/Ref'
import * as Schema from 'effect/Schema'
import * as Semaphore from 'effect/Semaphore'
import * as Stream from 'effect/Stream'

import type { ElectronConfig } from '../config/electron-config'
import { Sentry } from '../instrument'
import {
	ElectronPlatform,
	type ElectronWindowHandle,
	type ElectronWindowState,
} from '../platform/electron-platform.service'
import { rendererUrlForChannel } from '../renderer-protocol-config'
import { WindowService, type OpenedWindow } from './window-service'
import { WindowCreationError, WindowThemeError, WindowZoomError } from './window.errors'

const PersistedWindowState = Schema.Struct({
	width: Schema.Number.check(Schema.isGreaterThan(0)),
	height: Schema.Number.check(Schema.isGreaterThan(0)),
	x: Schema.Number,
	y: Schema.Number,
	maximized: Schema.Boolean,
})

const decodePersistedWindowState = Schema.decodeUnknownEffect(Schema.fromJsonString(PersistedWindowState))

function resolveRendererUrl(input: {
	readonly isPackaged: boolean
	readonly channel: ElectronConfig['channel']
	readonly rendererUrl: URL
}): string {
	return input.isPackaged ? rendererUrlForChannel(input.channel) : input.rendererUrl.toString()
}

export const makeWindowServiceLive = (config: ElectronConfig) =>
	Layer.effect(
		WindowService,
		Effect.gen(function* () {
			const serviceScope = yield* Effect.scope
			const fileSystem = yield* FileSystem.FileSystem
			const pathService = yield* Path.Path
			const platform = yield* ElectronPlatform
			const statePath = pathService.join(config.userDataPath, 'window-state.json')
			const temporaryStatePath = `${statePath}.tmp`
			const stateWriteSemaphore = yield* Semaphore.make(1)
			const openMainWindowSemaphore = yield* Semaphore.make(1)
			const latestWindowState = yield* Ref.make<ElectronWindowState | undefined>(undefined)
			const openedWindowHandles = yield* Queue.unbounded<ElectronWindowHandle>()
			let windowHandle: ElectronWindowHandle | undefined
			let openedWindow: OpenedWindow | undefined
			const additionalWindows = new Map<number, ElectronWindowHandle>()

			const rendererUrl = resolveRendererUrl({
				isPackaged: platform.isPackaged,
				channel: config.channel,
				rendererUrl: config.rendererUrl,
			})
			const describeOpenedWindow = (): OpenedWindow => ({
				rendererUrl,
				security: { sandbox: true, contextIsolation: true, nodeIntegration: false },
			})

			// The single window recipe both operations share: secure preferences,
			// the renderer URL and daemon mode on argv, and publication of the
			// opened handle for runtime wiring such as the RPC port attachment.
			const openSecureWindow = (
				state: ElectronWindowState,
				maximized: boolean,
				windowRole: 'main' | 'additional',
			) =>
				platform
					.openWindow({
						width: state.width,
						height: state.height,
						x: state.x,
						y: state.y,
						maximized,
						minWidth: 800,
						minHeight: 600,
						webPreferences: {
							sandbox: true,
							contextIsolation: true,
							nodeIntegration: false,
							additionalArguments: [
								`--riptide-renderer-url=${rendererUrl}`,
								`--riptide-daemon-mode=${config.daemonMode}`,
								`--riptide-window-role=${windowRole}`,
							],
						},
						rendererUrl,
						preloadPath: platform.preloadPath,
						openDevTools: config.openDevTools,
					})
					.pipe(Effect.tap((handle) => Queue.offer(openedWindowHandles, handle)))

			const writeWindowState = Effect.fn('window_service.persist_window_state')(function* (
				state: ElectronWindowState,
			) {
				yield* stateWriteSemaphore.withPermit(
					Effect.gen(function* () {
						yield* fileSystem.makeDirectory(pathService.dirname(statePath), { recursive: true })
						yield* fileSystem.writeFileString(temporaryStatePath, `${JSON.stringify(state)}\n`, {
							mode: 0o600,
						})
						yield* fileSystem.rename(temporaryStatePath, statePath)
					}),
				)
			})

			const persistWindowStateBestEffort = (state: ElectronWindowState) =>
				writeWindowState(state).pipe(
					Effect.tapError((e) => Effect.logError(e)),
					Effect.tapError((e) => Effect.sync(() => Sentry.captureException(e))),
					Effect.catchTag('PlatformError', () => Effect.void),
				)

			const loadPersistedWindowState = fileSystem.readFileString(statePath, 'utf8').pipe(
				Effect.catchTag('PlatformError', (error) =>
					Match.value(error.reason).pipe(
						Match.when({ _tag: 'NotFound' }, () => Effect.succeed(undefined)),
						Match.orElse(() =>
							Effect.logError(error).pipe(
								Effect.andThen(Effect.sync(() => Sentry.captureException(error))),
								Effect.as(undefined),
							),
						),
					),
				),
				Effect.flatMap((contents) =>
					contents === undefined
						? Effect.succeed(undefined)
						: decodePersistedWindowState(contents).pipe(
								Effect.matchEffect({
									onFailure: (error) =>
										Effect.logWarning('Ignoring malformed Electron window state', error).pipe(
											Effect.annotateLogs({ error_type: 'window_state_parse' }),
											Effect.as(undefined),
										),
									onSuccess: Effect.succeed,
								}),
							),
				),
				Effect.withSpan('window_service.load_window_state'),
			)

			yield* Effect.addFinalizer(() =>
				Effect.gen(function* () {
					const state = yield* Ref.get(latestWindowState)
					if (state !== undefined) yield* persistWindowStateBestEffort(state)
					yield* Effect.forEach(additionalWindows.values(), (handle) => handle.destroy, {
						concurrency: 'unbounded',
						discard: true,
					})
					yield* windowHandle?.destroy ?? Effect.void
				}).pipe(
					Effect.tapCause((cause) => Effect.logError(cause)),
					Effect.tapCause((cause) => Effect.sync(() => Sentry.captureException(cause))),
					Effect.catchCause(() => Effect.void),
				),
			)

			yield* platform.secondInstanceEvents.pipe(
				Stream.runForEach(() =>
					Effect.suspend(() => windowHandle?.showAndFocus ?? Effect.void).pipe(
						Effect.tapError((e) => Effect.logError(e)),
						Effect.tapError((e) => Effect.sync(() => Sentry.captureException(e))),
						Effect.catchTag('ElectronPlatformError', () => Effect.void),
					),
				),
				Effect.forkScoped,
			)

			const openMainWindow = openMainWindowSemaphore.withPermit(
				Effect.suspend(() => {
					if (openedWindow !== undefined) return Effect.succeed(openedWindow)
					return Effect.gen(function* () {
						const persistedState = yield* loadPersistedWindowState
						const initialState = yield* platform.resolveWindowState({
							persistedState,
							defaultWidth: 1440,
							defaultHeight: 900,
						})
						yield* Ref.set(latestWindowState, initialState)
						return yield* platform.setApplicationIcon(config.applicationIconPath).pipe(
							Effect.andThen(openSecureWindow(initialState, initialState.maximized, 'main')),
							Effect.flatMap((handle) =>
								Effect.gen(function* () {
									windowHandle = handle
									const opened = describeOpenedWindow()
									openedWindow = opened
									const removeClosedListener = handle.onClosed(() => {
										if (windowHandle === handle) {
											windowHandle = undefined
											openedWindow = undefined
										}
										removeClosedListener()
									})
									yield* handle.stateChanges.pipe(
										Stream.tap((state) => Ref.set(latestWindowState, state)),
										Stream.debounce('500 millis'),
										Stream.runForEach(persistWindowStateBestEffort),
										Effect.forkIn(serviceScope),
									)
									return opened
								}),
							),
							Effect.tapError((e) => Effect.logError(e)),
							Effect.tapError((e) => Effect.sync(() => Sentry.captureException(e))),
							Effect.tap(() =>
								Effect.logInfo('Electron main window opened').pipe(
									Effect.annotateLogs({ renderer_url: rendererUrl }),
								),
							),
							Effect.withSpan('window_service.open_main_window', {
								attributes: { renderer_url: rendererUrl },
							}),
						)
					}).pipe(Effect.mapError((cause) => new WindowCreationError({ cause })))
				}),
			)

			const openNewWindow = Effect.gen(function* () {
				const initialState = yield* platform.resolveWindowState({
					persistedState: undefined,
					defaultWidth: 1440,
					defaultHeight: 900,
				})
				const handle = yield* openSecureWindow(initialState, false, 'additional')
				additionalWindows.set(handle.id, handle)
				const removeClosedListener = handle.onClosed(() => {
					additionalWindows.delete(handle.id)
					removeClosedListener()
				})
				return describeOpenedWindow()
			}).pipe(
				Effect.tapError((e) => Effect.logError(e)),
				Effect.tapError((e) => Effect.sync(() => Sentry.captureException(e))),
				Effect.mapError((cause) => new WindowCreationError({ cause })),
				Effect.withSpan('window_service.open_new_window'),
			)

			const setWindowTheme = Effect.fn('window_service.set_window_theme')(function* (input: {
				readonly theme: 'light' | 'dark'
			}) {
				const annotations = { theme: input.theme }
				yield* Effect.suspend(() => {
					if (windowHandle === undefined) {
						return Effect.fail(new WindowThemeError({ cause: new Error('Main window is not open') }))
					}
					return windowHandle
						.setThemeSource(input.theme)
						.pipe(Effect.mapError((cause) => new WindowThemeError({ cause })))
				}).pipe(
					Effect.tapError((e) => Effect.logError(e)),
					Effect.tapError((e) => Effect.sync(() => Sentry.captureException(e))),
					Effect.annotateSpans(annotations),
					Effect.annotateLogs(annotations),
				)
			})

			const setZoom = Effect.fn('window_service.set_zoom')(function* (input: { readonly zoomFactor: number }) {
				const annotations = { zoom_factor: input.zoomFactor }
				yield* Effect.suspend(() => {
					if (windowHandle === undefined) {
						return Effect.fail(new WindowZoomError({ cause: new Error('Main window is not open') }))
					}
					return windowHandle
						.setZoomFactor(input.zoomFactor)
						.pipe(Effect.mapError((cause) => new WindowZoomError({ cause })))
				}).pipe(
					Effect.tapError((e) => Effect.logError(e)),
					Effect.tapError((e) => Effect.sync(() => Sentry.captureException(e))),
					Effect.annotateSpans(annotations),
					Effect.annotateLogs(annotations),
				)
			})

			return WindowService.of({
				openMainWindow,
				openNewWindow,
				openedWindows: Stream.fromEffectRepeat(Queue.take(openedWindowHandles)),
				setWindowTheme,
				setZoom,
			})
		}),
	)
