import * as Context from 'effect/Context'
import type * as Effect from 'effect/Effect'
import type * as Stream from 'effect/Stream'

import type { ElectronWindowHandle } from '../platform/electron-platform.service'
import type { WindowCreationError, WindowThemeError, WindowZoomError } from './window.errors'

export interface OpenedWindow {
	readonly rendererUrl: string
	readonly security: {
		readonly sandbox: true
		readonly contextIsolation: true
		readonly nodeIntegration: false
	}
}

export interface WindowServiceShape {
	readonly openMainWindow: Effect.Effect<OpenedWindow, WindowCreationError>
	readonly openNewWindow: Effect.Effect<OpenedWindow, WindowCreationError>
	// Emits every window handle after it opens so runtime wiring (for example the
	// RPC port attachment) can react without the window service knowing about it.
	readonly openedWindows: Stream.Stream<ElectronWindowHandle>
	readonly setWindowTheme: (input: { readonly theme: 'light' | 'dark' }) => Effect.Effect<void, WindowThemeError>
	readonly setZoom: (input: { readonly zoomFactor: number }) => Effect.Effect<void, WindowZoomError>
}

export class WindowService extends Context.Service<WindowService, WindowServiceShape>()('WindowService') {}
