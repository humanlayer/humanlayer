import type { WindowDragError } from '@humanlayer/riptide-electron-rpc'
import * as Context from 'effect/Context'
import type * as Effect from 'effect/Effect'
import type * as Stream from 'effect/Stream'

import type { ElectronPlatformError } from './electron-platform.errors'

export interface ElectronWindowState {
	readonly width: number
	readonly height: number
	readonly x: number
	readonly y: number
	readonly maximized: boolean
}

export interface ElectronWindowHandle {
	readonly id: number
	readonly destroy: Effect.Effect<void, ElectronPlatformError>
	readonly dragWindow: Effect.Effect<void, WindowDragError>
	readonly setThemeSource: (theme: 'light' | 'dark') => Effect.Effect<void, ElectronPlatformError>
	readonly setZoomFactor: (zoomFactor: number) => Effect.Effect<void, ElectronPlatformError>
	readonly stateChanges: Stream.Stream<ElectronWindowState>
	readonly showAndFocus: Effect.Effect<void, ElectronPlatformError>
	readonly createMessageChannel?: () => {
		readonly port1: Electron.MessagePortMain
		readonly port2: Electron.MessagePortMain
	}
	readonly postMessage: (channel: string, port: Electron.MessagePortMain) => void
	readonly onRendererReady: (listener: () => void) => () => void
	readonly onClosed: (listener: () => void) => () => void
}

export interface ElectronWindowOptions {
	readonly width: number
	readonly height: number
	readonly x: number
	readonly y: number
	readonly maximized: boolean
	readonly minWidth: number
	readonly minHeight: number
	readonly webPreferences: {
		readonly sandbox: true
		readonly contextIsolation: true
		readonly nodeIntegration: false
		readonly additionalArguments: string[]
	}
	readonly rendererUrl: string
	readonly preloadPath: string
	readonly openDevTools: boolean
}

export interface ElectronPlatformShape {
	readonly productName: string
	readonly version: string
	readonly isPackaged: boolean
	readonly resourcesPath: string
	readonly preloadPath: string
	readonly homeDirectory: string
	// The profile path bound by configure-user-data.ts before Chromium started.
	readonly userDataPath: string
	readonly configureBeforeReady: (input: {
		readonly remoteDebuggingPort: number | undefined
	}) => Effect.Effect<void, ElectronPlatformError>
	readonly whenReady: Effect.Effect<void, ElectronPlatformError>
	readonly requestSingleInstanceLock: Effect.Effect<boolean, ElectronPlatformError>
	readonly secondInstanceEvents: Stream.Stream<void>
	readonly quit: Effect.Effect<void, ElectronPlatformError>
	readonly resolveWindowState: (input: {
		readonly persistedState: ElectronWindowState | undefined
		readonly defaultWidth: number
		readonly defaultHeight: number
	}) => Effect.Effect<ElectronWindowState, ElectronPlatformError>
	readonly setApplicationIcon: (iconPath: string | undefined) => Effect.Effect<void, ElectronPlatformError>
	readonly openWindow: (options: ElectronWindowOptions) => Effect.Effect<ElectronWindowHandle, ElectronPlatformError>
}

export class ElectronPlatform extends Context.Service<ElectronPlatform, ElectronPlatformShape>()('ElectronPlatform') {}
