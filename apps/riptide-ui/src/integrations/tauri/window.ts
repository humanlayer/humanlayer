import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'

import { logger } from '@/lib/logger'
import { isTauri } from '@/lib/utils'

interface WindowState {
	width: number
	height: number
	x: number | null
	y: number | null
	maximized: boolean
}

// Module-level state for debounce
let debounceTimer: ReturnType<typeof setTimeout> | null = null
const unlisteners: Array<() => void> = []

/**
 * Save the current window state to persistent storage.
 * Called internally by the debounced handler.
 */
async function saveCurrentState(): Promise<void> {
	if (!isTauri()) return

	try {
		const appWindow = getCurrentWindow()

		const size = await appWindow.innerSize()
		const position = await appWindow.outerPosition()
		const isMaximized = await appWindow.isMaximized()

		const state: WindowState = {
			width: size.width,
			height: size.height,
			x: position.x,
			y: position.y,
			maximized: isMaximized,
		}

		await invoke('save_window_state', { state })
	} catch (error) {
		logger.error('Failed to save window state', { error })
	}
}

/**
 * Debounced save to prevent excessive disk writes during resize/move.
 */
function debounceSaveState(): void {
	if (debounceTimer) {
		clearTimeout(debounceTimer)
	}

	debounceTimer = setTimeout(() => {
		void saveCurrentState()
	}, 500)
}

/**
 * Initialize window state listeners.
 * Window restoration is handled in Rust during app setup.
 */
export async function initWindowStateListeners(): Promise<void> {
	if (!isTauri()) return

	try {
		const appWindow = getCurrentWindow()

		// Listen for resize events
		const unlistenResize = await appWindow.onResized(() => {
			debounceSaveState()
		})
		unlisteners.push(unlistenResize)

		// Listen for move events
		const unlistenMove = await appWindow.onMoved(() => {
			debounceSaveState()
		})
		unlisteners.push(unlistenMove)

		logger.debug('Window state listeners initialized')
	} catch (error) {
		logger.error('Failed to initialize window state listeners', { error })
	}
}

/**
 * Cleanup window state listeners.
 */
export function cleanupWindowStateListeners(): void {
	// Clear debounce timer
	if (debounceTimer) {
		clearTimeout(debounceTimer)
		debounceTimer = null
	}

	// Remove all listeners
	for (const unlisten of unlisteners) {
		unlisten()
	}
	unlisteners.length = 0
}
