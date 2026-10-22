import { invoke } from '@tauri-apps/api/core'

import { logger } from '@/lib/logger'
import { isTauri } from '@/lib/utils'

/**
 * Apply a zoom level to the webview via the Tauri API.
 * This is a stateless function — callers are responsible for managing state.
 * @param value - The zoom level (1 = 100%, 0.5 = 50%, 2 = 200%)
 */
export async function applyZoomLevel(value: number): Promise<void> {
	if (!isTauri()) {
		return
	}

	try {
		await invoke('plugin:webview|set_webview_zoom', { value })
	} catch (error) {
		logger.error('Failed to set zoom level', { error, value })
	}
}
