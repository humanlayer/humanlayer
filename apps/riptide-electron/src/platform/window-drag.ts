import { WindowDragError } from '@humanlayer/riptide-electron-rpc'
import * as Config from 'effect/Config'
import * as Deferred from 'effect/Deferred'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Schedule from 'effect/Schedule'
import type { BrowserWindow, Point, Screen, WebContents } from 'electron'

import { Sentry } from '../instrument'
import { ElectronPlatformError } from './electron-platform.errors'

// Electron exposes no active Ozone backend query. Fail closed for Wayland sessions
// unless X11 was explicitly selected (including XWayland).
export function supportsWindowDrag(input: {
	readonly platform: string
	readonly ozonePlatform: string
	readonly sessionType: string | undefined
	readonly waylandDisplay: string | undefined
}): boolean {
	return (
		input.platform !== 'linux' ||
		input.ozonePlatform === 'x11' ||
		(input.ozonePlatform !== 'wayland' && input.sessionType !== 'wayland' && !input.waylandDisplay)
	)
}

export const configuredWindowDragSupport = (input: { readonly platform: string; readonly ozonePlatform: string }) =>
	Config.all({
		sessionType: Config.option(Config.String('XDG_SESSION_TYPE')),
		waylandDisplay: Config.option(Config.String('WAYLAND_DISPLAY')),
	}).pipe(
		Config.map(({ sessionType, waylandDisplay }) =>
			supportsWindowDrag({
				...input,
				sessionType: Option.getOrUndefined(sessionType),
				waylandDisplay: Option.getOrUndefined(waylandDisplay),
			}),
		),
	)

// Native SDK seam: construct ONCE per BrowserWindow, before serving any RPCs.
// Native press tracking outlives individual RPCs so delayed renderer pointerdown
// cannot start a drag after native mouseUp. Closed/destroyed owns tracker cleanup.
// Each accepted RPC consumes one native press; only normal release samples once
// more. Interruption, blur and teardown never apply a final position.
export function makeWindowDrag(input: {
	readonly window: Pick<
		BrowserWindow,
		'isDestroyed' | 'isFocused' | 'isMaximized' | 'isFullScreen' | 'getBounds' | 'setPosition'
	> &
		Pick<NodeJS.EventEmitter, 'on' | 'off'> & {
			readonly webContents: Pick<WebContents, 'isDestroyed'> & Pick<NodeJS.EventEmitter, 'on' | 'off'>
		}
	readonly screen: Pick<Screen, 'getCursorScreenPoint'>
	readonly supported: boolean
}): Effect.Effect<void, WindowDragError> {
	const { window, screen } = input
	let active = false
	let disposed = false
	let pressed: { readonly cursor: Point; readonly position: Point } | undefined
	let finishGesture: ((normalRelease: boolean) => void) | undefined
	const nativeCall = <A>(operation: () => A) =>
		Effect.try({
			try: operation,
			catch: (cause) => new ElectronPlatformError({ operation: 'drag_window', cause }),
		})
	const eligible = () =>
		!window.isDestroyed() &&
		!window.webContents.isDestroyed() &&
		window.isFocused() &&
		!window.isMaximized() &&
		!window.isFullScreen()
	const reportNativeFailure = (error: ElectronPlatformError) =>
		Effect.logError('Electron window drag failed', error).pipe(
			Effect.andThen(Effect.sync(() => Sentry.captureException(error))),
			Effect.asVoid,
		)
	const cancel = () => {
		pressed = undefined
		finishGesture?.(false)
	}
	const onMouse = (_event: Electron.Event, mouse: Electron.MouseInputEvent) => {
		if (disposed || mouse.button !== 'left') return
		if (mouse.type === 'mouseDown') {
			cancel()
			// Capture in the native callback, not when a potentially delayed RPC runs.
			// This is bounded synchronous SDK work; failures invalidate the press and
			// are observed even when there is no RPC caller to receive them.
			Effect.runSync(
				nativeCall(() => {
					if (eligible()) pressed = { cursor: screen.getCursorScreenPoint(), position: window.getBounds() }
				}).pipe(
					Effect.catchTag('ElectronPlatformError', reportNativeFailure),
					Effect.withSpan('electron_platform.capture_window_drag_press'),
				),
			)
		} else if (mouse.type === 'mouseUp') {
			pressed = undefined
			finishGesture?.(true)
		}
	}
	const onNavigation = (details: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>) => {
		if (details.isMainFrame && !details.isSameDocument) cancel()
	}
	if (input.supported && !window.isDestroyed() && !window.webContents.isDestroyed()) {
		// The webContents getter throws after BrowserWindow destruction. Retain the
		// emitter while live so closed/destroyed cleanup only removes JS listeners.
		const webContents = window.webContents
		const dispose = () => {
			if (disposed) return
			disposed = true
			cancel()
			window.off('blur', cancel)
			window.off('closed', dispose)
			window.off('maximize', cancel)
			window.off('enter-full-screen', cancel)
			webContents.off('before-mouse-event', onMouse)
			webContents.off('did-start-navigation', onNavigation)
			webContents.off('render-process-gone', cancel)
			webContents.off('destroyed', dispose)
		}
		window.on('blur', cancel)
		window.on('closed', dispose)
		window.on('maximize', cancel)
		window.on('enter-full-screen', cancel)
		webContents.on('before-mouse-event', onMouse)
		webContents.on('did-start-navigation', onNavigation)
		webContents.on('render-process-gone', cancel)
		webContents.on('destroyed', dispose)
	} else {
		disposed = true
	}

	return Effect.acquireUseRelease(
		Effect.suspend(() => {
			if (!input.supported) {
				return Effect.fail(
					new WindowDragError({ reason: 'unavailable', message: 'Window dragging is unsupported' }),
				)
			}
			if (active) {
				return Effect.fail(new WindowDragError({ reason: 'busy', message: 'A window drag is already active' }))
			}
			if (disposed || pressed === undefined) {
				return Effect.fail(
					new WindowDragError({ reason: 'unavailable', message: 'No live native left-button press' }),
				)
			}
			active = true
			return Effect.succeed(pressed)
		}),
		(origin) =>
			Effect.gen(function* () {
				if (!(yield* nativeCall(eligible))) {
					return yield* new WindowDragError({
						reason: 'unavailable',
						message: 'Window cannot be dragged in its current state',
					})
				}
				const ended = yield* Deferred.make<void, ElectronPlatformError>()
				let stopped = false
				let crossedThreshold = false
				let { x: lastX, y: lastY } = origin.position
				const sample = nativeCall(() => {
					if (!eligible()) return cancel()
					const cursor = screen.getCursorScreenPoint()
					const dx = cursor.x - origin.cursor.x
					const dy = cursor.y - origin.cursor.y
					if (!crossedThreshold && Math.hypot(dx, dy) < 4) return
					crossedThreshold = true
					const x = Math.round(origin.position.x + dx)
					const y = Math.round(origin.position.y + dy)
					if (x === lastX && y === lastY) return
					window.setPosition(x, y, false)
					lastX = x
					lastY = y
				})
				yield* Effect.acquireRelease(
					Effect.sync(() => {
						finishGesture = (normalRelease) => {
							if (stopped) return
							stopped = true
							// Sample at mouseUp, not when a deferred waiter later resumes.
							// Returning the Exit through Deferred preserves typed SDK errors.
							Deferred.doneUnsafe(ended, normalRelease ? Effect.runSyncExit(sample) : Effect.void)
						}
					}),
					() =>
						Effect.sync(() => {
							stopped = true
							finishGesture = undefined
						}),
				)
				if (pressed !== origin) {
					return yield* new WindowDragError({
						reason: 'unavailable',
						message: 'Native press ended before drag started',
					})
				}
				// The first sample is prompt and uses the native-down anchor, in DIP.
				yield* Effect.raceFirst(
					Effect.suspend(() => (stopped ? Effect.void : sample)).pipe(
						Effect.repeat(Schedule.spaced('16 millis')),
					),
					Deferred.await(ended),
				)
			}).pipe(Effect.scoped),
		(origin) =>
			Effect.sync(() => {
				active = false
				if (pressed === origin) pressed = undefined
			}),
	).pipe(
		Effect.catchTag('ElectronPlatformError', (error) =>
			reportNativeFailure(error).pipe(
				Effect.andThen(
					Effect.fail(new WindowDragError({ reason: 'failed', message: 'Failed to drag window' })),
				),
			),
		),
		Effect.withSpan('electron_platform.drag_window'),
	)
}
